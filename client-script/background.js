

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Internal chrome/edge/extension pages disallow script injection
  if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
    console.warn("Atlas: Cannot run on internal page:", tab.url);
    return;
  }

  try {
    // If content script is already loaded, toggle it directly
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_TOGGLE' });
    if (res && res.status === 'ok') return;
  } catch (_) {
    // Not loaded yet, proceed to inject
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "dom-serializer.js",
        "websocket-client.js",
        "secret-vault.js",
        "executor.js",
        "speech.js",
        "tts.js",
        "sidebar.js",
        "content.js",
      ]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["sidebar.css"]
    });

    // Content script is now loaded; send the toggle command
    await chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_TOGGLE' });
  } catch (err) {
    console.error("Atlas: injection failed", err);
  }
});

// ── Backend Proxy (Bypasses Brave Shields, Mixed Content, and host-page CSP) ──
let bgSocket = null;
let bgSessionId = null;
let bgApiKey = null;
let bgBaseUrl = "http://localhost:8000";
let bgAuthenticated = false;
const bgPendingMap = new Map();

const generateCorrelationId = () =>
  `atlas_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const bgWsUrl = () => `${bgBaseUrl.replace(/^http/, "ws")}/v1/agent`;

function sanitizeBaseUrl(url) {
  const fallback = "http://localhost:8000";
  if (!url || typeof url !== "string") return fallback;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    const host = parsed.hostname.toLowerCase();
    // Block cloud metadata SSRF endpoints
    if (host === "169.254.169.254" || host.startsWith("169.254.") || host.includes("metadata.google.internal")) {
      return fallback;
    }
    return parsed.origin;
  } catch (_) {
    return fallback;
  }
}

async function bgStartSession(baseUrl, apiKey) {
  const target = sanitizeBaseUrl(baseUrl);
  const res = await fetch(`${target}/v1/session/start`, {
    method: "POST",
    headers: { "X-Atlas-Key": apiKey },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.detail || body.message || "";
    } catch (_) {
      detail = await res.text().catch(() => "");
    }
    throw new Error(
      `session/start failed: HTTP ${res.status}${detail ? ` (${detail})` : ""}`,
    );
  }
  const data = await res.json();
  if (!data || !data.session_id) {
    throw new Error("Invalid session response from backend");
  }
  return data.session_id;
}

function bgOpenSocket() {
  return new Promise((resolve, reject) => {
    const targetUrl = bgWsUrl();
    try {
      bgSocket = new WebSocket(targetUrl);
    } catch (err) {
      console.error("Atlas background: WebSocket constructor failed", err);
      return reject(err);
    }

    bgSocket.onopen = () => {
      resolve();
    };

    bgSocket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const cid = parsed.correlation_id;
        if (cid && bgPendingMap.has(cid)) {
          const handler = bgPendingMap.get(cid);
          bgPendingMap.delete(cid);
          if (handler.timer) clearTimeout(handler.timer);
          handler.resolve(parsed);
          return;
        }
        console.warn("Atlas background: Discarding unmatched WS message", parsed);
      } catch (err) {
        console.error("Atlas background: Failed to parse WS message", err);
      }
    };

    bgSocket.onerror = (err) => {
      console.error("Atlas background: WebSocket error", targetUrl, err);
      reject(new Error(`WebSocket connection failed to ${targetUrl}`));
    };

    bgSocket.onclose = () => {
      for (const handler of bgPendingMap.values()) {
        if (handler.timer) clearTimeout(handler.timer);
        handler.reject(new Error("Socket closed"));
      }
      bgPendingMap.clear();
      bgAuthenticated = false;
      bgSocket = null;
    };
  });
}

function bgAuthenticate() {
  return new Promise((resolve, reject) => {
    const correlationId = generateCorrelationId();
    const timer = setTimeout(() => {
      if (bgPendingMap.has(correlationId)) {
        bgPendingMap.delete(correlationId);
        reject(new Error("Authentication handshake timed out"));
      }
    }, 15000);

    bgPendingMap.set(correlationId, {
      timer,
      resolve: (data) => {
        if (data.status === "ok") {
          bgAuthenticated = true;
          resolve(data);
        } else {
          bgAuthenticated = false;
          reject(new Error(data.message || "Authentication failed"));
        }
      },
      reject,
    });
    bgSocket.send(
      JSON.stringify({
        type: "auth",
        api_key: bgApiKey,
        correlation_id: correlationId,
      }),
    );
  });
}

async function bgConnect({ baseUrl, apiKey }) {
  if (baseUrl) bgBaseUrl = sanitizeBaseUrl(baseUrl);
  if (apiKey) bgApiKey = apiKey;
  if (!bgApiKey) throw new Error("AtlasSocket.connect requires an apiKey");

  bgSessionId = await bgStartSession(bgBaseUrl, bgApiKey);
  await bgOpenSocket();
  await bgAuthenticate();
  return { status: "ok", sessionId: bgSessionId };
}

async function bgEnsureConnected() {
  if (bgSocket && bgSocket.readyState === WebSocket.OPEN && bgAuthenticated) {
    return;
  }
  if (!bgApiKey) {
    const stored = await new Promise((r) =>
      chrome.storage.local.get(["atlasApiKey", "atlasBaseUrl"], r)
    );
    if (stored?.atlasApiKey) bgApiKey = stored.atlasApiKey;
    if (stored?.atlasBaseUrl) bgBaseUrl = sanitizeBaseUrl(stored.atlasBaseUrl);
  }
  if (bgApiKey) {
    await bgConnect({ baseUrl: bgBaseUrl, apiKey: bgApiKey });
  }
}

async function bgSendMessage(msg) {
  if (!bgSocket || bgSocket.readyState !== WebSocket.OPEN || !bgAuthenticated) {
    await bgEnsureConnected();
  }
  if (!bgSocket || bgSocket.readyState !== WebSocket.OPEN) {
    throw new Error(
      `Socket is not connected. Please check that backend is running at ${bgBaseUrl}`,
    );
  }
  if (!bgAuthenticated) {
    throw new Error("Not authenticated. Please check your Atlas API key.");
  }

  return new Promise((resolve, reject) => {
    const correlationId = msg.correlation_id || generateCorrelationId();
    const timer = setTimeout(() => {
      if (bgPendingMap.has(correlationId)) {
        bgPendingMap.delete(correlationId);
        reject(new Error("Request timed out after 30 seconds"));
      }
    }, 30000);

    bgPendingMap.set(correlationId, { resolve, reject, timer });
    bgSocket.send(
      JSON.stringify({
        session_id: bgSessionId,
        ...msg,
        correlation_id: correlationId,
      }),
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ATLAS_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (message.type === "ATLAS_SOCKET_CONNECT") {
    bgConnect({ baseUrl: message.baseUrl, apiKey: message.apiKey })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "ATLAS_SOCKET_SEND") {
    bgSendMessage(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "ATLAS_CHAT") {
    const chatBase = sanitizeBaseUrl(message.baseUrl || "http://localhost:8000");
    fetch(`${chatBase}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Atlas-Key": message.apiKey || "",
      },
      body: JSON.stringify(message.payload),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === "ATLAS_SUMMARY") {
    const summaryBase = sanitizeBaseUrl(message.baseUrl || "http://localhost:8000");
    fetch(`${summaryBase}/v1/summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Atlas-Key": message.apiKey || "",
      },
      body: JSON.stringify(message.payload),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
});
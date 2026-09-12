

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
let bgPendingQueue = [];

const bgWsUrl = () => `${bgBaseUrl.replace(/^http/, "ws")}/v1/agent`;

async function bgStartSession(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl}/v1/session/start`, {
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
      const next = bgPendingQueue.shift();
      if (!next) return;
      try {
        next.resolve(JSON.parse(event.data));
      } catch (err) {
        next.reject(err);
      }
    };

    bgSocket.onerror = (err) => {
      console.error("Atlas background: WebSocket error", targetUrl, err);
      reject(new Error(`WebSocket connection failed to ${targetUrl}`));
    };

    bgSocket.onclose = () => {
      bgPendingQueue.forEach((p) => p.reject(new Error("Socket closed")));
      bgPendingQueue = [];
      bgAuthenticated = false;
      bgSocket = null;
    };
  });
}

function bgAuthenticate() {
  return new Promise((resolve, reject) => {
    bgPendingQueue.push({
      resolve: (data) => {
        if (data.status === "ok") {
          bgAuthenticated = true;
          resolve();
        } else {
          const msg = data.message || "Authentication failed";
          reject(new Error(msg));
        }
      },
      reject,
    });
    bgSocket.send(JSON.stringify({ type: "auth", api_key: bgApiKey }));
  });
}

async function bgConnect({ baseUrl, apiKey }) {
  if (baseUrl) bgBaseUrl = baseUrl;
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
    bgPendingQueue.push({ resolve, reject });
    bgSocket.send(
      JSON.stringify({
        session_id: bgSessionId,
        ...msg,
      }),
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ATLAS_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (message.type === "ATLAS_PROXY_FETCH") {
    fetch(message.url, message.options || {})
      .then(async (res) => {
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}
        sendResponse({ ok: res.ok, status: res.status, data: json, text });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, error: err.message });
      });
    return true;
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
    const chatBase = message.baseUrl || "http://localhost:8000";
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
    const summaryBase = message.baseUrl || "http://localhost:8000";
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
// content.js
// Orchestrator — wires modules together. Also detects URL changes (for SPAs
// like Amazon) and re-renders the panel when navigation happens.

const API_KEY_STORAGE_KEY = "atlasApiKey";
const BASE_URL_STORAGE_KEY = "atlasBaseUrl";
const CONTENT_DEFAULT_BASE_URL = "http://localhost:8000";
let active = false;
let stopObserving = null;
let lastUrl = location.href;

const getStoredSettings = () =>
  new Promise((resolve) => {
    chrome.storage.local.get(
      [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
      (result) => {
        resolve({
          apiKey: result[API_KEY_STORAGE_KEY] || null,
          baseUrl: result[BASE_URL_STORAGE_KEY] || CONTENT_DEFAULT_BASE_URL,
        });
      },
    );
  });

const sendToOptionsPage = () => {
  window.AtlasSidebar.setStatus(
    "No API key saved yet. Opening Atlas settings — enter your key there, then click the toolbar icon again.",
    "error",
  );
  chrome.runtime.sendMessage({ type: "ATLAS_OPEN_OPTIONS" });
};

const renderSimplified = async (domMap) => {
  if (domMap.length === 0) {
    window.AtlasSidebar.renderElements([]);
    return;
  }

  // Show skeleton while waiting for LLM
  window.AtlasSidebar.setLoading(true);

  try {
    const response = await window.AtlasSocket.sendSimplify({
      url: window.location.href,
      domMap,
    });
    if (response.status === "success" && response.elements?.length) {
      const items = response.elements.map((el) => ({
        id: el.element_id,
        label: el.label,
        category: el.category,
      }));
      window.AtlasSidebar.renderElements(items);
      return;
    }
  } catch (err) {
    // fall through to local heuristic
  }

  // Fallback to local labels if LLM fails
  window.AtlasSidebar.renderElements(
    window.AtlasSidebar.deriveDisplayItems(domMap),
  );
};

const refreshPanel = () => {
  const domMap = window.AtlasSerializer.serialize();
  window.AtlasSidebar.renderElements(
    window.AtlasSidebar.deriveDisplayItems(domMap),
  );
  renderSimplified(domMap);
};

const runCommand = async (command) => {
  window.AtlasSidebar.setStatus("Thinking...", "info");
  try {
    const domMap = window.AtlasSerializer.serialize();
    const response = await window.AtlasSocket.sendCommand({
      url: window.location.href,
      domMap,
      command,
    });
    const result = window.AtlasExecutor.execute(response);
    window.AtlasSidebar.setStatus(result.message, result.ok ? "ok" : "error");
  } catch (err) {
    window.AtlasSidebar.setStatus(`Connection issue: ${err.message}`, "error");
  }
};

const handleElementClick = (atlasId) => {
  const result = window.AtlasExecutor.execute({
    status: "ok",
    action: "click",
    element_id: atlasId,
    value: null,
    message: "Done.",
  });
  window.AtlasSidebar.setStatus(result.message, result.ok ? "ok" : "error");
};

const handleMicClick = () => {
  if (!window.AtlasSpeech.isSupported()) {
    window.AtlasSidebar.setStatus(
      "Voice input is not supported in this browser.",
      "error",
    );
    return;
  }
  window.AtlasSidebar.setListening(true);
  window.AtlasSpeech.start({
    onResult: (transcript) => {
      window.AtlasSidebar.setStatus(`Heard: "${transcript}"`, "info");
      runCommand(transcript);
    },
    onEnd: () => window.AtlasSidebar.setListening(false),
    onError: (err) => {
      window.AtlasSidebar.setListening(false);
      window.AtlasSidebar.setStatus(err.message, "error");
    },
  });
};

// ── URL change detection for SPAs ─────────────────────────────────────────────
// Amazon and other SPAs mutate the URL without triggering a full page load.
// We watch for that and refresh the panel when it happens.
const startUrlWatcher = () => {
  // Poll every 500ms — cheap and reliable across all SPA routing strategies
  const interval = setInterval(() => {
    if (!active) {
      clearInterval(interval);
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.AtlasSidebar.setStatus("Page changed — refreshing...", "info");
      // Give the SPA a moment to finish rendering before we re-scan
      setTimeout(() => {
        if (active) refreshPanel();
      }, 800);
    }
  }, 500);
  return () => clearInterval(interval);
};

let stopUrlWatcher = null;

const activate = async () => {
  if (active) return;

  const { apiKey, baseUrl } = await getStoredSettings();

  window.AtlasSidebar.mount({
    onClose: deactivate,
    onElementClick: handleElementClick,
    onCommandSubmit: runCommand,
    onMicClick: handleMicClick,
  });

  if (!apiKey) {
    sendToOptionsPage();
    return;
  }

  const domMap = window.AtlasSerializer.serialize();
  window.AtlasSidebar.renderElements(
    window.AtlasSidebar.deriveDisplayItems(domMap),
  );

  stopObserving = window.AtlasSerializer.observe((updatedMap) => {
    window.AtlasSidebar.renderElements(
      window.AtlasSidebar.deriveDisplayItems(updatedMap),
    );
    renderSimplified(updatedMap);
  });

  stopUrlWatcher = startUrlWatcher();
  lastUrl = location.href;
  active = true;

  window.AtlasSidebar.setStatus("Connecting...", "info");

  try {
    await window.AtlasSocket.connect({ baseUrl, apiKey });
    window.AtlasSocket.onDisconnect(() => {
      window.AtlasSidebar.setStatus("Disconnected — reconnecting...", "error");
    });
    window.AtlasSidebar.setStatus("Ready.", "ok");
    renderSimplified(domMap);
  } catch (err) {
    window.AtlasSidebar.setStatus(`Couldn't connect: ${err.message}`, "error");
  }
};

const deactivate = () => {
  if (!active) {
    window.AtlasSidebar.unmount();
    return;
  }
  stopObserving?.();
  stopObserving = null;
  stopUrlWatcher?.();
  stopUrlWatcher = null;
  window.AtlasSocket.close();
  window.AtlasSidebar.unmount();
  active = false;
};

const toggle = () => (active ? deactivate() : activate());

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "ATLAS_TOGGLE") toggle();
});

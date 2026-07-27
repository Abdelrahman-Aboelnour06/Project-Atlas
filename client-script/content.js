(function () {
  // content.js — orchestrator

  const API_KEY_STORAGE_KEY = "atlasApiKey";
  const BASE_URL_STORAGE_KEY = "atlasBaseUrl";
  const DEFAULT_BASE_URL = "http://localhost:8000";

  let active = false;
  let stopObserving = null;
  let stopUrlWatcher = null;
  let lastUrl = location.href;

  const getStoredSettings = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(
        [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
        (result) => {
          resolve({
            apiKey: result[API_KEY_STORAGE_KEY] || null,
            baseUrl: result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL,
          });
        },
      );
    });

  // ── Page text extraction (for chat questions about site content) ──────────────
  const getPageText = () => {
    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll("#atlas-sidebar-root, script, style, noscript")
      .forEach((el) => el.remove());
    return (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000); // cap to avoid huge LLM prompts
  };

  // ── Chat: answer questions about the page via LLM ────────────────────────────
  const handleChatQuestion = async (text) => {
    window.AtlasSidebar.addChatThinking();
    try {
      const pageText = getPageText();
      const prompt = `You are a helpful assistant for a website. A user is asking a question about the current webpage. Answer in 1-3 plain sentences, like you're talking to an elderly person. Be direct and helpful.

PAGE CONTENT (summary):
${pageText}

USER QUESTION: ${text}

Answer:`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      // If Anthropic API isn't available, fall through to backend command pipeline
      if (!res.ok) throw new Error("API unavailable");

      const data = await res.json();
      const answer =
        data.content?.[0]?.text ||
        "I'm not sure, but you can try searching the page.";
      window.AtlasSidebar.removeThinking();
      window.AtlasSidebar.addChatMessage("agent", answer);
    } catch (_) {
      // Fallback: treat it as a command
      window.AtlasSidebar.removeThinking();
      await runCommand(text);
    }
  };

  // ── Detect if input is a question or a command ───────────────────────────────
  const isQuestion = (text) => {
    const t = text.trim().toLowerCase();
    return (
      t.endsWith("?") ||
      /^(do|does|is|are|can|what|where|how|who|when|which|has|have|tell me|show me|find|search for)/.test(
        t,
      )
    );
  };

  const handleChatInput = async (text) => {
    if (isQuestion(text)) {
      await handleChatQuestion(text);
    } else {
      window.AtlasSidebar.addChatThinking();
      await runCommand(text);
    }
  };

  // ── Simplify pipeline ─────────────────────────────────────────────────────────
  const renderSimplified = async (domMap) => {
    if (domMap.length === 0) {
      window.AtlasSidebar.renderElements([]);
      return;
    }
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
          group: el.group || null,
        }));
        window.AtlasSidebar.renderElements(items);
        return;
      }
    } catch (_) {}
    window.AtlasSidebar.renderElements(
      window.AtlasSidebar.deriveDisplayItems(domMap),
    );
  };

  // ── Command pipeline ──────────────────────────────────────────────────────────
  const runCommand = async (command) => {
    window.AtlasSidebar.setStatus("Thinking...", "info");
    try {
      const domMap = window.AtlasSerializer.serialize();
      const response = await window.AtlasSocket.sendCommand({
        url: window.location.href,
        domMap,
        command,
      });
      const result = await window.AtlasExecutor.execute(response);

      // Show result in chat as an agent message
      const msg = result.ok
        ? `✅ ${response.message || "Done."}`
        : `❌ ${response.message || "I couldn't find that on the page."}`;
      window.AtlasSidebar.removeThinking();
      window.AtlasSidebar.addChatMessage("agent", msg);
      window.AtlasSidebar.setStatus(
        result.ok ? "Done." : "No match found.",
        result.ok ? "ok" : "error",
      );
    } catch (err) {
      window.AtlasSidebar.removeThinking();
      window.AtlasSidebar.addChatMessage(
        "agent",
        `❌ Connection issue: ${err.message}`,
      );
      window.AtlasSidebar.setStatus("Connection error.", "error");
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

  // ── Voice input ───────────────────────────────────────────────────────────────
  const handleMicClick = () => {
    if (!window.AtlasSpeech.isSupported()) {
      window.AtlasSidebar.setStatus(
        "Voice not supported in this browser.",
        "error",
      );
      return;
    }
    window.AtlasSidebar.setListening(true);
    window.AtlasSpeech.start({
      onResult: (transcript) => {
        window.AtlasSidebar.addChatMessage("user", transcript);
        handleChatInput(transcript);
      },
      onEnd: () => window.AtlasSidebar.setListening(false),
      onError: (err) => {
        window.AtlasSidebar.setListening(false);
        window.AtlasSidebar.setStatus(err.message, "error");
      },
    });
  };

  // ── URL watcher ───────────────────────────────────────────────────────────────
  const startUrlWatcher = () => {
    const interval = setInterval(() => {
      if (!active) {
        clearInterval(interval);
        return;
      }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        window.AtlasSidebar.setStatus("Page changed — refreshing...", "info");
        setTimeout(() => {
          if (active) refreshPanel();
        }, 800);
      }
    }, 500);
    return () => clearInterval(interval);
  };

  const refreshPanel = () => {
    const domMap = window.AtlasSerializer.serialize();
    window.AtlasSidebar.renderElements(
      window.AtlasSidebar.deriveDisplayItems(domMap),
    );
    renderSimplified(domMap);
  };

  // ── Activate / deactivate ─────────────────────────────────────────────────────
  const activate = async () => {
    if (active) return;

    const { apiKey, baseUrl } = await getStoredSettings();

    window.AtlasSidebar.mount({
      onClose: deactivate,
      onElementClick: handleElementClick,
      onCommandSubmit: handleChatInput,
      onMicClick: handleMicClick,
    });

    // Welcome message
    window.AtlasSidebar.addChatMessage(
      "agent",
      'Hi! I\'m Atlas. You can ask me anything about this page, or tell me what you\'d like to do — like "click checkout" or "fill in my name".',
    );

    if (!apiKey) {
      window.AtlasSidebar.addChatMessage(
        "agent",
        "⚠️ No API key found. Opening settings...",
      );
      chrome.runtime.sendMessage({ type: "ATLAS_OPEN_OPTIONS" });
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
    });
    stopUrlWatcher = startUrlWatcher();
    lastUrl = location.href;
    active = true;

    window.AtlasSidebar.setStatus("Connecting...", "info");

    try {
      await window.AtlasSocket.connect({ baseUrl, apiKey });
      window.AtlasSocket.onDisconnect(() =>
        window.AtlasSidebar.setStatus(
          "Disconnected — reconnecting...",
          "error",
        ),
      );
      window.AtlasSidebar.setStatus("Ready.", "ok");
      renderSimplified(domMap);
    } catch (err) {
      window.AtlasSidebar.setStatus(
        `Couldn't connect: ${err.message}`,
        "error",
      );
    }
  };

  const deactivate = () => {
    stopObserving?.();
    stopObserving = null;
    stopUrlWatcher?.();
    stopUrlWatcher = null;
    window.AtlasSocket?.close();
    window.AtlasSidebar.unmount();
    active = false;
  };

  const toggle = () => (active ? deactivate() : activate());

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "ATLAS_TOGGLE") toggle();
  });
})();

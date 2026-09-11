(function () {
  // content.js — orchestrator

  const API_KEY_STORAGE_KEY = "atlasApiKey";
  const BASE_URL_STORAGE_KEY = "atlasBaseUrl";
  const DEFAULT_BASE_URL = "http://localhost:8000";

  let active = false;
  let stopObserving = null;
  let stopUrlWatcher = null;
  let lastUrl = location.href;

  const DEFAULT_DEV_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

  const getStoredSettings = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(
        [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
        (result) => {
          let apiKey = result[API_KEY_STORAGE_KEY] || null;
          const baseUrl = result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL;

          // Auto-seed dev API key if not configured and connecting to localhost
          if (
            !apiKey &&
            (baseUrl.includes("localhost:8000") || baseUrl.includes("127.0.0.1:8000"))
          ) {
            apiKey = DEFAULT_DEV_KEY;
            chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey });
          }

          resolve({ apiKey, baseUrl });
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

  let conversationHistory = [];
  let pendingConfirmation = null;
  let currentMode = "chat"; // 'chat' | 'voice'

  const speakIfVoiceMode = (text) => {
    if (currentMode === "voice" && window.AtlasTTS?.isSupported()) {
      window.AtlasTTS.speak(text);
    }
  };

  // ── Unified Agentic Conversation & Multi-Step Execution Pipeline ─────────
  const handleChatInput = async (text) => {
    const rawInput = (text || "").trim();
    if (!rawInput) return;

    // Stop ongoing speech before handling new input
    window.AtlasTTS?.stop();

    const lowerInput = rawInput.toLowerCase();

    // 1. Handle Pending Confirmation State
    if (pendingConfirmation) {
      const isAffirmative = /^(yes|sure|proceed|place order|confirm|go ahead|ok|do it|please do|yeah|yep|continue)\b/i.test(lowerInput);
      const isNegative = /^(no|cancel|stop|never mind|don't|dont|wait|abort)\b/i.test(lowerInput);

      if (isAffirmative) {
        window.AtlasSidebar.setStatus("Finalizing order...", "info");
        window.AtlasSidebar.addChatThinking();

        const actionToExecute = pendingConfirmation.action;
        pendingConfirmation = null;

        try {
          if (actionToExecute) {
            await window.AtlasExecutor.executeStep(actionToExecute);
          }
          await new Promise((r) => setTimeout(r, 600));
          refreshPanel();

          const placedMsg = "Your order has been placed! A licensed pharmacist will review your prescription/order within 24 hours.";
          window.AtlasSidebar.setStatus("Order Placed!", "ok");
          window.AtlasSidebar.removeThinking();
          window.AtlasSidebar.addChatMessage("agent", placedMsg);
          speakIfVoiceMode(placedMsg);
        } catch (err) {
          const errMsg = `Sorry, I ran into an issue: ${err.message}`;
          window.AtlasSidebar.setStatus("Error", "error");
          window.AtlasSidebar.removeThinking();
          window.AtlasSidebar.addChatMessage("agent", errMsg);
          speakIfVoiceMode(errMsg);
        }
        return;
      }

      if (isNegative) {
        pendingConfirmation = null;
        const cancelMsg = "Understood! I've cancelled the purchase and will not place the order.";
        window.AtlasSidebar.setStatus("Cancelled", "info");
        window.AtlasSidebar.addChatMessage("agent", cancelMsg);
        speakIfVoiceMode(cancelMsg);
        return;
      }
    }

    // 2. Multi-Step Agentic Planning
    window.AtlasSidebar.setStatus("Thinking...", "info");
    window.AtlasSidebar.addChatThinking();

    try {
      const pageText = getPageText();
      const domMap = window.AtlasSerializer.serialize();
      const { apiKey, baseUrl } = await getStoredSettings();

      conversationHistory.push({ role: "user", content: rawInput });
      if (conversationHistory.length > 8) conversationHistory = conversationHistory.slice(-8);

      const requestPayload = {
        url: window.location.href,
        question: rawInput,
        page_text: pageText,
        dom_map: domMap,
        history: conversationHistory,
        api_key: apiKey || "",
      };

      let responseData = null;
      if (chrome?.runtime?.sendMessage) {
        responseData = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "ATLAS_CHAT",
              baseUrl,
              apiKey: apiKey || "",
              payload: requestPayload,
            },
            (res) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              if (!res || !res.ok) {
                return reject(new Error(res?.error || "Agent request failed"));
              }
              resolve(res.data);
            },
          );
        });
      } else {
        const res = await fetch(`${baseUrl}/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Atlas-Key": apiKey || "",
          },
          body: JSON.stringify(requestPayload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        responseData = await res.json();
      }

      window.AtlasSidebar.removeThinking();

      const plan = responseData?.plan;

      // If planner returned multi-step plan
      if (plan && Array.isArray(plan.steps) && plan.steps.length > 0) {
        // Execute steps sequentially with high-contrast highlighting
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];
          window.AtlasSidebar.setStatus(step.description || `Executing step ${i + 1}...`, "info");
          await window.AtlasExecutor.executeStep(step);
          await new Promise((r) => setTimeout(r, step.delay_ms || 600));
        }

        refreshPanel();

        // Check if confirmation is requested before completing sale
        if (plan.requires_confirmation) {
          let pendingBtn = null;
          const updatedDom = window.AtlasSerializer.serialize();
          const checkoutNode = updatedDom.find((n) => /proceed to checkout|place order|checkout/i.test(n.label || ""));
          if (checkoutNode) {
            pendingBtn = { action: "click", element_id: checkoutNode.id, description: "Place order" };
          }

          pendingConfirmation = {
            action: pendingBtn || { action: "click", element_id: "checkout-btn" },
            prompt: plan.confirmation_prompt || plan.reply,
          };

          const confirmText = plan.confirmation_prompt || plan.reply;
          conversationHistory.push({ role: "assistant", content: confirmText });

          window.AtlasSidebar.setStatus("Awaiting confirmation", "info");
          window.AtlasSidebar.addChatMessage("agent", confirmText, {
            actions: plan.confirmation_options || ["Yes, place order", "No, cancel"],
            onAction: (choice) => {
              window.AtlasSidebar.addChatMessage("user", choice);
              handleChatInput(choice);
            },
          });
          speakIfVoiceMode(confirmText);
          return;
        }

        const replyText = plan.reply || "Done!";
        conversationHistory.push({ role: "assistant", content: replyText });
        window.AtlasSidebar.setStatus("Done.", "ok");
        window.AtlasSidebar.addChatMessage("agent", replyText);
        speakIfVoiceMode(replyText);
        return;
      }

      // Conversational response without DOM steps
      const replyText = plan?.reply || responseData?.answer || "I've reviewed the page for you.";
      conversationHistory.push({ role: "assistant", content: replyText });
      window.AtlasSidebar.setStatus("Ready.", "ok");
      window.AtlasSidebar.addChatMessage("agent", replyText);
      speakIfVoiceMode(replyText);

    } catch (err) {
      console.warn("Agentic planner failed, falling back to command pipeline:", err);
      window.AtlasSidebar.removeThinking();
      await runCommand(rawInput);
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

const refreshPanel = () => {
  const domMap = window.AtlasSerializer.serialize();
  window.AtlasSidebar.renderElements(
    window.AtlasSidebar.deriveDisplayItems(domMap),
  );
  renderSimplified(domMap);
};

const runCommand = async (command) => {
  window.AtlasSidebar.setStatus("Thinking...", "info");
  window.AtlasSidebar.addChatThinking();
  try {
    const domMap = window.AtlasSerializer.serialize();
    const response = await window.AtlasSocket.sendCommand({
      url: window.location.href,
      domMap,
      command,
    });
    const result = await window.AtlasExecutor.execute(response);
    window.AtlasSidebar.setStatus(result.message, result.ok ? "ok" : "error");
    window.AtlasSidebar.removeThinking();
    const reply = result.message || (result.ok ? "Done!" : "I couldn't perform that action.");
    window.AtlasSidebar.addChatMessage("agent", reply);
  } catch (err) {
    window.AtlasSidebar.setStatus(`Connection issue: ${err.message}`, "error");
    window.AtlasSidebar.removeThinking();
    window.AtlasSidebar.addChatMessage("agent", `Sorry, I ran into an issue: ${err.message}`);
  }
};

const handleElementClick = async (atlasId) => {
  const result = await window.AtlasExecutor.execute({
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
    window.AtlasTTS?.stop();
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

  // ── Activate / deactivate ─────────────────────────────────────────────────────
  const activate = async () => {
    if (active) return;

    const { apiKey, baseUrl } = await getStoredSettings();

    window.AtlasSidebar.mount({
      onClose: deactivate,
      onElementClick: handleElementClick,
      onCommandSubmit: handleChatInput,
      onMicClick: handleMicClick,
      onModeChange: (newMode) => {
        currentMode = newMode;
        if (newMode !== "voice") {
          window.AtlasTTS?.stop();
        } else {
          speakIfVoiceMode("Voice mode enabled. I will read responses aloud.");
        }
      },
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
      console.error("Atlas: Connection failed:", err);
      window.AtlasSidebar.setStatus(
        `Couldn't connect: ${err.message}`,
        "error",
      );
      let guidance = `⚠️ Couldn't connect to Atlas backend (${err.message}).`;
      if (err.message.includes("401")) {
        guidance = "⚠️ Invalid API key (HTTP 401). Please check your key in the Atlas extension settings.";
      } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
        guidance = `⚠️ Cannot reach Atlas backend at ${baseUrl}. Make sure the Docker container or server is running.`;
      }
      window.AtlasSidebar.addChatMessage("agent", guidance);
    }
  };

  const deactivate = () => {
    window.AtlasTTS?.stop();
    stopObserving?.();
    stopObserving = null;
    stopUrlWatcher?.();
    stopUrlWatcher = null;
    window.AtlasSocket?.close();
    window.AtlasSidebar.unmount();
    active = false;
  };

  const toggle = () => (active ? deactivate() : activate());

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ATLAS_PING") {
      sendResponse({ status: "ok" });
      return true;
    }
    if (message.type === "ATLAS_TOGGLE") {
      toggle();
      sendResponse({ status: "ok", active });
      return true;
    }
  });
})();

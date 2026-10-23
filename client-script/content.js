(function () {
  // content.js — orchestrator

  const API_KEY_STORAGE_KEY = "atlasApiKey";
  const BASE_URL_STORAGE_KEY = "atlasBaseUrl";
  const DEFAULT_BASE_URL = "http://localhost:8000";

  let active = false;
  let stopObserving = null;
  let stopUrlWatcher = null;
  let lastUrl = typeof location !== "undefined" ? location.href : "";

  const getStoredSettings = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(
        [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
        (result) => {
          const apiKey = result[API_KEY_STORAGE_KEY] || null;
          const baseUrl = result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL;
          resolve({ apiKey, baseUrl });
        },
      );
    });

  // ── Page text extraction (for chat questions about site content) ──────────────
  const getPageText = () => {
    if (!document.body) return "";
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (
            tag === "script" ||
            tag === "style" ||
            tag === "noscript" ||
            tag === "template" ||
            parent.closest("#atlas-sidebar-root") ||
            parent.closest("#atlas-sidebar-host")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let text = "";
    let currentNode = walker.nextNode();
    while (currentNode && text.length < 3000) {
      const val = currentNode.nodeValue.trim();
      if (val) {
        text += (text ? " " : "") + val;
      }
      currentNode = walker.nextNode();
    }
    return text.slice(0, 3000);
  };

  let conversationHistory = [];
  let pendingConfirmation = null;
  let currentMode = "chat"; // 'chat' | 'voice'

  const speakIfVoiceMode = (text) => {
    if (currentMode === "voice" && window.AtlasTTS?.isSupported()) {
      window.AtlasTTS.speak(text);
    }
  };

  // ── Goal Execution & Abort Controller State (Tracks U2 & U4) ────────────────
  let isExecuting = false;
  let currentAbortController = null;
  let currentGoalState = null;
  let pendingUserResponse = null;
  let pendingUserInputs = null;
  let lastActionResult = null;
  let recentStepSignature = null;
  let stepRepeatCount = 0;

  function interruptibleSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new DOMException("Aborted", "AbortError"));
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  const stopGoalExecution = async () => {
    console.log("Atlas: Halting goal execution via Stop control.");
    isExecuting = false;

    // 1. Abort in-flight network requests
    if (currentAbortController) {
      try {
        currentAbortController.abort();
      } catch (_) {}
      currentAbortController = null;
    }

    // 2. Halt speech and voice output
    try {
      window.AtlasTTS?.stop();
      window.AtlasSpeech?.stop();
    } catch (_) {}

    // 3. Clear pending human confirmations & input state
    pendingConfirmation = null;
    pendingUserResponse = null;
    pendingUserInputs = null;
    lastActionResult = null;
    recentStepSignature = null;
    stepRepeatCount = 0;
    isHopInProgress = false;
    currentGoalState = null;

    // 4. Clear GoalStore in session storage
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: "ATLAS_GOAL_STORE_CLEAR" });
        chrome.runtime.sendMessage({
          type: "ATLAS_GOAL_STORE_SET_EXECUTING",
          isExecuting: false,
        });
      } catch (_) {}
    }

    // 5. Update Sidebar UI
    window.AtlasSidebar?.setAutoHide?.(false);
    window.AtlasSidebar?.hideResumeButton?.();
    isPausedForHuman = false;
    window.AtlasSidebar?.setExecuting(false);
    window.AtlasSidebar?.hideGoalProgress();
    window.AtlasSidebar?.removeThinking();
    window.AtlasSidebar?.setStatus("Goal stopped by user", "info");
    window.AtlasSidebar?.addChatMessage("agent", "🛑 Goal stopped by user.");
    speakIfVoiceMode("Goal stopped by user.");
  };

  // ── URL & Token Redaction (§R2 / §H10) ─────────────────────────────────────
  const redactUrl = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    try {
      const u = new URL(rawUrl);
      return `${u.origin}${u.pathname}`;
    } catch (_) {
      return rawUrl.split(/[?#]/)[0];
    }
  };

  const sanitizeTokens = (text) => {
    if (!text || typeof text !== "string") return "";
    return text.replace(/\b(?:access_token|code|token)=[^&\s]+/gi, "[REDACTED]");
  };


  const capTitle = (title, maxChars = 80) => {
    if (!title || typeof title !== "string") return "";
    return title.trim().slice(0, maxChars);
  };

  // ── Settle Window with 1s Quiet Period (§R2 / §H9) ─────────────────────────
  const waitForNavigationSettle = async (timeoutMs = 5000, signal = null) => {
    if (typeof window !== "undefined" && window.__ATLAS_TEST_ENV__) return;
    if (typeof document === "undefined" || !document.readyState) return;
    const start = Date.now();
    // Wait for document.readyState === "complete"
    while (document.readyState !== "complete" && Date.now() - start < timeoutMs) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (signal?.aborted) return;

    let mutationOccurred = false;
    let observer = null;

    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      try {
        observer = new MutationObserver(() => {
          mutationOccurred = true;
        });
        const target = document.body || document.documentElement || document;
        if (target && typeof target.nodeType === "number") {
          observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
        }
      } catch (_) {}
    }

    // 1-second quiet window: URL and DOM must remain stable for 1000ms
    let lastUrl = typeof window !== "undefined" ? window.location.href : "";
    let lastDomSnapshot = typeof document !== "undefined" && document.body && typeof document.body.innerHTML === "string"
      ? document.body.innerHTML
      : "";
    let quietElapsed = 0;

    try {
      while (quietElapsed < 1000 && Date.now() - start < timeoutMs) {
        if (signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 100));

        const currUrl = typeof window !== "undefined" ? window.location.href : "";
        const currDomSnapshot = typeof document !== "undefined" && document.body && typeof document.body.innerHTML === "string"
          ? document.body.innerHTML
          : "";

        const urlChanged = currUrl !== lastUrl;
        const domChanged = (currDomSnapshot !== lastDomSnapshot) || mutationOccurred;

        if (urlChanged || domChanged) {
          lastUrl = currUrl;
          lastDomSnapshot = currDomSnapshot;
          mutationOccurred = false;
          quietElapsed = 0; // reset quiet timer on redirect/URL mutation or DOM mutation
        } else {
          quietElapsed += 100;
        }
      }
    } finally {
      if (observer) {
        try { observer.disconnect(); } catch (_) {}
      }
    }
  };

  // ── Milestone 3: Semantic Diffing & Anti-Blind-Trust (H8) ────────────────────
  const captureSemanticSnapshot = () => {
    const url = typeof window !== "undefined" && window.location ? window.location.href.split(/[?#]/)[0] : "";
    const pathname = typeof window !== "undefined" && window.location ? window.location.pathname : "";

    let elements = [];
    if (typeof window !== "undefined" && window.AtlasSerializer?.serialize) {
      try {
        elements = window.AtlasSerializer.serialize();
      } catch (_) {
        elements = [];
      }
    }

    const authRegex = /\b(sign[\s-_]?in|log[\s-_]?in|sign[\s-_]?up|register|authenticate|authorize|connect|oauth)\b/i;
    const userRegex = /\b(sign[\s-_]?out|log[\s-_]?out|my\s*account|profile|dashboard|avatar|user[-_ ]?menu|settings|welcome)\b/i;

    const authElements = [];
    const userElements = [];

    if (Array.isArray(elements) && elements.length > 0) {
      for (const el of elements) {
        const text = [el.resolved_label, el.inner_text, el.aria_label, el.href].filter(Boolean).join(" ");
        if (authRegex.test(text)) {
          authElements.push(`${el.tag}:${el.role || ""}:${text.slice(0, 40)}`);
        }
        if (userRegex.test(text)) {
          userElements.push(`${el.tag}:${el.role || ""}:${text.slice(0, 40)}`);
        }
      }
    } else if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
      const buttonsAndLinks = document.querySelectorAll("button, a, [role='button'], [role='link']");
      for (const el of buttonsAndLinks) {
        const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
        if (authRegex.test(text)) {
          authElements.push(`${el.tagName?.toLowerCase() || ""}:${text.slice(0, 40)}`);
        }
        if (userRegex.test(text)) {
          userElements.push(`${el.tagName?.toLowerCase() || ""}:${text.slice(0, 40)}`);
        }
      }
    }

    if (typeof document !== "undefined" && typeof document.querySelector === "function") {
      const authStatusEl = document.querySelector('[data-authenticated="true"]');
      const authSuccessBadge = document.querySelector('.alert-success, [role="status"]');
      if (authStatusEl || (authSuccessBadge && authSuccessBadge.style?.display !== "none" && !authSuccessBadge.hidden)) {
        userElements.push("dom:authenticated_marker");
      }
    }

    return {
      timestamp: Date.now(),
      url,
      pathname,
      authElements,
      userElements,
      interactiveCount: elements.length,
    };
  };

  const diffSemanticSnapshots = (baseline, current) => {
    if (!baseline || !current) {
      return { verified: false, reason: "NO_BASELINE", confidence: 0 };
    }

    // 1. Pathname transition away from login/auth (High Confidence)
    if (baseline.pathname !== current.pathname && !/login|signin|auth/i.test(current.pathname)) {
      return {
        verified: true,
        confidence: 0.95,
        reason: "PATHNAME_TRANSITION",
        details: `Path transitioned from '${baseline.pathname}' to '${current.pathname}'`,
      };
    }

    // 2. Auth entry removed AND user session control emerged (Golden Auth Swap)
    const authDecreased = baseline.authElements.length > 0 && current.authElements.length === 0;
    const userIncreased = current.userElements.length > baseline.userElements.length;

    if (authDecreased && userIncreased) {
      return {
        verified: true,
        confidence: 0.98,
        reason: "AUTH_SWAP_VERIFIED",
        details: "Sign-in controls were replaced by user session/logout controls",
      };
    }

    // 3. User elements emerged (e.g. Avatar / My Account menu added)
    if (userIncreased) {
      return {
        verified: true,
        confidence: 0.90,
        reason: "USER_CONTROLS_EMERGED",
        details: "New user profile or logout controls detected on opener",
      };
    }

    // 4. Auth controls completely removed (e.g. login form disappeared)
    if (authDecreased) {
      return {
        verified: true,
        confidence: 0.85,
        reason: "AUTH_CONTROLS_REMOVED",
        details: "Sign-in controls are no longer present on opener",
      };
    }

    // 5. No semantic change detected -> Ambiguous or Premature Close
    return {
      verified: false,
      confidence: 0.05,
      reason: "NO_SEMANTIC_CHANGE",
      details: "Opener DOM unchanged; no evidence of completed action",
    };
  };

  const handleChildTabClosed = async (message = {}) => {
    console.log("Atlas: Reclaimed lease tab notified child popup closed:", message);
    try {
      await waitForNavigationSettle(1500, currentAbortController?.signal);
    } catch (_) {}

    const baseline = window.__atlasBaselineSnapshot;
    const currentSnapshot = captureSemanticSnapshot();
    const diffResult = diffSemanticSnapshots(baseline, currentSnapshot);

    console.log("Atlas: Semantic diff result on popup close:", diffResult);

    if (diffResult.verified) {
      window.AtlasSidebar?.setStatus("State change verified", "ok");
      window.AtlasSidebar?.addChatMessage("agent", `✅ Verified: ${diffResult.details}`);
      if (currentGoalState) {
        isExecuting = true;
        window.AtlasSidebar?.setExecuting?.(true);
        await executeGoalHop(currentGoalState);
      }
    } else {
      // Invariant: NEVER claim goal success without verified state change!
      window.AtlasSidebar?.setStatus("Confirmation required", "info");
      window.AtlasSidebar?.addChatMessage(
        "agent",
        "The popup was closed, but we couldn't verify changes on this page. Did you finish signing in / completing this step?",
        {
          actions: [
            { label: "Yes, continue", value: "yes" },
            { label: "No, retry", value: "no" }
          ],
          onAction: async (choice) => {
            if (choice === "yes") {
              window.AtlasSidebar?.setStatus("Resuming goal...", "info");
              if (currentGoalState) {
                isExecuting = true;
                window.AtlasSidebar?.setExecuting(true);
                await executeGoalHop(currentGoalState);
              }
            } else {
              window.AtlasSidebar?.setStatus("Goal paused for retry", "info");
              window.AtlasSidebar?.addChatMessage("agent", "Goal paused. Please reopen the authentication window or retry the step when ready.");
              isExecuting = false;
              window.AtlasSidebar?.setExecuting(false);
            }
          }
        }
      );
    }
  };

  // ── Milestone 3: Yield to Human Agency (H21) ─────────────────────────────────
  let isPausedForHuman = false;

  const onHumanInteraction = (e) => {
    if (!e || !e.isTrusted || !isExecuting || isPausedForHuman) return;

    // Filter Atlas internal UI events
    const target = e.target;
    if (target && typeof target.closest === "function") {
      if (target.closest("#atlas-sidebar-host") || target.closest("#atlas-sidebar-root")) {
        return;
      }
    }

    // Filter modifier-only keystrokes
    if (e.type === "keydown") {
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
      if (e.altKey && (e.code === "KeyA" || e.code === "KeyV" || e.key === "a" || e.key === "v")) return;
    }

    console.log(`Atlas: Yielding to human agency on trusted ${e.type} event.`);
    isPausedForHuman = true;

    // 1. Abort in-flight hop/request without wiping goalState
    if (currentAbortController) {
      try {
        currentAbortController.abort();
      } catch (_) {}
    }

    // 2. Stop voice output
    try {
      window.AtlasTTS?.stop?.();
      window.AtlasSpeech?.stop?.();
    } catch (_) {}

    // 3. Update Sidebar UI
    window.AtlasSidebar?.setExecuting?.(false);
    window.AtlasSidebar?.setStatus?.("Paused for human interaction", "info");
    window.AtlasSidebar?.addChatMessage?.(
      "agent",
      "⏸️ Paused for human interaction. Click Resume when ready."
    );
    window.AtlasSidebar?.showResumeButton?.(() => resumeAfterHumanAgency());
  };

  const resumeAfterHumanAgency = async () => {
    if (!isPausedForHuman) return;
    console.log("Atlas: Resuming execution following human interaction.");
    isPausedForHuman = false;
    isExecuting = true;
    currentAbortController = new AbortController();

    window.AtlasSidebar?.hideResumeButton?.();
    window.AtlasSidebar?.setExecuting?.(true);
    window.AtlasSidebar?.setStatus?.("Resuming goal...", "info");
    window.AtlasSidebar?.addChatMessage?.("agent", "▶️ Resuming goal execution.");

    if (currentGoalState) {
      await executeGoalHop(currentGoalState);
    }
  };

  // ── Milestone 3: Popup Blocker Interception & Assisted Click (H6) ────────────
  let isAssistedClickAwaiting = false;

  const handlePopupBlocked = (e) => {
    const detail = e?.detail || {};
    console.warn("Atlas: Intercepted blocked popup window:", detail);

    // Retrieve active target element from executor (lastActionElement) or semantic heuristics
    let targetEl = null;
    if (window.AtlasExecutor?.getLastActionElement) {
      targetEl = window.AtlasExecutor.getLastActionElement();
    }
    if (!targetEl && typeof document !== "undefined") {
      targetEl = document.querySelector("[aria-haspopup='true'], [role='button'][aria-expanded], a[target='_blank']");
    }

    isAssistedClickAwaiting = true;

    window.AtlasSidebar?.showAssistedClickPrompt?.({
      message: "Browser popup was blocked. Please click the glowing button to open the authentication window.",
      targetEl,
      onUserClick: (clickEvent) => {
        isAssistedClickAwaiting = false;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({ type: "ATLAS_ARM_CAUSAL_WINDOW", windowMs: 3000 });
          } catch (_) {}
        }
        window.AtlasSidebar?.hideAssistedClickPrompt?.(targetEl);
        window.AtlasSidebar?.setStatus?.("Popup opened. Continuing...", "info");
        if (detail?.url) {
          try {
            window.open(detail.url, detail.target || "_blank", detail.features || "");
          } catch (_) {}
        }
        if (currentGoalState && !isExecuting) {
          isExecuting = true;
          executeGoalHop(currentGoalState);
        }
      }
    });
  };

  // ── Milestone 3: Browser-Native Auth Guidance (H17) ──────────────────────────
  let isGuidedAuthMode = false;

  const handleNativeAuthStart = (e) => {
    const detail = e?.detail || {};
    console.log("Atlas: Native credential ceremony started:", detail);
    isGuidedAuthMode = true;

    window.AtlasSidebar?.setGuidedAuthMode?.(true, detail);
  };

  const handleNativeAuthEnd = (e) => {
    const detail = e?.detail || {};
    console.log("Atlas: Native credential ceremony ended:", detail);
    isGuidedAuthMode = false;

    window.AtlasSidebar?.setGuidedAuthMode?.(false, detail);

    // Concurrency guard: Do not launch a second loop if already executing or in flight
    if (!isExecuting && !isHopInProgress && currentGoalState && detail.success) {
      isExecuting = true;
      window.AtlasSidebar?.setExecuting?.(true);
      executeGoalHop(currentGoalState);
    }
  };

  const renderAwaitingUserInputForm = (awaitingRequest, onSubmitCallback) => {
    if (!awaitingRequest || !Array.isArray(awaitingRequest.fields) || awaitingRequest.fields.length === 0) {
      return;
    }
    const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
    const chatLog = shadowRoot?.querySelector?.(".atlas-chat-log");
    if (!chatLog) return;

    const existing = chatLog.querySelector(".atlas-user-input-form-card");
    if (existing) existing.remove();

    const formCard = document.createElement("div");
    formCard.className = "atlas-user-input-form-card";
    formCard.setAttribute("dir", "auto");
    formCard.style.cssText = "background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin: 8px 0; font-size: 13px;";

    const form = document.createElement("form");
    form.noValidate = true;

    awaitingRequest.fields.forEach((field, idx) => {
      const group = document.createElement("div");
      group.style.cssText = "margin-bottom: 8px;";

      const label = document.createElement("label");
      label.setAttribute("dir", "auto");
      label.style.cssText = "display: block; font-weight: 600; margin-bottom: 4px; color: #1e293b;";
      label.textContent = field.label || field.ref || `Field ${idx + 1}`;
      if (field.required) {
        const reqSpan = document.createElement("span");
        reqSpan.style.color = "#dc2626";
        reqSpan.textContent = " *";
        label.appendChild(reqSpan);
      }
      group.appendChild(label);

      let inputEl;
      const isSensitive = Boolean(field.sensitive || ["password", "otp", "pin", "ssn", "cc_number"].includes(field.kind));

      if (field.kind === "select" && Array.isArray(field.options) && field.options.length > 0) {
        inputEl = document.createElement("select");
        field.options.forEach((opt) => {
          const optEl = document.createElement("option");
          optEl.value = opt;
          optEl.textContent = opt;
          inputEl.appendChild(optEl);
        });
      } else {
        inputEl = document.createElement("input");
        if (isSensitive) {
          inputEl.type = "password";
          inputEl.autocomplete = "off";
        } else if (field.kind === "number") {
          inputEl.type = "number";
        } else if (field.kind === "email") {
          inputEl.type = "email";
        } else {
          inputEl.type = "text";
        }
        if (field.pattern) inputEl.pattern = field.pattern;
        if (field.maxlength) inputEl.maxLength = field.maxlength;
      }

      inputEl.setAttribute("dir", "auto");
      inputEl.className = "atlas-input-field";
      inputEl.dataset.fieldRef = field.ref;
      inputEl.dataset.kind = field.kind || "text";
      inputEl.dataset.sensitive = isSensitive ? "true" : "false";
      inputEl.style.cssText = "width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px;";

      group.appendChild(inputEl);
      form.appendChild(group);
    });

    const btn = document.createElement("button");
    btn.type = "submit";
    btn.className = "atlas-form-submit-btn";
    btn.setAttribute("dir", "auto");
    const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
    btn.textContent = activeLang.startsWith("ar") ? "إرسال البيانات" : "Submit Details";
    btn.style.cssText = "width: 100%; background: #0284c7; color: #ffffff; border: none; padding: 8px; border-radius: 4px; font-weight: 600; cursor: pointer; margin-top: 4px;";
    form.appendChild(btn);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const userInputs = {};
      const origin = window.location.origin || "";

      // Clear any prior inline errors
      form.querySelectorAll(".atlas-inline-error").forEach((el) => el.remove());
      form.querySelectorAll(".atlas-input-field").forEach((el) => {
        el.style.borderColor = "#cbd5e1";
      });

      const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
      const isArabic = activeLang.startsWith("ar");
      let hasError = false;

      // Validate all fields client-side before tokenizing or submitting
      for (const field of awaitingRequest.fields) {
        const safeRef = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field.ref) : field.ref.replace(/["\\]/g, "\\$&");
        const input = form.querySelector(`[data-field-ref="${safeRef}"]`);
        const rawVal = input ? input.value.trim() : "";

        let errorMsg = null;
        if (field.required && !rawVal) {
          errorMsg = isArabic ? "هذا الحقل مطلوب." : "This field is required.";
        } else if (rawVal && field.maxlength && rawVal.length > field.maxlength) {
          errorMsg = isArabic
            ? `الحد الأقصى ${field.maxlength} أحرف.`
            : `Maximum length is ${field.maxlength} characters.`;
        } else if (rawVal && field.pattern) {
          try {
            const regex = new RegExp(`^(?:${field.pattern})$`);
            if (!regex.test(rawVal)) {
              errorMsg = isArabic ? "القيمة المدخلة غير صحيحة." : "Invalid format.";
            }
          } catch (_) {}
        }

        if (errorMsg && input) {
          hasError = true;
          input.style.borderColor = "#dc2626";
          const errDiv = document.createElement("div");
          errDiv.className = "atlas-inline-error";
          errDiv.style.cssText = "color: #dc2626; font-size: 11px; margin-top: 2px;";
          errDiv.textContent = errorMsg;
          input.parentNode.appendChild(errDiv);
        }
      }

      if (hasError) {
        btn.disabled = false;
        const firstErr = form.querySelector(".atlas-inline-error");
        if (firstErr && firstErr.previousElementSibling) {
          firstErr.previousElementSibling.focus?.();
        }
        return;
      }

      for (const field of awaitingRequest.fields) {
        const safeRef = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field.ref) : field.ref.replace(/["\\]/g, "\\$&");
        const input = form.querySelector(`[data-field-ref="${safeRef}"]`);
        const rawVal = input ? input.value.trim() : "";
        const isSensitive = input?.dataset?.sensitive === "true";
        const kind = input?.dataset?.kind || "text";

        if (isSensitive) {
          if (rawVal) {
            if (!window.AtlasSecretVault?.store) {
              const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
              const vaultErrMsg = activeLang.startsWith("ar")
                ? "تعذر تشفير وحفظ البيانات الحساسة: خدمة الخزنة غير متاحة."
                : "Unable to secure sensitive data: Secret Vault is unavailable.";
              window.AtlasSidebar?.setStatus?.("Vault unavailable", "error");
              window.AtlasSidebar?.addChatMessage?.("agent", `⚠️ ${vaultErrMsg}`);
              btn.disabled = false;
              return;
            }
            try {
              const category = ["password", "otp", "pin", "ssn", "cc_number"].includes(kind) ? kind : "secret";
              const token = await window.AtlasSecretVault.store(origin, category, field.ref, rawVal);
              userInputs[field.ref] = token;
            } catch (err) {
              const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
              const vaultErrMsg = activeLang.startsWith("ar")
                ? "فشل تشفير البيانات الحساسة داخل الخزنة."
                : "Failed to encrypt sensitive data in Secret Vault.";
              window.AtlasSidebar?.setStatus?.("Vault error", "error");
              window.AtlasSidebar?.addChatMessage?.("agent", `⚠️ ${vaultErrMsg}`);
              btn.disabled = false;
              return;
            }
          }
        } else {
          userInputs[field.ref] = rawVal;
        }

        // Clear form inputs after submit (Defense in Depth)
        if (input) input.value = "";
      }

      formCard.remove();
      // Masked confirmation without logging or speaking raw values
      window.AtlasSidebar?.addChatMessage?.("user", "•••••••• (Submitted)");
      onSubmitCallback(userInputs);
    });

    formCard.appendChild(form);
    chatLog.appendChild(formCard);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  let isHopInProgress = false;

  const executeGoalHop = async (goalState) => {
    if (!goalState) return;
    if (isHopInProgress) {
      console.warn("Atlas: executeGoalHop already in flight; ignoring concurrent request");
      return;
    }
    isHopInProgress = true;

    // Enforce budgets & bounds (§R2 / §H9)
    const budget = goalState.budget || {};
    const maxHandoffs = budget.max_handoffs || 4;
    const handoffCount = budget.handoff_count || 0;
    const maxHops = goalState.max_hops || 15;

    if (goalState.hop_count && goalState.hop_count >= maxHops) {
      const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
      const limitMsg = activeLang.startsWith("ar")
        ? `تم إيقاف الهدف: تم الوصول للحد الأقصى للخطوات (${maxHops}).`
        : `Goal execution stopped: reached maximum allowed hops limit (${maxHops}).`;
      window.AtlasSidebar?.setStatus?.("Goal stopped: Max hops reached", "error");
      window.AtlasSidebar?.addChatMessage?.("agent", `🛑 ${limitMsg}`);
      speakIfVoiceMode(limitMsg);
      isExecuting = false;
      isHopInProgress = false;
      currentGoalState = null;
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "ATLAS_GOAL_STORE_CLEAR" });
      }
      return;
    }

    if (budget.max_llm_calls && budget.llm_calls >= budget.max_llm_calls) {
      window.AtlasSidebar?.setStatus("Goal stopped: LLM budget exceeded", "error");
      window.AtlasSidebar?.addChatMessage("agent", "🛑 Goal stopped: LLM budget exceeded.");
      isExecuting = false;
      isHopInProgress = false;
      return;
    }
    if (handoffCount >= maxHandoffs) {
      window.AtlasSidebar?.setStatus("Goal stopped: Maximum tab handoffs reached", "error");
      window.AtlasSidebar?.addChatMessage("agent", "🛑 Goal stopped: Maximum tab handoffs reached.");
      isExecuting = false;
      isHopInProgress = false;
      return;
    }

    isExecuting = true;
    currentAbortController = new AbortController();
    window.AtlasSidebar?.setExecuting(true);
    window.AtlasSidebar?.setGoalProgress(goalState);

    try {
      // Settle window: wait for navigation/redirects to quiet down before DOM perception
      await waitForNavigationSettle(5000, currentAbortController.signal);
      if (!isExecuting || currentAbortController.signal.aborted) return;

      const { apiKey, baseUrl } = await getStoredSettings();
      const domMap = window.AtlasSerializer.serialize();
      const pageText = getPageText();

      // Clean URL before sending (§R2 / §H10)
      const rawUrl = typeof window !== "undefined" ? window.location.href : "";
      const currentUrl = redactUrl(rawUrl);
      const activeLang = window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || goalState.language || "en-US";

      const requestPayload = {
        goal: goalState.goal || "",
        current_url: currentUrl,
        url: currentUrl,
        dom_map: domMap,
        page_text: pageText,
        goal_state: goalState,
        contract_version: 3,
        language: activeLang,
        capabilities: ["switch_tab", "tab_context", "assisted_click"],
      };

      if (pendingUserResponse !== null && pendingUserResponse !== undefined) {
        requestPayload.user_response = pendingUserResponse;
        pendingUserResponse = null;
      }
      if (pendingUserInputs && Object.keys(pendingUserInputs).length > 0) {
        requestPayload.user_inputs = pendingUserInputs;
        pendingUserInputs = null;
      }
      if (lastActionResult) {
        requestPayload.last_action_result = lastActionResult;
        lastActionResult = null;
      }

      // Sync goalState into background GoalStore before hop
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            type: "ATLAS_GOAL_STORE_PUT",
            goalState: goalState,
          });
        } catch (_) {}
      }

      // Proxy request via background service worker (§R2 / §H5)
      let data = null;

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        data = await new Promise((resolve, reject) => {
          let responded = false;
          const onAbort = () => {
            if (!responded) {
              responded = true;
              reject(new DOMException("Aborted", "AbortError"));
            }
          };
          currentAbortController.signal.addEventListener("abort", onAbort, { once: true });

          try {
            chrome.runtime.sendMessage(
              {
                type: "ATLAS_GOAL_STEP",
                baseUrl,
                apiKey: apiKey || "",
                payload: requestPayload,
                leaseEpoch: window.__atlasLeaseEpoch || 1,
                sessionId: window.__atlasSessionId || null,
              },
              (res) => {
                if (responded) return;
                responded = true;
                if (chrome.runtime.lastError) {
                  return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!res || !res.ok) {
                  return reject(new Error(res?.error || "Goal step failed"));
                }
                resolve(res.data);
              }
            );
          } catch (e) {
            responded = true;
            reject(e);
          }
        });
      } else {
        throw new Error("Atlas: Background service worker unavailable for goal_step");
      }

      if (!isExecuting || currentAbortController.signal.aborted) return;

      if (data.goal_state) {
        currentGoalState = data.goal_state;
        window.AtlasSidebar?.setGoalProgress(data.goal_state);
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({
              type: "ATLAS_GOAL_STORE_PUT",
              goalState: currentGoalState,
            });
          } catch (_) {}
        }
      }

      if (!window.__atlasBaselineSnapshot) {
        window.__atlasBaselineSnapshot = captureSemanticSnapshot();
      }

      // Step execution loop with 3-repetition safety guard
      const stepsToExecute = Array.isArray(data.steps) && data.steps.length > 0
        ? data.steps
        : (data.action ? [data.action] : []);

      if (stepsToExecute.length > 0) {
        window.AtlasSidebar?.setAutoHide?.(true);
        try {
          for (let i = 0; i < stepsToExecute.length; i++) {
            if (!isExecuting || currentAbortController.signal.aborted) break;
            const step = stepsToExecute[i];
            const computeDomHash = (nodes) => {
              const visibleIds = (nodes || [])
                .filter((n) => n && n.visible !== false && n.id != null)
                .map((n) => n.id)
                .join(",");
              let hash = 5381;
              for (let idx = 0; idx < visibleIds.length; idx++) {
                hash = (hash << 5) + hash + visibleIds.charCodeAt(idx);
                hash = hash & hash;
              }
              return (hash >>> 0).toString(16);
            };
            const pageHash = computeDomHash(domMap);
            const stepTarget = step.element_id || step.target || "";
            const sig = `${step.action}:${stepTarget}:${currentUrl}:${pageHash}`;

            if (sig === recentStepSignature) {
              stepRepeatCount++;
              if (stepRepeatCount >= 3) {
                console.warn("Atlas: Repeated step detected 3 times on same element, aborting loop.");
                const activeLang = window.AtlasSidebar?.getLanguage?.() || "en-US";
                const abortMsg = activeLang.startsWith("ar")
                  ? "تم إيقاف تنفيذ الهدف: تكرر نفس الإجراء على العنصر 3 مرات دون تقدم."
                  : "Goal execution stopped: the same action was repeated 3 times without progress.";
                window.AtlasSidebar?.setStatus?.("Goal stopped", "error");
                window.AtlasSidebar?.addChatMessage?.("agent", `🛑 ${abortMsg}`);
                speakIfVoiceMode(abortMsg);
                isExecuting = false;
                isHopInProgress = false;
                currentGoalState = null;
                recentStepSignature = null;
                stepRepeatCount = 0;
                if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                  chrome.runtime.sendMessage({ type: "ATLAS_GOAL_STORE_CLEAR" });
                }
                return;
              }
            } else {
              recentStepSignature = sig;
              stepRepeatCount = 1;
            }

            const stepResult = await window.AtlasExecutor.executeStep(step);
            lastActionResult = stepResult || null;
            await interruptibleSleep(step.delay_ms || 600, currentAbortController.signal);
          }
        } finally {
          window.AtlasSidebar?.setAutoHide?.(false);
        }
      }

      // Handle tab switching if returned by backend and handoff budget permits
      if (data.switch_tab_id) {
        const currentHandoff = data.goal_state?.budget?.handoff_count || 0;
        if (currentHandoff >= maxHandoffs) {
          window.AtlasSidebar?.setStatus("Goal stopped: Maximum tab handoffs reached", "error");
          window.AtlasSidebar?.addChatMessage("agent", "🛑 Goal stopped: Maximum tab handoffs reached.");
          isExecuting = false;
          return;
        }
        if (data.goal_state?.budget) {
          data.goal_state.budget.handoff_count = currentHandoff + 1;
        }
      }

      // Terminal and interactive statuses
      if (data.status === "goal_complete" || data.goal_state?.status === "goal_complete") {
        window.AtlasSidebar?.setStatus("Goal complete!", "ok");
        const completeMsg = data.reply || "Goal complete!";
        window.AtlasSidebar?.addChatMessage("agent", completeMsg);
        speakIfVoiceMode(completeMsg);
        window.AtlasSidebar?.hideGoalProgress();
        isExecuting = false;
        isHopInProgress = false;
        currentGoalState = null;
        recentStepSignature = null;
        stepRepeatCount = 0;
        window.__atlasBaselineSnapshot = null;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "ATLAS_GOAL_STORE_CLEAR" });
        }
        return;
      }

      if (data.status === "goal_failed" || data.goal_state?.status === "goal_failed") {
        window.AtlasSidebar?.setStatus("Goal failed", "error");
        const failMsg = data.reply || data.goal_state?.error_message || "Goal could not be completed.";
        window.AtlasSidebar?.addChatMessage("agent", failMsg);
        speakIfVoiceMode(failMsg);
        window.AtlasSidebar?.hideGoalProgress();
        isExecuting = false;
        isHopInProgress = false;
        currentGoalState = null;
        recentStepSignature = null;
        stepRepeatCount = 0;
        window.__atlasBaselineSnapshot = null;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "ATLAS_GOAL_STORE_CLEAR" });
        }
        return;
      }

      if (data.status === "requires_confirmation" || data.requires_confirmation || data.goal_state?.requires_confirmation) {
        if (currentGoalState) {
          currentGoalState.requires_confirmation = true;
        }
        isExecuting = false;
        isHopInProgress = false;
        window.AtlasSidebar?.setExecuting?.(false);
        const confirmText = data.confirmation_prompt || data.reply || "Would you like to proceed with this action?";
        const options = data.confirmation_options || ["Yes, proceed", "No, cancel"];
        window.AtlasSidebar?.setStatus?.("Awaiting confirmation", "info");
        window.AtlasSidebar?.addChatMessage?.("agent", confirmText, {
          actions: options,
          onAction: (choice) => {
            window.AtlasSidebar?.addChatMessage?.("user", choice);
            // WS5: Decide by option index (options[0] = proceed), language-agnostic
            const idx = options.findIndex((opt) => {
              const label = typeof opt === "string" ? opt : (opt.value || opt.label);
              return label === choice;
            });
            const isAffirmative = idx === 0;
            if (currentGoalState) {
              currentGoalState.requires_confirmation = false;
            }
            pendingUserResponse = isAffirmative ? "yes" : "no";
            isExecuting = true;
            window.AtlasSidebar?.setExecuting?.(true);
            executeGoalHop(currentGoalState);
          },
        });
        speakIfVoiceMode(confirmText);
        return;
      }

      if (data.status === "awaiting_user_input" || data.goal_state?.status === "awaiting_user_input") {
        isExecuting = false;
        isHopInProgress = false;
        window.AtlasSidebar?.setExecuting?.(false);
        const awaitingReq = data.goal_state?.awaiting || data.awaiting;
        const promptText = awaitingReq?.prompt || data.reply || "Please provide the required details:";
        window.AtlasSidebar?.setStatus?.("Awaiting input", "info");
        window.AtlasSidebar?.addChatMessage?.("agent", promptText);
        speakIfVoiceMode(promptText);

        if (awaitingReq && Array.isArray(awaitingReq.fields) && awaitingReq.fields.length > 0) {
          renderAwaitingUserInputForm(awaitingReq, (userInputs) => {
            pendingUserInputs = userInputs;
            isExecuting = true;
            window.AtlasSidebar?.setExecuting?.(true);
            executeGoalHop(currentGoalState);
          });
        }
        return;
      }

      if (isExecuting && data.goal_state?.status === "in_progress") {
        if ((data.goal_state?.budget?.handoff_count || 0) >= maxHandoffs) {
          window.AtlasSidebar?.setStatus("Goal stopped: Maximum tab handoffs reached", "error");
          window.AtlasSidebar?.addChatMessage("agent", "🛑 Goal stopped: Maximum tab handoffs reached.");
          isExecuting = false;
          isHopInProgress = false;
          return;
        }
        isHopInProgress = false;
        await executeGoalHop(data.goal_state);
        return;
      }
    } catch (err) {
      if (err.name === "AbortError" || !isExecuting) {
        console.log("Atlas: Goal step aborted");
      } else {
        console.error("Atlas: Goal step failed", err);
        window.AtlasSidebar?.setStatus(`Goal error: ${err.message}`, "error");
      }
    } finally {
      isHopInProgress = false;
      if (!isExecuting) {
        window.AtlasSidebar?.setExecuting(false);
        window.AtlasSidebar?.hideGoalProgress();
      }
    }
  };


  // ── Universal Language Switcher Pre-Scanner (W3C / Prime Directive) ──────
  const AtlasLanguageSwitcher = {
    getStoredOriginPref: async () => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "";
      if (!origin) return null;
      const key = `atlas_lang_pref:${origin}`;
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (res) => resolve(res?.[key] || null));
      });
    },

    setStoredOriginPref: async (lang) => {
      if (typeof chrome === "undefined" || !chrome.storage?.local || !lang)
        return;
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "";
      if (!origin) return;
      const key = `atlas_lang_pref:${origin}`;
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: lang }, () => resolve());
      });
    },

    scan: (targetLang) => {
      if (!targetLang || typeof document === "undefined" || !document.body) {
        return { found: false, element: null, type: null };
      }
      const isArabic =
        targetLang === "ar" ||
        targetLang.startsWith("ar-") ||
        targetLang.startsWith("ar_") ||
        /[\u0600-\u06FF]/.test(targetLang);

      // 1. Scan dropdown select elements
      const selects = Array.from(
        document.querySelectorAll(
          'select[name*="lang" i], select[id*="lang" i], select[aria-label*="lang" i], select[aria-label*="لغة" i], select[title*="lang" i], select[title*="لغة" i], select[data-action*="lang" i], select',
        ),
      );
      for (const sel of selects) {
        if (sel.closest("#atlas-sidebar-root") || sel.closest("#atlas-sidebar-host")) continue;
        for (const opt of Array.from(sel.options)) {
          const val = (opt.value || "").toLowerCase().trim();
          const txt = (opt.text || opt.textContent || "").toLowerCase().trim();
          const matches = isArabic
            ? val === "ar" ||
              val.startsWith("ar-") ||
              val.startsWith("ar_") ||
              val === "ara" ||
              txt.includes("عربي") ||
              txt.includes("العربية") ||
              /\barabic\b/i.test(txt)
            : val === "en" ||
              val.startsWith("en-") ||
              val.startsWith("en_") ||
              val === "eng" ||
              txt.includes("english") ||
              txt.includes("إنجليزي") ||
              txt.includes("انجليزي") ||
              /\benglish\b/i.test(txt);

          if (matches) {
            return {
              found: true,
              element: sel,
              type: "select",
              optionValue: opt.value,
              alreadyActive: sel.value === opt.value,
            };
          }
        }
      }

      // 2. Scan hreflang attributes on links
      const hrefLinks = Array.from(document.querySelectorAll("a[hreflang]"));
      for (const el of hrefLinks) {
        if (el.closest("#atlas-sidebar-root") || el.closest("#atlas-sidebar-host")) continue;
        const hreflang = (
          el.getAttribute("hreflang") || ""
        )
          .toLowerCase()
          .trim();
        const matches = isArabic
          ? hreflang === "ar" ||
            hreflang.startsWith("ar-") ||
            hreflang.startsWith("ar_")
          : hreflang === "en" ||
            hreflang.startsWith("en-") ||
            hreflang.startsWith("en_");
        if (matches) {
          return { found: true, element: el, type: "link" };
        }
      }

      // 3. Scan lang attributes on interactive elements
      const langEls = Array.from(
        document.querySelectorAll(
          'a[lang], button[lang], [role="button"][lang], [role="link"][lang], [role="menuitem"][lang]',
        ),
      );
      for (const el of langEls) {
        if (el.closest("#atlas-sidebar-root") || el.closest("#atlas-sidebar-host")) continue;
        const langAttr = (el.getAttribute("lang") || "").toLowerCase().trim();
        const matches = isArabic
          ? langAttr === "ar" ||
            langAttr.startsWith("ar-") ||
            langAttr.startsWith("ar_")
          : langAttr === "en" ||
            langAttr.startsWith("en-") ||
            langAttr.startsWith("en_");
        if (matches) {
          return { found: true, element: el, type: "lang_attr" };
        }
      }

      // 4. Scan interactive elements with ARIA / text indicators
      const candidates = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], [role="link"], [role="menuitem"], [data-action*="lang" i], [data-lang], [data-language]',
        ),
      );
      for (const el of candidates) {
        if (el.closest("#atlas-sidebar-root") || el.closest("#atlas-sidebar-host")) continue;
        const text = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const dataLang = (
          el.getAttribute("data-lang") ||
          el.getAttribute("data-language") ||
          ""
        )
          .toLowerCase()
          .trim();

        const combined = `${text} ${aria} ${title}`.toLowerCase();

        const matches = isArabic
          ? dataLang === "ar" ||
            dataLang.startsWith("ar-") ||
            dataLang.startsWith("ar_") ||
            /^(العربية|عربي|arabic|ar)$/i.test(text) ||
            combined.includes("العربية") ||
            combined.includes("عربي") ||
            /\barabic\b/i.test(combined)
          : dataLang === "en" ||
            dataLang.startsWith("en-") ||
            dataLang.startsWith("en_") ||
            /^(english|en|انجليزي|إنجليزي)$/i.test(text) ||
            combined.includes("english") ||
            combined.includes("انجليزي") ||
            combined.includes("إنجليزي") ||
            /\benglish\b/i.test(combined);

        if (matches) {
          return { found: true, element: el, type: "interactive" };
        }
      }

      return { found: false, element: null, type: null };
    },

    detectAndSwitch: async (targetLang) => {
      if (!targetLang) return false;
      const match = AtlasLanguageSwitcher.scan(targetLang);
      if (!match.found || !match.element) return false;

      try {
        if (match.type === "select") {
          if (!match.alreadyActive && match.optionValue !== undefined) {
            match.element.value = match.optionValue;
            match.element.dispatchEvent(new Event("change", { bubbles: true }));
            match.element.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } else {
          match.element.click();
        }
        await AtlasLanguageSwitcher.setStoredOriginPref(targetLang);
        return true;
      } catch (err) {
        console.warn("Atlas: Failed to switch language", err);
        return false;
      }
    },
  };

  // ── Unified Agentic Conversation & Multi-Step Execution Pipeline ─────────
  const handleChatInput = async (text) => {
    const rawInput = (text || "").trim();
    if (!rawInput) return;

    // Stop ongoing speech before handling new input
    window.AtlasTTS?.stop();

    // WS5: While currentGoalState status is awaiting_user_input or requires_confirmation,
    // typed or spoken chat goes to goal_step as user_response, not to /v1/chat.
    // Covers captcha/otp prompts that have no fields ("done"/"خلصت" resumes).
    if (
      currentGoalState &&
      (currentGoalState.status === "awaiting_user_input" || currentGoalState.requires_confirmation === true || pendingConfirmation)
    ) {
      let responseText = rawInput;
      if (window.AtlasSecretVault?.tokenizeCommand) {
        try {
          const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
          const domMap = window.AtlasSerializer?.serialize?.() || [];
          const tokenized = await window.AtlasSecretVault.tokenizeCommand(origin, rawInput, domMap);
          responseText = tokenized.command || rawInput;
        } catch (_) {}
      }
      window.AtlasSidebar?.addChatMessage?.("user", responseText);

      if (currentGoalState.requires_confirmation || pendingConfirmation) {
        currentGoalState.requires_confirmation = false;
        pendingConfirmation = null;
        const norm = responseText.trim().toLowerCase();
        const isAffirmative = /^(yes|sure|proceed|confirm|go ahead|ok|continue|y|yeah|yep|أيوة|ايوة|نعم|تمام|موافق|ماشي|تأكيد|استمر|كمل)\b/i.test(norm) || norm === "أيوة" || norm === "ايوة" || norm === "نعم";
        const isNegative = /^(no|cancel|stop|abort|don't|dont|لا|الغي|إلغي|توقف|الغاء|إلغاء)\b/i.test(norm) || norm === "لا";
        pendingUserResponse = isAffirmative ? "yes" : (isNegative ? "no" : responseText);
      } else {
        pendingUserResponse = responseText;
      }

      isExecuting = true;
      window.AtlasSidebar?.setExecuting?.(true);
      window.AtlasSidebar?.setStatus?.("Resuming goal...", "info");
      await executeGoalHop(currentGoalState);
      return;
    }

    const lowerInput = rawInput.toLowerCase();

    // 1. Handle Pending Confirmation State
    if (pendingConfirmation) {
      const isAffirmative = /^(yes|sure|proceed|place order|confirm|go ahead|ok|do it|please do|yeah|yep|continue)\b/i.test(lowerInput);
      const isNegative = /^(no|cancel|stop|never mind|don't|dont|wait|abort)\b/i.test(lowerInput);

      if (isAffirmative) {
        window.AtlasSidebar.setStatus("Completing action...", "info");
        window.AtlasSidebar.addChatThinking();

        const actionToExecute = pendingConfirmation.action;
        const successMsg = pendingConfirmation.successMessage || "Done! Action completed.";
        pendingConfirmation = null;

        try {
          if (actionToExecute) {
            await window.AtlasExecutor.executeStep(actionToExecute);
          }
          await new Promise((r) => setTimeout(r, 600));
          refreshPanel();

          window.AtlasSidebar.setStatus("Done.", "ok");
          window.AtlasSidebar.removeThinking();
          window.AtlasSidebar.addChatMessage("agent", `✅ ${successMsg}`);
          speakIfVoiceMode(successMsg);
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
        const cancelMsg = "Understood! I've cancelled that action for you.";
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

      let inputToSend = rawInput;
      if (window.AtlasSecretVault?.tokenizeCommand) {
        const origin = window.location.origin || "";
        const tokenized = await window.AtlasSecretVault.tokenizeCommand(origin, rawInput, domMap);
        inputToSend = tokenized.command;
      }

      conversationHistory.push({ role: "user", content: inputToSend });
      if (conversationHistory.length > 4) conversationHistory = conversationHistory.slice(-4);

      // Truncate history content to reduce token usage sent to the backend
      const trimmedHistory = conversationHistory.map((h) => ({
        role: h.role,
        content: (h.content || "").slice(0, 100),
      }));

      const requestPayload = {
        url: window.location.href,
        question: inputToSend,
        page_text: pageText,
        dom_map: domMap,
        history: trimmedHistory,
        api_key: apiKey || "",
        language: window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US",
        contract_version: 3,
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

      // WS5: Route to closed goal loop if intent_route is 'goal'
      if (responseData?.intent_route === "goal" || (responseData?.goal_state && responseData.goal_state.status === "in_progress" && !responseData.plan)) {
        currentGoalState = responseData.goal_state;
        recentStepSignature = null;
        stepRepeatCount = 0;
        isExecuting = true;
        window.AtlasSidebar?.setExecuting?.(true);
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({
              type: "ATLAS_GOAL_STORE_PUT",
              goalState: currentGoalState,
            });
          } catch (_) {}
        }
        if (responseData.answer) {
          conversationHistory.push({ role: "assistant", content: responseData.answer });
          window.AtlasSidebar?.addChatMessage?.("agent", responseData.answer);
          speakIfVoiceMode(responseData.answer);
        }
        if (currentGoalState) {
          window.AtlasSidebar?.setGoalProgress?.(currentGoalState);
        }
        await executeGoalHop(currentGoalState);
        return;
      }

      const plan = responseData?.plan;

      // If planner returned multi-step plan
      if (plan && Array.isArray(plan.steps) && plan.steps.length > 0) {
        isExecuting = true;
        currentAbortController = new AbortController();
        window.AtlasSidebar?.setExecuting(true);

        const goalState = plan.goal_state || {
          goal: rawInput,
          status: "in_progress",
          milestones: plan.steps.map((s, idx) => ({
            id: `step-${idx + 1}`,
            description: s.description || `Step ${idx + 1}`,
            status: idx === 0 ? "active" : "pending",
          })),
          active_milestone_id: "step-1",
        };
        currentGoalState = goalState;
        window.AtlasSidebar?.setGoalProgress(goalState);

        // Execute steps sequentially with high-contrast highlighting
        for (let i = 0; i < plan.steps.length; i++) {
          if (!isExecuting || currentAbortController?.signal?.aborted) {
            console.log("Atlas: Execution interrupted by Stop control.");
            break;
          }

          const step = plan.steps[i];
          if (currentGoalState?.milestones) {
            currentGoalState.milestones.forEach((m, idx) => {
              if (idx < i) m.status = "completed";
              else if (idx === i) m.status = "active";
              else m.status = "pending";
            });
            currentGoalState.active_milestone_id = `step-${i + 1}`;
            window.AtlasSidebar?.setGoalProgress(currentGoalState);
          }

          window.AtlasSidebar.setStatus(step.description || `Executing step ${i + 1}...`, "info");
          await window.AtlasExecutor.executeStep(step);

          if (!isExecuting || currentAbortController?.signal?.aborted) {
            break;
          }

          try {
            await interruptibleSleep(step.delay_ms || 600, currentAbortController?.signal);
          } catch (e) {
            if (e.name === "AbortError" || !isExecuting) break;
            throw e;
          }
        }

        if (!isExecuting || currentAbortController?.signal?.aborted) {
          return;
        }

        isExecuting = false;
        window.AtlasSidebar?.setExecuting(false);
        window.AtlasSidebar?.hideGoalProgress();

        refreshPanel();

        // Check if confirmation is requested before completing action
        if (plan.requires_confirmation) {
          let pendingBtn = null;
          if (plan.pending_step && plan.pending_step.element_id) {
            pendingBtn = plan.pending_step;
          } else {
            const updatedDom = window.AtlasSerializer.serialize();
            const confirmNode = updatedDom.find((n) =>
              /submit|confirm|place order|checkout|proceed|pay|send|finish|save|sign in|log in/i.test(n.label || "")
            );
            if (confirmNode) {
              pendingBtn = { action: "click", element_id: confirmNode.id, description: confirmNode.label };
            }
          }

          pendingConfirmation = {
            action: pendingBtn,
            successMessage: plan.confirmation_success_message || "Done! Action completed.",
            prompt: plan.confirmation_prompt || plan.reply,
          };

          const confirmText = plan.confirmation_prompt || plan.reply;
          conversationHistory.push({ role: "assistant", content: confirmText });

          window.AtlasSidebar.setStatus("Awaiting confirmation", "info");
          window.AtlasSidebar.addChatMessage("agent", confirmText, {
            actions: plan.confirmation_options || ["Yes, proceed", "No, cancel"],
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
          emoji: el.emoji || null,
        }));
        window.AtlasSidebar.renderElements(items);
        return;
      }
    } catch (_) {}
    window.AtlasSidebar.renderElements(
      window.AtlasSidebar.deriveDisplayItems(domMap),
    );
  };

  // ── Page summary fetcher ──────────────────────────────────────────────────────
  const fetchPageSummary = async ({ showThinking = false } = {}) => {
    try {
      const pageText = getPageText();
      const { apiKey, baseUrl } = await getStoredSettings();
      if (!pageText || pageText.length < 10) return;

      if (showThinking) {
        window.AtlasSidebar.addChatThinking();
      }

      const activeLang = window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US";
      let summaryText = "";
      if (chrome?.runtime?.sendMessage) {
        const sRes = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "ATLAS_SUMMARY",
              baseUrl,
              apiKey: apiKey || "",
              payload: { url: window.location.href, page_text: pageText, api_key: apiKey || "", language: activeLang },
            },
            (res) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (!res || !res.ok) return reject(new Error(res?.error || "Summary failed"));
              resolve(res.data);
            }
          );
        });
        summaryText = sRes?.summary;
      } else {
        const sRes = await fetch(`${baseUrl}/v1/summary`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Atlas-Key": apiKey || "",
          },
          body: JSON.stringify({ url: window.location.href, page_text: pageText, api_key: apiKey || "", language: activeLang }),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          summaryText = sData.summary;
        }
      }

      if (showThinking) {
        window.AtlasSidebar.removeThinking();
      }

      if (summaryText) {
        window.AtlasSidebar.addChatMessage("agent", `📄 ${summaryText}`);
        speakIfVoiceMode(summaryText);
      }
    } catch (_) {
      if (showThinking) {
        window.AtlasSidebar.removeThinking();
      }
      // Non-critical: does not block
    }
  };

  const refreshPanel = (simplify = false) => {
    const domMap = window.AtlasSerializer.serialize();
    window.AtlasSidebar.renderElements(
      window.AtlasSidebar.deriveDisplayItems(domMap),
    );
    if (simplify) {
      renderSimplified(domMap);
    }
  };

const runCommand = async (command) => {
  window.AtlasSidebar.setStatus("Thinking...", "info");
  window.AtlasSidebar.addChatThinking();
  try {
    const domMap = window.AtlasSerializer.serialize();
    let commandToSend = command;
    if (window.AtlasSecretVault?.tokenizeCommand) {
      const origin = window.location.origin || "";
      const tokenized = await window.AtlasSecretVault.tokenizeCommand(origin, command, domMap);
      commandToSend = tokenized.command;
    }
    const activeLang = window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || window.AtlasSidebar?.getVoiceLanguage?.() || "en-US";
    const response = await window.AtlasSocket.sendCommand({
      url: window.location.href,
      domMap,
      command: commandToSend,
      language: activeLang,
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
  const el = window.AtlasSerializer?.getElementByAtlasId(atlasId);
  const isFileOrRow = el && (
    el.getAttribute("role") === "row" ||
    el.getAttribute("role") === "treeitem" ||
    /\.(pdf|docx?|pptx?|xlsx?|csv|zip|rar|tar|gz|txt|png|jpe?g|gif|mp[34]|avi|mkv|json|py|js|html|epub)\b/i.test(el.innerText || el.getAttribute("data-tooltip") || "")
  );
  const actionToUse = isFileOrRow ? "open" : "click";

  window.AtlasSidebar.setStatus("Confirm action on page...", "info");

  const result = await window.AtlasExecutor.execute({
    status: "ok",
    action: actionToUse,
    element_id: atlasId,
    value: null,
    message: isFileOrRow ? "Opening..." : "Done.",
  }, { skipConfirmation: false });
  window.AtlasSidebar.setStatus(result.message, result.ok ? "ok" : "error");
};

  // ── Voice input ───────────────────────────────────────────────────────────────
  const handleMicClick = () => {
    window.AtlasTTS?.stop();

    if (window.AtlasSpeech.isListening?.()) {
      window.AtlasSpeech.stop();
      window.AtlasSidebar.setListening(false);
      return;
    }

    if (!window.AtlasSpeech.isSupported()) {
      const msg = "Voice recognition is not supported in this browser.";
      window.AtlasSidebar.setStatus(msg, "error");
      window.AtlasSidebar.addChatMessage("agent", `⚠️ ${msg}`);
      return;
    }

    window.AtlasSidebar.setListening(true);
    window.AtlasSidebar.setStatus("Listening... speak now", "info");

    const inputField =
      window.AtlasSidebar?.getChatInput?.() ||
      window.__atlasShadowRoot?.querySelector?.(".atlas-chat-input") ||
      document.querySelector("#atlas-sidebar-root .atlas-chat-input");

    window.AtlasSpeech.start({
      onInterim: (interim) => {
        if (inputField) inputField.value = interim;
      },
      onResult: (transcript) => {
        if (inputField) inputField.value = "";
        window.AtlasSidebar?.handleSpeechTranscript?.(transcript);
        window.AtlasSidebar.addChatMessage("user", transcript);
        handleChatInput(transcript);
      },
      onAudioLevel: (audioData) => {
        window.AtlasSidebar?.setVoiceLevel?.(audioData.level, audioData.bars);
      },
      onEnd: () => {
        window.AtlasSidebar.setListening(false);
      },
      onError: (err) => {
        console.error("Atlas: Voice input error:", err);
        window.AtlasSidebar.setListening(false);
        window.AtlasSidebar.setStatus(err.message, "error");
        window.AtlasSidebar.addChatMessage("agent", `⚠️ ${err.message}`);
        speakIfVoiceMode(err.message);
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
        window.AtlasSidebar.setStatus("Ready.", "ok");
        if (active) {
          refreshPanel(false);
        }
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
      onStop: stopGoalExecution,
      onRetry: () => {
        if (typeof window !== "undefined" && window.AtlasConnectionManager?.retryNow) {
          window.AtlasConnectionManager.retryNow();
        } else if (window.AtlasSocket?.retry) {
          window.AtlasSocket.retry();
        }
      },
      onModeChange: (newMode) => {
        currentMode = newMode;
        if (newMode !== "voice") {
          window.AtlasTTS?.stop();
        } else {
          speakIfVoiceMode("Voice mode enabled. I will read responses aloud.");
        }
      },
      onRefresh: async () => {
        window.AtlasSidebar.setStatus("Refreshing page & elements...", "info");
        try {
          const domMap = window.AtlasSerializer.serialize();
          window.AtlasSidebar.renderElements(
            window.AtlasSidebar.deriveDisplayItems(domMap),
          );
          await renderSimplified(domMap);
          await fetchPageSummary({ showThinking: true });
          window.AtlasSidebar.setStatus("Page & Elements refreshed.", "ok");
        } catch (err) {
          window.AtlasSidebar.setStatus("Refresh failed.", "error");
        } finally {
          window.AtlasSidebar.setRefreshing(false);
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

    window.AtlasSidebar.setStatus("Connecting...", "info", { showRetry: false });

    if (typeof window !== "undefined" && window.AtlasConnectionManager) {
      window.AtlasConnectionManager.onStateChange((state, payload) => {
        switch (state) {
          case "CONNECTING":
            window.AtlasSidebar?.setStatus("Connecting...", "info", { showRetry: false });
            window.AtlasSidebar?.setControlsDisabled?.(true, "Connecting to Atlas backend...");
            break;
          case "CONNECTED":
            window.AtlasSidebar?.setStatus("Ready.", "ok", { showRetry: false });
            window.AtlasSidebar?.setControlsDisabled?.(false);
            break;
          case "RECONNECTING": {
            const sec = payload.secondsRemaining || 1;
            window.AtlasSidebar?.setStatus(`Disconnected — retrying in ${sec}s`, "error", { showRetry: true });
            window.AtlasSidebar?.setControlsDisabled?.(true, `Disconnected — retrying in ${sec}s...`);
            break;
          }
          case "OFFLINE":
            window.AtlasSidebar?.setStatus("Offline — click to retry", "error", { showRetry: true });
            window.AtlasSidebar?.setControlsDisabled?.(true, "Offline — backend unreachable. Click Retry Now.");
            break;
        }
      });

      window.AtlasConnectionManager.onCountdown((seconds) => {
        window.AtlasSidebar?.setStatus(`Disconnected — retrying in ${seconds}s`, "error", { showRetry: true });
        window.AtlasSidebar?.setControlsDisabled?.(true, `Disconnected — retrying in ${seconds}s...`);
      });
    }

    try {
      await window.AtlasSocket.connect({ baseUrl, apiKey });
      window.AtlasSocket.onDisconnect((err) => {
        if (isExecuting) {
          currentAbortController?.abort();
          isExecuting = false;
          window.AtlasSidebar?.setExecuting(false);
          window.AtlasSidebar?.hideGoalProgress();
        }
        if (pendingConfirmation) {
          pendingConfirmation = null;
        }
        window.AtlasSidebar?.removeThinking();
        window.AtlasSidebar?.addChatMessage(
          "agent",
          "⚠️ Connection to backend was interrupted. In-flight actions were stopped to prevent unintended side effects. Please click 'Retry Now' or wait to reconnect."
        );
      });
      window.AtlasSidebar.setStatus("Ready.", "ok", { showRetry: false });
      renderSimplified(domMap);

      // ── Page summary on activation ──────────────────────────────────
      await fetchPageSummary({ showThinking: true });

      // ── Check stored origin language preference ──────────────────────
      AtlasLanguageSwitcher.getStoredOriginPref()
        .then((storedPref) => {
          if (storedPref) {
            const docLang = (
              document.documentElement.lang || ""
            ).toLowerCase();
            const isAr =
              storedPref.startsWith("ar") ||
              storedPref.startsWith("ar_") ||
              storedPref === "ar";
            if (
              (isAr && !docLang.startsWith("ar")) ||
              (!isAr && docLang.startsWith("ar"))
            ) {
              AtlasLanguageSwitcher.detectAndSwitch(storedPref);
            }
          }
        })
        .catch(() => {});
    } catch (err) {
      console.error("Atlas: Connection failed:", err);
      if (typeof window !== "undefined" && window.AtlasConnectionManager) {
        window.AtlasConnectionManager.handleDisconnect(err);
      } else {
        window.AtlasSidebar.setStatus(
          `Couldn't connect: ${err.message}`,
          "error",
          { showRetry: true }
        );
      }
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

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
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
      if (message.type === "ATLAS_SWITCH_LANGUAGE") {
        AtlasLanguageSwitcher.detectAndSwitch(message.language)
          .then((switched) => sendResponse({ ok: true, switched }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      if (message.type === "ATLAS_GET_LANG_PREF") {
        AtlasLanguageSwitcher.getStoredOriginPref()
          .then((pref) => sendResponse({ ok: true, pref }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      if (message.type === "ATLAS_GOAL_RESUME") {
        const state = message.goalState;
        if (state && state.status === "in_progress") {
          currentGoalState = state;
          if (!isExecuting && !isHopInProgress) {
            isExecuting = true;
            window.AtlasSidebar?.setExecuting(true);
            window.AtlasSidebar?.setGoalProgress(state);
            window.AtlasSidebar?.setStatus("Resuming goal...", "info");
            executeGoalHop(state);
          }
        }
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "ATLAS_CHILD_TAB_CLOSED") {
        (async () => {
          await handleChildTabClosed(message);
        })();
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "ATLAS_TRIGGER_VOICE" || message.type === "ATLAS_VOICE_INPUT") {
        (async () => {
          if (!active) {
            await activate();
          } else if (window.AtlasSidebar?.isCollapsed?.()) {
            window.AtlasSidebar.expand();
          }
          handleMicClick();
          sendResponse({
            status: "ok",
            active,
            listening: window.AtlasSpeech?.isListening?.() || false,
          });
        })();
        return true;
      }
    });
  }

  // ── Global In-Page Shortcuts Fallback (Alt+A, Alt+V) ────────────────────────
  const handleKeyboardShortcuts = (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === "KeyA" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        toggle();
      } else if (e.code === "KeyV" || e.key === "v" || e.key === "V") {
        e.preventDefault();
        (async () => {
          if (!active) {
            await activate();
          } else if (window.AtlasSidebar?.isCollapsed?.()) {
            window.AtlasSidebar.expand();
          }
          handleMicClick();
        })();
      }
    }
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("keydown", handleKeyboardShortcuts);

    // Yield to Human Agency (H21) capture-phase listeners
    window.addEventListener("keydown", onHumanInteraction, { capture: true, passive: true });
    window.addEventListener("pointerdown", onHumanInteraction, { capture: true, passive: true });
    window.addEventListener("input", onHumanInteraction, { capture: true, passive: true });

    // Popup blocker & browser-native auth event listeners
    window.addEventListener("__atlas_popup_blocked__", handlePopupBlocked);
    window.addEventListener("__atlas_native_auth_start__", handleNativeAuthStart);
    window.addEventListener("__atlas_native_auth_end__", handleNativeAuthEnd);

    // Initialize popup blocker and native auth interception hooks
    if (window.AtlasExecutor) {
      window.AtlasExecutor.installPopupBlockerHook?.(window);
      if (typeof navigator !== "undefined") {
        window.AtlasExecutor.installNativeAuthHook?.(navigator);
      }
    }
  }

  if (typeof window !== "undefined") {
    window.AtlasLanguageSwitcher = AtlasLanguageSwitcher;
    window.AtlasGoalHandoff = {
      redactUrl,
      sanitizeTokens,
      capTitle,
      waitForNavigationSettle,
    };
    window.AtlasMultiTabOrchestration = {
      activate,
      deactivate,
      captureSemanticSnapshot,
      diffSemanticSnapshots,
      onHumanInteraction,
      resumeAfterHumanAgency,
      handleChildTabClosed,
      handlePopupBlocked,
      handleNativeAuthStart,
      handleNativeAuthEnd,
      isPausedForHuman: () => isPausedForHuman,
      isGuidedAuthMode: () => isGuidedAuthMode,
      setExecuting: (val) => { isExecuting = Boolean(val); },
      isExecuting: () => isExecuting,
      isHopInProgress: () => isHopInProgress,
      getCurrentGoalState: () => currentGoalState,
      setCurrentGoalState: (s) => { currentGoalState = s; },
      handleChatInput,
      renderAwaitingUserInputForm,
    };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      activate,
      deactivate,
      AtlasLanguageSwitcher,
      stopGoalExecution,
      interruptibleSleep,
      executeGoalHop,
      redactUrl,
      sanitizeTokens,
      capTitle,
      waitForNavigationSettle,
      captureSemanticSnapshot,
      diffSemanticSnapshots,
      onHumanInteraction,
      resumeAfterHumanAgency,
      handleChildTabClosed,
      handlePopupBlocked,
      handleNativeAuthStart,
      handleNativeAuthEnd,
      isPausedForHuman: () => isPausedForHuman,
      isGuidedAuthMode: () => isGuidedAuthMode,
      setExecuting: (val) => { isExecuting = Boolean(val); },
      isExecuting: () => isExecuting,
      isHopInProgress: () => isHopInProgress,
      getCurrentGoalState: () => currentGoalState,
      setCurrentGoalState: (s) => { currentGoalState = s; },
      handleChatInput,
      renderAwaitingUserInputForm,
    };
  }
})();


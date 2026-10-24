(function () {
  // sidebar.js — Apple-Style Floating Window + Grouped Panel & Chat

  const HOST_ID = "atlas-sidebar-host";
  const ROOT_ID = "atlas-sidebar-root";
  const DEFAULT_WIDTH = 348;
  const DEFAULT_HEIGHT = 520;
  const COLLAPSED_SIZE = 52;
  const COMPACT_VIEWPORT_THRESHOLD = 700;
  const COMPACT_PILL_SIZE = 56;
  const VIEWPORT_PADDING = 12;
  const SCROLLBAR_CLEARANCE = 20;

  let isAutoCollapsedForCompact = false;
  let isDeliberatelyExpandedInCompact = false;
  let isAutoHiddenForExecution = false;

  const isCompactViewport = () => {
    return typeof window !== "undefined" && window.innerWidth < COMPACT_VIEWPORT_THRESHOLD;
  };

  const getCollapsedSize = () => {
    if (rootEl && rootEl.classList && rootEl.classList.contains("atlas-compact-pill")) {
      return COMPACT_PILL_SIZE;
    }
    return isCompactViewport() ? COMPACT_PILL_SIZE : COLLAPSED_SIZE;
  };

  let hostEl = null;
  let shadowRoot = null;
  let rootEl = null;
  let listEl = null;
  let statusEl = null;
  let statusTextEl = null;
  let retryBtnEl = null;
  let tourTriggerBtnEl = null;
  let tourOverlayEl = null;
  let currentTourStep = 0;
  let isTourActive = false;
  let tourLastFocusedEl = null;
  let chatInputEl = null;
  let searchEl = null;
  let progressStripEl = null;
  let progressStepTextEl = null;
  let progressBarEl = null;
  let progressBarFillEl = null;
  let milestonesStepperEl = null;
  let stopBtnEl = null;
  let headerStopBtnEl = null;
  let voiceMeterEl = null;
  let currentTextScale = "normal";

  const DEFAULT_SIDEBAR_CSS = `
#atlas-sidebar-root {
  all: initial;
  direction: ltr;
  position: fixed;
  z-index: 2147483647;
  width: 348px;
  min-width: 348px;
  height: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.4;
  background: rgba(28, 28, 32, 0.78);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}
#atlas-sidebar-root * {
  box-sizing: border-box;
}
#atlas-sidebar-root .atlas-progress-strip {
  display: none;
}
#atlas-sidebar-root .atlas-voice-meter {
  display: none;
}
#atlas-sidebar-root .atlas-voice-meter.atlas-meter-active {
  display: inline-flex;
}
#atlas-sidebar-root.atlas-compact-pill {
  width: 56px !important;
  height: 56px !important;
  min-width: 56px !important;
  min-height: 56px !important;
  max-width: 56px !important;
  max-height: 56px !important;
  border-radius: 50% !important;
  padding: 0 !important;
  overflow: visible !important;
}
#atlas-sidebar-root.atlas-compact-pill .atlas-collapsed-badge {
  display: flex !important;
  width: 56px !important;
  height: 56px !important;
}
#atlas-sidebar-root.atlas-compact-pill .atlas-header,
#atlas-sidebar-root.atlas-compact-pill .atlas-status,
#atlas-sidebar-root.atlas-compact-pill .atlas-pane {
  display: none !important;
}
#atlas-sidebar-root.atlas-auto-hidden {
  opacity: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
  transition: opacity 0.15s ease, visibility 0.15s ease !important;
}
#atlas-sidebar-root.atlas-auto-hidden * {
  pointer-events: none !important;
}
`;

  const applyAdoptedStyles = (shadow, cssText) => {
    if (shadow && shadow.adoptedStyleSheets && typeof CSSStyleSheet !== "undefined") {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        shadow.adoptedStyleSheets = [sheet];
        return sheet;
      } catch (_) {}
    }
    if (shadow) {
      const styleEl = document.createElement("style");
      styleEl.textContent = cssText;
      shadow.appendChild(styleEl);
    }
    return null;
  };
  let micBtn = null;
  let langPill = null;
  let modeBtn = null;
  let chatLogEl = null;
  let badgeEl = null;
  let badgeStatusDot = null;
  let handlers = {};
  let currentItems = [];
  let groupOpenState = {};
  let currentMode = "chat"; // 'chat' | 'voice'
  let currentLang = "en-US"; // 'ar-EG' | 'en-US'
  let currentVoiceLang = "en-US";
  let isCollapsed = false;

  // Drag state cleanup ref
  let cleanUpDrag = null;

  // ── HTML Sanitizer Utility (Universal XSS Defense) ───────────────────────────
  const escapeHtml = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // ── Dynamic Semantic Category System ──────────────────────────────────────────
  const DEFAULT_CATEGORIES = {
    files: { label: "Files & Folders", emoji: "📁", priority: 1 },
    actions: { label: "Actions & Create", emoji: "⚡", priority: 2 },
    search_filters: { label: "Search & Filters", emoji: "🔍", priority: 3 },
    navigation: { label: "Navigation & Sections", emoji: "🧭", priority: 4 },
    view_settings: { label: "View & Settings", emoji: "⚙️", priority: 5 },
    commerce: { label: "Shopping & Cart", emoji: "🛒", priority: 6 },
    account: { label: "Account & Profile", emoji: "👤", priority: 7 },
    inputs: { label: "Text Fields & Forms", emoji: "📝", priority: 8 },
    buttons: { label: "Buttons & Controls", emoji: "🔘", priority: 9 },
    links: { label: "Links & Resources", emoji: "🔗", priority: 10 },
    other: { label: "Other Elements", emoji: "📌", priority: 99 },
  };

  const classifyNode = (node) => {
    const rawLabel = (
      node.resolved_label ||
      node.aria_label ||
      node.inner_text ||
      node.placeholder ||
      node.name ||
      ""
    ).trim();
    const l = rawLabel.toLowerCase();
    const tag = (node.tag || "").toLowerCase();
    const role = (node.role || "").toLowerCase();
    const type = (node.type || "").toLowerCase();

    // 1. Files, Folders & Documents (Cloud storage, attachments, file lists)
    if (
      /\.(pdf|docx?|pptx?|xlsx?|csv|zip|rar|tar|gz|7z|txt|png|jpe?g|gif|svg|mp[34]|avi|mkv|json|py|js|html|epub)\b/i.test(rawLabel) ||
      ((role === "row" || role === "treeitem" || role === "gridcell") && !/^(home|activity|drive|shared|trash|starred|recent|spam|storage)\b/i.test(l)) ||
      (/\b(folder|file|document|spreadsheet|presentation|slide|archive|pdf|download|drive)\b/i.test(l) && !/^(new|create|upload|add)\b/i.test(l))
    ) {
      return { category: "files", label: "Files & Folders", emoji: "📁" };
    }

    // 2. Quick Actions & Creation (+ New, Create, Add, Upload, Compose, Submit)
    if (
      /^(\+|create|new|add|upload|compose|submit|send|save|publish|export|import|delete|trash|remove|checkout|confirm|apply)\b/i.test(l) ||
      /\b(create new|new folder|new file|upload file|upload folder|add new|submit form)\b/i.test(l)
    ) {
      return { category: "actions", label: "Actions & Create", emoji: "⚡" };
    }

    // 3. Search & Filters
    if (
      type === "search" ||
      role === "searchbox" ||
      /\b(search|filter|find|query)\b/i.test(l) ||
      /^(type|people|modified|source|date|category|sort|order by|filter by|filter)\b/i.test(l)
    ) {
      return { category: "search_filters", label: "Search & Filters", emoji: "🔍" };
    }

    // 4. Navigation & Sections (Sidebar, tabs, main areas)
    if (
      tag === "a" ||
      role === "tab" ||
      role === "link" ||
      /\b(home|activity|workspaces|recent|starred|spam|trash|storage|dashboard|explore|subscriptions|library|overview|menu|back|forward|next|previous|page)\b/i.test(l)
    ) {
      return { category: "navigation", label: "Navigation & Sections", emoji: "🧭" };
    }

    // 5. View Controls & Settings (Layout, Grid, List, Details, Settings, Help)
    if (
      /\b(view|layout|grid|list|details|info|settings|options|preferences|more actions|more options|customize|help|support|shortcuts)\b/i.test(l)
    ) {
      return { category: "view_settings", label: "View & Settings", emoji: "⚙️" };
    }

    // 6. Shopping & Commerce
    if (
      /\b(cart|checkout|buy|price|order|add to cart|bag|wishlist|pay|purchase|subscribe)\b/i.test(l)
    ) {
      return { category: "commerce", label: "Shopping & Cart", emoji: "🛒" };
    }

    // 7. Account & Profile
    if (
      /\b(account|sign in|log in|sign out|log out|profile|avatar|user|switch account|my account)\b/i.test(l)
    ) {
      return { category: "account", label: "Account & Profile", emoji: "👤" };
    }

    // 8. Form text fields & inputs
    if (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      role === "textbox" ||
      role === "combobox"
    ) {
      return { category: "inputs", label: "Text Fields & Forms", emoji: "📝" };
    }

    // 9. Buttons
    if (tag === "button" || role === "button") {
      return { category: "buttons", label: "Buttons & Controls", emoji: "🔘" };
    }

    return { category: "other", label: "Other Elements", emoji: "📌" };
  };

  const deriveDisplayItems = (domMap) =>
    domMap.map((node) => {
      const detected = classifyNode(node);
      return {
        id: node.id,
        label:
          node.resolved_label ||
          node.aria_label ||
          node.inner_text ||
          node.placeholder ||
          node.name ||
          node.tag,
        category: detected.category,
        category_label: detected.label,
        emoji: detected.emoji,
        group: node.group_label || null,
      };
    });

  // ── Window Positioning, Edge-Clamping & Dragging ─────────────────────────────
  const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

  const applyPosition = (x, y) => {
    if (!rootEl) return;
    const collapsedDim = getCollapsedSize();
    const width = isCollapsed ? collapsedDim : (rootEl.offsetWidth || DEFAULT_WIDTH);
    const height = isCollapsed ? collapsedDim : (rootEl.offsetHeight || DEFAULT_HEIGHT);
    // 20px clearance ensures floating badge never blocks host page vertical scrollbar
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - SCROLLBAR_CLEARANCE);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
    const clampedX = clamp(x, VIEWPORT_PADDING, maxX);
    const clampedY = clamp(y, VIEWPORT_PADDING, maxY);

    rootEl.style.left = `${clampedX}px`;
    rootEl.style.top = `${clampedY}px`;
    return { x: clampedX, y: clampedY };
  };

  const resetPosition = () => {
    if (!rootEl) return;
    const collapsedDim = getCollapsedSize();
    const width = isCollapsed ? collapsedDim : DEFAULT_WIDTH;
    const height = isCollapsed ? collapsedDim : DEFAULT_HEIGHT;
    const defaultX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - 24);
    const defaultY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - 24);
    const pos = applyPosition(defaultX, defaultY);
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ atlasWindowPos: pos });
    }
    return pos;
  };

  const collapse = () => {
    if (isCollapsed) return;
    isCollapsed = true;
    isDeliberatelyExpandedInCompact = false;
    if (rootEl) {
      rootEl.classList.add("atlas-collapsed");
      if (isCompactViewport()) {
        rootEl.classList.add("atlas-compact-pill");
      }
      rootEl.setAttribute("aria-expanded", "false");

      // Re-clamp position for circular notch dimensions
      const rect = rootEl.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ atlasIsCollapsed: true });
    }
  };

  const expand = () => {
    if (!isCollapsed) return;
    isCollapsed = false;
    isAutoCollapsedForCompact = false; // User intentional override
    if (isCompactViewport()) {
      isDeliberatelyExpandedInCompact = true;
    }
    const defaultX = Math.max(VIEWPORT_PADDING, (typeof window !== "undefined" ? window.innerWidth : 1024) - DEFAULT_WIDTH - 24);
    const defaultY = Math.max(VIEWPORT_PADDING, (typeof window !== "undefined" ? window.innerHeight : 768) - DEFAULT_HEIGHT - 24);
    let targetX = defaultX;
    let targetY = defaultY;

    if (rootEl) {
      rootEl.classList.remove("atlas-collapsed", "atlas-compact-pill");
      rootEl.setAttribute("aria-expanded", "true");

      // Overlap project edge case: Auto-adjust position if expanding pushes it past the right or bottom
      const rect = rootEl.getBoundingClientRect();
      const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - DEFAULT_WIDTH - SCROLLBAR_CLEARANCE);
      const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - DEFAULT_HEIGHT - VIEWPORT_PADDING);
      targetX = clamp(rect.left, VIEWPORT_PADDING, maxX);
      targetY = clamp(rect.top, VIEWPORT_PADDING, maxY);
      applyPosition(targetX, targetY);
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        atlasIsCollapsed: false,
        atlasWindowPos: { x: targetX, y: targetY },
      });
    }
  };

  const toggleCollapse = () => {
    if (isCollapsed) {
      expand();
    } else {
      collapse();
    }
  };

  const initWindowPosition = () => {
    const defaultX = Math.max(VIEWPORT_PADDING, window.innerWidth - DEFAULT_WIDTH - 24);
    const defaultY = Math.max(VIEWPORT_PADDING, window.innerHeight - DEFAULT_HEIGHT - 24);

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["atlasWindowPos", "atlasIsCollapsed"], (result) => {
        const pos = result?.atlasWindowPos;
        if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
          applyPosition(pos.x, pos.y);
        } else {
          applyPosition(defaultX, defaultY);
        }
        if (result?.atlasIsCollapsed) {
          collapse();
        }
        checkViewportResponsive();
      });
    } else {
      applyPosition(defaultX, defaultY);
      checkViewportResponsive();
    }
  };

  const checkViewportResponsive = () => {
    if (!rootEl) return;
    if (isCompactViewport()) {
      rootEl.classList.add("atlas-compact-mode");
      if (!isCollapsed) {
        if (!isDeliberatelyExpandedInCompact) {
          isAutoCollapsedForCompact = true;
          collapse();
        }
      } else {
        rootEl.classList.add("atlas-compact-pill");
        const rect = rootEl.getBoundingClientRect();
        applyPosition(rect.left, rect.top);
      }
    } else {
      rootEl.classList.remove("atlas-compact-mode");
      isDeliberatelyExpandedInCompact = false;
      if (isAutoCollapsedForCompact && isCollapsed) {
        isAutoCollapsedForCompact = false;
        expand();
      } else if (isCollapsed) {
        rootEl.classList.remove("atlas-compact-pill");
        const rect = rootEl.getBoundingClientRect();
        applyPosition(rect.left, rect.top);
      }
    }
  };

  const setAutoHide = (autoHide) => {
    isAutoHiddenForExecution = Boolean(autoHide);
    if (rootEl) {
      rootEl.classList.toggle("atlas-auto-hidden", isAutoHiddenForExecution);
    }
    if (hostEl) {
      if (isAutoHiddenForExecution) {
        hostEl.style.setProperty("pointer-events", "none", "important");
      } else {
        hostEl.style.removeProperty("pointer-events");
      }
    }
  };

  const isAtlasElement = (el) => {
    if (!el) return false;
    if (el === hostEl || el === rootEl) return true;
    if (el.id === HOST_ID || el.id === ROOT_ID) return true;
    if (typeof el.closest === "function") {
      if (el.closest(`#${HOST_ID}, #${ROOT_ID}`)) return true;
    }
    return false;
  };

  const elementFromPointExcludingAtlas = (x, y) => {
    if (typeof document === "undefined") return null;
    if (typeof document.elementsFromPoint === "function") {
      const list = document.elementsFromPoint(x, y);
      for (const el of list) {
        if (!isAtlasElement(el)) return el;
      }
      return null;
    }
    if (hostEl && hostEl.style) {
      const prev = hostEl.style.pointerEvents;
      hostEl.style.setProperty("pointer-events", "none", "important");
      try {
        const el = document.elementFromPoint(x, y);
        return isAtlasElement(el) ? null : el;
      } finally {
        hostEl.style.setProperty("pointer-events", prev);
      }
    }
    return document.elementFromPoint(x, y);
  };

  const setupElementFromPointExclusion = () => {
    if (typeof document === "undefined" || typeof Document === "undefined" || !Document.prototype || !Document.prototype.elementFromPoint) return;
    const original = Document.prototype.elementFromPoint;
    if (original.__atlasWrapped) return;

    Document.prototype.elementFromPoint = function (x, y) {
      const hit = original.call(this, x, y);
      if (!isAtlasElement(hit)) return hit;
      if (typeof this.elementsFromPoint === "function") {
        const list = this.elementsFromPoint(x, y);
        for (const item of list) {
          if (!isAtlasElement(item)) return item;
        }
        return null;
      }
      return null;
    };
    Document.prototype.elementFromPoint.__atlasWrapped = true;
    Document.prototype.elementFromPoint.__atlasOriginal = original;
  };

  let resumeBtnEl = null;

  const showResumeButton = (onResume) => {
    if (!rootEl) return;
    if (!resumeBtnEl) {
      resumeBtnEl = document.createElement("button");
      resumeBtnEl.className = "atlas-resume-btn";
      resumeBtnEl.setAttribute("aria-label", "Resume execution");
      resumeBtnEl.innerHTML = `<span class="atlas-resume-icon" aria-hidden="true">▶</span><span class="atlas-resume-label">Resume</span>`;
      resumeBtnEl.style.cssText = "display: inline-flex; align-items: center; gap: 6px; background: #10b981; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 600; cursor: pointer; margin-left: 8px;";
      
      const statusBar = rootEl.querySelector(".atlas-status");
      if (statusBar) {
        statusBar.appendChild(resumeBtnEl);
      }
    }
    resumeBtnEl.style.display = "inline-flex";
    resumeBtnEl.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      hideResumeButton();
      if (typeof onResume === "function") {
        onResume();
      }
    };
  };

  const hideResumeButton = () => {
    if (resumeBtnEl) {
      resumeBtnEl.style.display = "none";
      resumeBtnEl.onclick = null;
    }
  };

  let assistedOpenBtnEl = null;

  const showAssistedOpenButton = (onUserClick) => {
    if (!rootEl) return;
    if (!assistedOpenBtnEl) {
      assistedOpenBtnEl = document.createElement("button");
      assistedOpenBtnEl.className = "atlas-assisted-open-btn glowing-prompt-btn";
      assistedOpenBtnEl.setAttribute("aria-label", "Open blocked popup window");
      assistedOpenBtnEl.innerHTML = `<span class="atlas-assisted-open-icon" aria-hidden="true">↗</span><span class="atlas-assisted-open-label">Open Popup</span>`;
      assistedOpenBtnEl.style.cssText = "display: inline-flex; align-items: center; gap: 6px; background: #2563eb; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 600; cursor: pointer; margin-left: 8px;";

      const statusBar = rootEl.querySelector(".atlas-status");
      if (statusBar) {
        statusBar.appendChild(assistedOpenBtnEl);
      }
    }
    assistedOpenBtnEl.style.display = "inline-flex";
    assistedOpenBtnEl.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      hideAssistedOpenButton();
      if (typeof onUserClick === "function") {
        onUserClick(e);
      }
    };
  };

  const hideAssistedOpenButton = () => {
    if (assistedOpenBtnEl) {
      assistedOpenBtnEl.style.display = "none";
      assistedOpenBtnEl.onclick = null;
    }
  };

  const showAssistedClickPrompt = ({ message, targetEl, onUserClick } = {}) => {
    setStatus(message || "Awaiting manual click (popup blocked)", "info");
    addChatMessage(
      "agent",
      `⚠️ ${message || "Browser popup was blocked. Please click the glowing button to open the authentication window."}`
    );
    if (targetEl) {
      targetEl.classList.add("glowing-prompt-btn", "atlas-assisted-click-glow");
      if (onUserClick) {
        const handler = (e) => {
          if (e.isTrusted) {
            targetEl.removeEventListener("click", handler, { capture: true });
            targetEl.classList.remove("glowing-prompt-btn", "atlas-assisted-click-glow");
            hideAssistedOpenButton();
            onUserClick(e);
          }
        };
        targetEl.addEventListener("click", handler, { capture: true });
      }
    } else {
      showAssistedOpenButton(onUserClick);
    }
  };

  const hideAssistedClickPrompt = (targetEl) => {
    if (targetEl) {
      targetEl.classList.remove("glowing-prompt-btn", "atlas-assisted-click-glow");
    }
    hideAssistedOpenButton();
    setStatus("Ready.", "info");
  };

  const setGuidedAuthMode = (active, details = {}) => {
    if (!rootEl) return;
    rootEl.classList.toggle("atlas-guided-auth", Boolean(active));
    if (active) {
      setStatus("Awaiting browser credential...", "info");
      addChatMessage(
        "agent",
        `🔑 Browser Authentication Active: A native prompt has opened at the top of your browser. Please select your ${details.kind || "Passkey or Account"} to continue.`
      );
    } else {
      setStatus(details.success ? "Browser credential verified" : "Ready.", details.success ? "ok" : "info");
    }
  };

  const setupDragging = (headerEl, badgeElement) => {
    // Header drag (expanded window)
    let isHeaderDragging = false;
    let headerStartX = 0;
    let headerStartY = 0;
    let headerInitialLeft = 0;
    let headerInitialTop = 0;

    const onHeaderPointerDown = (e) => {
      if (e.target.closest("button, input, [role='tab'], .atlas-tab, .atlas-traffic-btn, .atlas-collapse-btn")) {
        return;
      }
      isHeaderDragging = true;
      headerStartX = e.clientX;
      headerStartY = e.clientY;
      const rect = rootEl.getBoundingClientRect();
      headerInitialLeft = rect.left;
      headerInitialTop = rect.top;
      rootEl.classList.add("atlas-dragging");
      document.body.style.userSelect = "none";
      try {
        headerEl.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    };

    const onHeaderPointerMove = (e) => {
      if (!isHeaderDragging) return;
      const dx = e.clientX - headerStartX;
      const dy = e.clientY - headerStartY;
      applyPosition(headerInitialLeft + dx, headerInitialTop + dy);
    };

    const onHeaderPointerUp = (e) => {
      if (!isHeaderDragging) return;
      isHeaderDragging = false;
      try {
        headerEl.releasePointerCapture(e.pointerId);
      } catch (_) {}
      rootEl.classList.remove("atlas-dragging");
      document.body.style.userSelect = "";
      const rect = rootEl.getBoundingClientRect();
      const pos = { x: Math.round(rect.left), y: Math.round(rect.top) };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ atlasWindowPos: pos });
      }
    };

    const onHeaderDblClick = (e) => {
      if (e.target.closest("button, input, [role='tab'], .atlas-tab, .atlas-traffic-btn, .atlas-collapse-btn")) {
        return;
      }
      resetPosition();
    };

    headerEl.addEventListener("pointerdown", onHeaderPointerDown);
    headerEl.addEventListener("pointermove", onHeaderPointerMove);
    headerEl.addEventListener("pointerup", onHeaderPointerUp);
    headerEl.addEventListener("pointercancel", onHeaderPointerUp);
    headerEl.addEventListener("dblclick", onHeaderDblClick);

    // Collapsed Badge drag & click discrimination
    let isBadgeDragging = false;
    let badgeStartX = 0;
    let badgeStartY = 0;
    let badgeInitialLeft = 0;
    let badgeInitialTop = 0;
    let badgeHasMoved = false;

    const onBadgePointerDown = (e) => {
      isBadgeDragging = true;
      badgeHasMoved = false;
      badgeStartX = e.clientX;
      badgeStartY = e.clientY;
      const rect = rootEl.getBoundingClientRect();
      badgeInitialLeft = rect.left;
      badgeInitialTop = rect.top;
      document.body.style.userSelect = "none";
      try {
        badgeElement.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    };

    const onBadgePointerMove = (e) => {
      if (!isBadgeDragging) return;
      const dx = e.clientX - badgeStartX;
      const dy = e.clientY - badgeStartY;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        badgeHasMoved = true;
        rootEl.classList.add("atlas-dragging");
      }
      applyPosition(badgeInitialLeft + dx, badgeInitialTop + dy);
    };

    const onBadgePointerUp = (e) => {
      if (!isBadgeDragging) return;
      isBadgeDragging = false;
      try {
        badgeElement.releasePointerCapture(e.pointerId);
      } catch (_) {}
      rootEl.classList.remove("atlas-dragging");
      document.body.style.userSelect = "";

      if (badgeHasMoved) {
        const rect = rootEl.getBoundingClientRect();
        const pos = { x: Math.round(rect.left), y: Math.round(rect.top) };
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ atlasWindowPos: pos });
        }
        setTimeout(() => {
          badgeHasMoved = false;
        }, 60);
      }
    };

    const onBadgeClick = (e) => {
      if (badgeHasMoved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      expand();
    };

    const onBadgeDblClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetPosition();
    };

    const onBadgeKeyDown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        expand();
      }
    };

    badgeElement.addEventListener("pointerdown", onBadgePointerDown);
    badgeElement.addEventListener("pointermove", onBadgePointerMove);
    badgeElement.addEventListener("pointerup", onBadgePointerUp);
    badgeElement.addEventListener("pointercancel", onBadgePointerUp);
    badgeElement.addEventListener("click", onBadgeClick);
    badgeElement.addEventListener("dblclick", onBadgeDblClick);
    badgeElement.addEventListener("keydown", onBadgeKeyDown);

    // Global resize listener
    const onResize = () => {
      if (!rootEl) return;
      checkViewportResponsive();
      const rect = rootEl.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    };
    window.addEventListener("resize", onResize);

    return () => {
      headerEl.removeEventListener("pointerdown", onHeaderPointerDown);
      headerEl.removeEventListener("pointermove", onHeaderPointerMove);
      headerEl.removeEventListener("pointerup", onHeaderPointerUp);
      headerEl.removeEventListener("pointercancel", onHeaderPointerUp);
      headerEl.removeEventListener("dblclick", onHeaderDblClick);

      badgeElement.removeEventListener("pointerdown", onBadgePointerDown);
      badgeElement.removeEventListener("pointermove", onBadgePointerMove);
      badgeElement.removeEventListener("pointerup", onBadgePointerUp);
      badgeElement.removeEventListener("pointercancel", onBadgePointerUp);
      badgeElement.removeEventListener("click", onBadgeClick);
      badgeElement.removeEventListener("dblclick", onBadgeDblClick);
      badgeElement.removeEventListener("keydown", onBadgeKeyDown);

      window.removeEventListener("resize", onResize);
      document.body.style.userSelect = "";
    };
  };

  // ── Text Scaling (Track U3) ──────────────────────────────────────────────────
  const applyTextScale = (scale) => {
    const validScale = ["normal", "large", "xl"].includes(scale) ? scale : "normal";
    currentTextScale = validScale;
    if (!rootEl) return;
    rootEl.classList.remove("atlas-text-scale-normal", "atlas-text-scale-large", "atlas-text-scale-xl");
    rootEl.classList.add(`atlas-text-scale-${validScale}`);
    rootEl.setAttribute("data-text-scale", validScale);
  };

  const setTextScale = (scale) => {
    applyTextScale(scale);
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      try {
        chrome.storage.local.set({ atlas_text_scale: currentTextScale });
      } catch (_) {}
    }
    return currentTextScale;
  };

  const cycleTextScale = () => {
    const next = currentTextScale === "normal" ? "large" : currentTextScale === "large" ? "xl" : "normal";
    return setTextScale(next);
  };

  if (typeof chrome !== "undefined" && chrome.storage?.onChanged?.addListener) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.atlas_text_scale) {
          applyTextScale(changes.atlas_text_scale.newValue);
        }
      });
    } catch (_) {}
  }

  // ── DOM construction ──────────────────────────────────────────────────────────
  const buildDom = () => {
    // 1. Create host element in Light DOM with defensive inline reset
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.style.setProperty("all", "initial", "important");
    hostEl.style.setProperty("position", "static", "important");
    hostEl.style.setProperty("display", "block", "important");
    hostEl.style.setProperty("width", "0", "important");
    hostEl.style.setProperty("height", "0", "important");
    hostEl.style.setProperty("margin", "0", "important");
    hostEl.style.setProperty("padding", "0", "important");
    hostEl.style.setProperty("border", "none", "important");
    hostEl.style.setProperty("z-index", "2147483647", "important");

    // 2. Attach closed Shadow Root
    shadowRoot = hostEl.attachShadow({ mode: "closed" });

    // 3. Expose test-only handle for automated test harnesses
    if (typeof window !== "undefined") {
      window.__atlasShadowRoot = shadowRoot;
    }
    setupElementFromPointExclusion();

    // 4. Load stylesheet into Shadow Root via adoptedStyleSheets
    const cssText =
      handlers.cssText ||
      (typeof window !== "undefined" && window.__atlasSidebarCss) ||
      (typeof document !== "undefined" && document.getElementById("atlas-sidebar-css")?.textContent) ||
      DEFAULT_SIDEBAR_CSS;
    applyAdoptedStyles(shadowRoot, cssText);

    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      try {
        fetch(chrome.runtime.getURL("sidebar.css"))
          .then((r) => r.text())
          .then((fullCss) => {
            if (shadowRoot && fullCss) {
              applyAdoptedStyles(shadowRoot, fullCss);
            }
          })
          .catch(() => {});
      } catch (_) {}
    }

    // 5. Construct inner root container
    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;
    rootEl.setAttribute("role", "dialog");
    rootEl.setAttribute("aria-label", "Atlas Accessibility Assistant");
    rootEl.setAttribute("aria-expanded", "true");

    rootEl.innerHTML = `
    <!-- macOS Window Titlebar / Header -->
    <div class="atlas-header" title="Drag to move Atlas window (Double-click to reset)">
      <div class="atlas-traffic-lights">
        <button class="atlas-traffic-btn atlas-traffic-close atlas-close-btn" id="atlas-header-close" aria-label="Close Atlas Assistant" title="Close Atlas Assistant">
          <span class="atlas-traffic-close-icon" aria-hidden="true">✕</span>
        </button>
      </div>

      <span class="atlas-title">Atlas</span>

      <div class="atlas-tab-bar" role="tablist">
        <button class="atlas-tab atlas-tab-active" data-tab="chat" role="tab" aria-selected="true">Chat</button>
        <button class="atlas-tab" data-tab="elements" role="tab" aria-selected="false">Elements</button>
      </div>

      <div class="atlas-header-actions">
        <button class="atlas-stop-btn atlas-header-stop-btn" id="atlas-header-stop" aria-label="Stop execution" title="Stop execution">
          <span class="atlas-stop-icon" aria-hidden="true">■</span>
          <span class="atlas-stop-header-label">Stop</span>
        </button>
        <button class="atlas-text-scale-btn" id="atlas-header-text-scale" aria-label="Adjust text scaling (Normal, Large, XL)" title="Adjust text scaling">
          <span class="atlas-text-scale-label">Aa</span>
        </button>
        <button class="atlas-tts-toggle" id="atlas-header-tts" aria-label="Toggle voice output" title="Toggle voice output">
          <svg class="atlas-tts-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </button>
        <button class="atlas-refresh-btn" id="atlas-header-refresh" aria-label="Reload page analysis" title="Reload Page Elements & Summary">
          <svg class="atlas-refresh-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        </button>
        <button class="atlas-tour-trigger-btn" id="atlas-header-tour" aria-label="Start guided tour" title="Take a tour of Atlas (Guided Tour)">
          <svg class="atlas-tour-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
        <button class="atlas-collapse-btn" id="atlas-header-collapse" aria-label="Collapse Atlas" title="Collapse">
          <svg class="atlas-collapse-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <!-- Fallback close button for accessibility / test compatibility -->
        <button class="atlas-close" aria-label="Close Atlas sidebar" style="display: none;">×</button>
      </div>
    </div>

    <!-- Milestone Progress Strip & Prominent Stop Control (Track U2) -->
    <div class="atlas-progress-strip" id="atlas-progress-strip" role="region" aria-label="Goal progress" style="display: none;">
      <div class="atlas-progress-header">
        <div class="atlas-progress-title-col">
          <span class="atlas-progress-badge" aria-hidden="true">GOAL</span>
          <span class="atlas-progress-step-text" id="atlas-progress-step-text" dir="auto">Step 1 of 1: Initializing...</span>
        </div>
        <button class="atlas-stop-btn atlas-stop-btn-prominent" id="atlas-stop-btn"
                aria-label="Stop goal execution" title="Stop goal execution (Halts agent mid-hop)">
          <span class="atlas-stop-icon" aria-hidden="true">■</span>
          <span class="atlas-stop-label">Stop</span>
        </button>
      </div>

      <div class="atlas-progressbar-container"
           role="progressbar"
           id="atlas-goal-progressbar"
           aria-label="Goal execution progress"
           aria-valuenow="1"
           aria-valuemin="1"
           aria-valuemax="1"
           aria-valuetext="Step 1 of 1"
           aria-live="polite">
        <div class="atlas-progressbar-track">
          <div class="atlas-progressbar-fill" id="atlas-progressbar-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div class="atlas-milestones-stepper" id="atlas-milestones-stepper" role="list" aria-label="Goal milestones" tabindex="0"></div>
    </div>

    <!-- Hoisted Status Bar (Visible & Accessible Across All Tabs) -->
    <div class="atlas-status" role="status" aria-live="polite">
      <span class="atlas-status-text">Ready.</span>
      <button class="atlas-retry-btn" id="atlas-retry-btn" type="button" aria-label="Retry connection now" style="display: none;">
        <svg class="atlas-retry-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        <span>Retry connection now</span>
      </button>
    </div>

    <!-- CHAT TAB PANE -->
    <div class="atlas-pane" id="atlas-pane-chat">
      <div class="atlas-chat-log" id="atlas-chat-log" role="log" aria-live="polite"></div>
      <div class="atlas-chat-input-bar">
        <button class="atlas-mode-btn" id="atlas-mode-toggle" aria-label="Chat Mode active — silent text responses (click for Voice Mode)" title="Switch between Chat and Voice Mode">
          <span class="atlas-mode-icon" aria-hidden="true">
            <svg class="atlas-chat-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span class="atlas-mode-text">Chat</span>
        </button>
        <input class="atlas-chat-input" type="text"
          placeholder="Ask anything or give a command..." />
        <button class="atlas-lang-pill" id="atlas-lang-toggle" aria-label="EN — Atlas language: English (click to switch to Arabic)" title="Atlas language: English (click for Arabic)">EN</button>
        <div class="atlas-voice-meter" id="atlas-voice-meter" aria-hidden="true">
          <span class="atlas-meter-bar atlas-meter-bar-1"></span>
          <span class="atlas-meter-bar atlas-meter-bar-2"></span>
          <span class="atlas-meter-bar atlas-meter-bar-3"></span>
          <span class="atlas-meter-bar atlas-meter-bar-4"></span>
        </div>
        <button class="atlas-mic-btn" aria-label="Speak a command" title="Voice command">
          <svg class="atlas-mic-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ELEMENTS TAB PANE -->
    <div class="atlas-pane atlas-pane-hidden" id="atlas-pane-elements">
      <div class="atlas-search-bar">
        <input class="atlas-search" type="text" placeholder="Search buttons, inputs, links..." />
      </div>
      <div class="atlas-list" role="list"></div>
    </div>

    <!-- Collapsed Floating Notch / Circular Badge -->
    <div class="atlas-collapsed-badge" role="button" tabindex="0" aria-label="Atlas Assistant — Click to expand, drag to move" title="Atlas (Click to expand, drag to move)">
      <div class="atlas-badge-logo">
        <svg class="atlas-logo-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="21" fill="#141416" stroke="rgba(255, 255, 255, 0.2)" stroke-width="2"/>
          <polygon points="24,8 30,24 27,24 24,20 21,24 18,24" fill="#FFFFFF"/>
          <polygon points="24,40 18,24 21,24 24,28 27,24 30,24" fill="#0A84FF"/>
          <polygon points="24,20 27,24 24,28 21,24" fill="#141416"/>
        </svg>
      </div>
      <div class="atlas-badge-status-dot" aria-hidden="true"></div>
    </div>
  `;

    shadowRoot.appendChild(rootEl);
    (document.body || document.documentElement).appendChild(hostEl);

    listEl = rootEl.querySelector(".atlas-list");
    statusEl = rootEl.querySelector(".atlas-status");
    statusTextEl = rootEl.querySelector(".atlas-status-text");
    retryBtnEl = rootEl.querySelector("#atlas-retry-btn");
    tourTriggerBtnEl = rootEl.querySelector("#atlas-header-tour");
    chatInputEl = rootEl.querySelector(".atlas-chat-input");
    searchEl = rootEl.querySelector(".atlas-search");
    micBtn = rootEl.querySelector(".atlas-mic-btn");
    langPill = rootEl.querySelector("#atlas-lang-toggle");
    modeBtn = rootEl.querySelector("#atlas-mode-toggle");
    chatLogEl = rootEl.querySelector("#atlas-chat-log");
    badgeEl = rootEl.querySelector(".atlas-collapsed-badge");
    badgeStatusDot = rootEl.querySelector(".atlas-badge-status-dot");

    // Wire Retry button (Task U5)
    retryBtnEl?.addEventListener("click", (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      if (typeof handlers.onRetry === "function") {
        handlers.onRetry();
      } else if (typeof window !== "undefined" && window.AtlasConnectionManager?.retryNow) {
        window.AtlasConnectionManager.retryNow();
      }
    });

    // Wire Guided Tour trigger (Task U7)
    tourTriggerBtnEl?.addEventListener("click", (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      startTour(0);
    });

    // Auto-launch Guided Tour on first run (Task U7)
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      try {
        chrome.storage.local.get(["atlas_tour_completed"], (res) => {
          if (!res?.atlas_tour_completed) {
            startTour(0);
          }
        });
      } catch (_) {}
    }

    // Track U2 & U4 element references
    progressStripEl = rootEl.querySelector("#atlas-progress-strip");
    progressStepTextEl = rootEl.querySelector("#atlas-progress-step-text");
    progressBarEl = rootEl.querySelector("#atlas-goal-progressbar");
    progressBarFillEl = rootEl.querySelector("#atlas-progressbar-fill");
    milestonesStepperEl = rootEl.querySelector("#atlas-milestones-stepper");
    stopBtnEl = rootEl.querySelector("#atlas-stop-btn");
    headerStopBtnEl = rootEl.querySelector("#atlas-header-stop");
    voiceMeterEl = rootEl.querySelector("#atlas-voice-meter");

    // Wire Stop buttons
    const handleStopClick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handlers.onStop?.();
    };
    stopBtnEl?.addEventListener("click", handleStopClick);
    headerStopBtnEl?.addEventListener("click", handleStopClick);

    // Wire text scaling button
    rootEl.querySelector("#atlas-header-text-scale")?.addEventListener("click", () => {
      cycleTextScale();
    });

    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      try {
        chrome.storage.local.get(["atlas_text_scale"], (res) => {
          if (res?.atlas_text_scale) {
            applyTextScale(res.atlas_text_scale);
          }
        });
      } catch (_) {}
    }

    // Wire language toggle pill (EN / AR)
    langPill?.addEventListener("click", () => {
      toggleLanguage();
    });

    // Sync initial language with storage or AtlasSpeech (migrating atlas_voice_lang if present)
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      try {
        chrome.storage.local.get(["atlas_lang", "atlas_voice_lang"], (res) => {
          let stored = res?.atlas_lang;
          if (!stored && res?.atlas_voice_lang) {
            stored = res.atlas_voice_lang;
            try {
              chrome.storage.local.set({ atlas_lang: stored });
            } catch (_) {}
          }
          if (stored) {
            setLanguage(stored, false);
          } else if (window.AtlasSpeech?.getLanguage) {
            setLanguage(window.AtlasSpeech.getLanguage(), false);
          } else {
            setLanguage("en-US", false);
          }
        });
      } catch (_) {}
    } else if (window.AtlasSpeech?.getLanguage) {
      setLanguage(window.AtlasSpeech.getLanguage(), false);
    } else {
      setLanguage("en-US", false);
    }

    const headerEl = rootEl.querySelector(".atlas-header");
    cleanUpDrag = setupDragging(headerEl, badgeEl);
    initWindowPosition();

    // Collapse handlers
    rootEl.querySelector("#atlas-header-collapse")?.addEventListener("click", collapse);

    // TTS voice output mute toggle
    const TTS_UNMUTED_SVG = `<svg class="atlas-tts-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const TTS_MUTED_SVG = `<svg class="atlas-tts-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

    const ttsBtn = rootEl.querySelector("#atlas-header-tts");
    if (ttsBtn) {
      if (window.AtlasTTS?.isMuted?.()) {
        ttsBtn.innerHTML = TTS_MUTED_SVG;
        ttsBtn.setAttribute("aria-label", "Unmute voice output");
      }
      ttsBtn.addEventListener("click", () => {
        const isMuted = window.AtlasTTS?.toggleMute?.();
        const mutedNow = typeof isMuted === "boolean" ? isMuted : (window.AtlasTTS?.isMuted?.() ?? false);
        ttsBtn.innerHTML = mutedNow ? TTS_MUTED_SVG : TTS_UNMUTED_SVG;
        ttsBtn.setAttribute("aria-label", mutedNow ? "Unmute voice output" : "Mute voice output");
      });
    }

    modeBtn?.addEventListener("click", () => {
      const nextMode = currentMode === "chat" ? "voice" : "chat";
      updateModeUI(nextMode);
      handlers.onModeChange?.(nextMode);
    });

    // Tab switching
    rootEl.querySelectorAll(".atlas-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        rootEl
          .querySelectorAll(".atlas-tab")
          .forEach((t) => {
            t.classList.remove("atlas-tab-active");
            t.setAttribute("aria-selected", "false");
          });
        tab.classList.add("atlas-tab-active");
        tab.setAttribute("aria-selected", "true");
        const target = tab.dataset.tab;
        rootEl
          .querySelectorAll(".atlas-pane")
          .forEach((p) => p.classList.add("atlas-pane-hidden"));
        rootEl
          .querySelector(`#atlas-pane-${target}`)
          .classList.remove("atlas-pane-hidden");
      });
    });

    // Close handlers (traffic light & fallback)
    const handleClose = () => {
      if (!rootEl) return;
      rootEl.classList.add("atlas-closing");
      setTimeout(() => {
        handlers.onClose?.();
      }, 150);
    };

    rootEl
      .querySelector(".atlas-traffic-close")
      ?.addEventListener("click", handleClose);
    rootEl
      .querySelector(".atlas-close-btn")
      ?.addEventListener("click", handleClose);
    rootEl
      .querySelector(".atlas-close")
      ?.addEventListener("click", handleClose);

    chatInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && chatInputEl.value.trim()) {
        const text = chatInputEl.value.trim();
        chatInputEl.value = "";
        addChatMessage("user", text);
        handlers.onCommandSubmit?.(text);
      }
    });

    micBtn.addEventListener("click", () => handlers.onMicClick?.());
    searchEl.addEventListener("input", () => renderElements(currentItems));

    const triggerRefresh = () => {
      setRefreshing(true);
      handlers.onRefresh?.();
    };

    rootEl
      .querySelector("#atlas-header-refresh")
      ?.addEventListener("click", triggerRefresh);

    // W3C APG Dialog focus trap and Escape key dismissal
    rootEl.addEventListener("keydown", (e) => {
      if (isCollapsed) return;
      if (isTourActive) return;

      if (e.key === "Escape") {
        e.preventDefault();
        collapse();
        return;
      }

      if (e.key === "Tab") {
        const focusableSelector =
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(rootEl.querySelectorAll(focusableSelector)).filter(
          (el) => !el.closest(".atlas-collapsed-badge") && !el.closest(".atlas-pane-hidden")
        );
        if (!focusables.length) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = shadowRoot ? shadowRoot.activeElement : document.activeElement;

        if (e.shiftKey) {
          if (activeEl === first || !rootEl.contains(activeEl)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (activeEl === last || !rootEl.contains(activeEl)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });
  };

  // ── Chat messages ─────────────────────────────────────────────────────────────
  const addChatMessage = (role, text, options = null) => {
    if (!chatLogEl) return;
    const msg = document.createElement("div");
    msg.className = `atlas-msg atlas-msg-${role}`;

    let actionsEl = null;
    if (options && Array.isArray(options.actions) && options.actions.length > 0) {
      actionsEl = document.createElement("div");
      actionsEl.className = "atlas-chat-actions";
      actionsEl.innerHTML = options.actions
        .map((act, idx) => {
          const rawLabel = typeof act === "string" ? act : (act.label || "");
          const label = escapeHtml(rawLabel);
          const isConfirm = /yes|proceed|place|confirm|ok|done|continue|نعم|تأكيد|موافق|استمرار|متابعة|خلصت|كمل/i.test(rawLabel);
          const isCancel = /no|cancel|stop|لا|إلغاء|الغاء|توقف/i.test(rawLabel);
          const extraClass = isConfirm ? "atlas-chip-confirm" : (isCancel ? "atlas-chip-cancel" : "");
          return `<button class="atlas-chip-btn ${extraClass}" data-chip-idx="${idx}">${label}</button>`;
        })
        .join("");
    }

    const bubble = document.createElement("div");
    bubble.className = "atlas-msg-bubble";
    bubble.setAttribute("dir", "auto");
    const textNode = document.createElement("div");
    textNode.className = "atlas-msg-text";
    textNode.setAttribute("dir", "auto");
    textNode.textContent = text;

    const arabicChars = (typeof text === "string" ? text.match(/[\u0600-\u06FF]/g) : null) || [];
    const latinChars = (typeof text === "string" ? text.match(/[A-Za-z]/g) : null) || [];
    if (arabicChars.length > 0 && arabicChars.length > latinChars.length) {
      bubble.setAttribute("lang", "ar");
      textNode.setAttribute("lang", "ar");
    } else if (latinChars.length > 0 && latinChars.length > arabicChars.length) {
      bubble.setAttribute("lang", "en");
      textNode.setAttribute("lang", "en");
    }
    bubble.appendChild(textNode);
    if (actionsEl) {
      bubble.appendChild(actionsEl);
    }
    msg.appendChild(bubble);

    if (options && Array.isArray(options.actions)) {
      msg.querySelectorAll(".atlas-chip-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.chipIdx, 10);
          const act = options.actions[idx];
          const choice = typeof act === "string" ? act : (act.value || act.label);
          // Remove buttons after choice
          msg.querySelector(".atlas-chat-actions")?.remove();
          if (options.onAction) {
            options.onAction(choice, act);
          } else {
            addChatMessage("user", choice);
            handlers.onCommandSubmit?.(choice);
          }
        });
      });
    }

    chatLogEl.appendChild(msg);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  };

  const addChatThinking = () => {
    if (!chatLogEl) return;
    if (chatLogEl.querySelector("#atlas-thinking-indicator") || (shadowRoot && shadowRoot.getElementById("atlas-thinking-indicator")) || document.getElementById("atlas-thinking-indicator")) return;
    const msg = document.createElement("div");
    msg.className = "atlas-msg atlas-msg-agent atlas-msg-thinking";
    msg.id = "atlas-thinking-indicator";
    msg.innerHTML = `
      <div class="atlas-msg-bubble" dir="auto">
        <div class="atlas-typing-indicator" aria-label="Atlas is thinking">
          <span class="atlas-dot"></span>
          <span class="atlas-dot"></span>
          <span class="atlas-dot"></span>
        </div>
      </div>
    `;
    chatLogEl.appendChild(msg);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  };

  const removeThinking = () => {
    (chatLogEl?.querySelector("#atlas-thinking-indicator") || shadowRoot?.getElementById("atlas-thinking-indicator") || document.getElementById("atlas-thinking-indicator"))?.remove();
  };

  const setRefreshing = (isRefreshing) => {
    if (!rootEl) return;
    const btn = rootEl.querySelector("#atlas-header-refresh");
    if (btn) {
      btn.title = isRefreshing ? "Reloading Page Elements & Summary..." : "Reload Page Elements & Summary";
      btn.setAttribute("aria-label", isRefreshing ? "Reloading page analysis" : "Reload page analysis");
    }
    rootEl
      .querySelectorAll(".atlas-refresh-svg, .atlas-refresh-icon")
      .forEach((el) => {
        if (isRefreshing) {
          el.classList.add("atlas-spin");
        } else {
          el.classList.remove("atlas-spin");
        }
      });
  };

  // ── Skeleton loader ───────────────────────────────────────────────────────────
  const setLoading = (isLoading) => {
    if (!listEl || !isLoading) return;
    const isAr = currentLang === "ar-EG";
    const label = isAr ? "جارٍ قراءة عناصر الصفحة..." : "Reading page elements...";
    listEl.innerHTML = `
      <div class="atlas-skeleton-label">${label}</div>
      ${Array.from({ length: 3 })
        .map(
          () => `
        <div class="atlas-skeleton-group">
          <div class="atlas-skeleton-header"></div>
        </div>
      `,
        )
        .join("")}
    `;
  };

  // ── Elements rendering ────────────────────────────────────────────────────────
  const renderElements = (items) => {
    if (!listEl) return;
    currentItems = items;
    const query = (searchEl?.value || "").trim().toLowerCase();
    listEl.innerHTML = "";

    // ── Group by Dynamic Category (AI group, semantic category, or sub-group) ──
    const catMap = new Map();

    for (const item of items) {
      // Priority: explicit AI/element group > category_label > default config label > fallback
      const catKey = item.group || item.category || "other";
      let catLabel = item.group || item.category_label || DEFAULT_CATEGORIES[item.category]?.label || catKey;
      let catEmoji = item.emoji || DEFAULT_CATEGORIES[item.category]?.emoji || "⚙️";

      if (catLabel.length > 0) {
        catLabel = catLabel.charAt(0).toUpperCase() + catLabel.slice(1);
      }

      if (!catMap.has(catKey)) {
        const defaultPriority = DEFAULT_CATEGORIES[item.category]?.priority ?? 50;
        catMap.set(catKey, {
          key: catKey,
          label: catLabel,
          emoji: catEmoji,
          priority: defaultPriority,
          items: [],
        });
      }
      catMap.get(catKey).items.push(item);
    }

    // Sort categories by priority, then alphabetically
    const sortedCategories = Array.from(catMap.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.label.localeCompare(b.label);
    });

    let totalVisible = 0;

    for (const cat of sortedCategories) {
      const filteredItems = query
        ? cat.items.filter((i) => i.label.toLowerCase().includes(query))
        : cat.items;

      if (filteredItems.length === 0) continue;
      totalVisible += filteredItems.length;

      // Categories are collapsed by default on initial load;
      // auto-expand when user searches with a query; respect manual toggle
      const isOpen = query ? true : (groupOpenState[cat.key] ?? false);

      const CHEVRON_DOWN_SVG = `<svg class="atlas-group-chevron-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      const CHEVRON_UP_SVG = `<svg class="atlas-group-chevron-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

      const section = document.createElement("div");
      section.className = "atlas-group";

      const header = document.createElement("button");
      header.className = "atlas-group-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.innerHTML = `
        <span class="atlas-group-title">
          <span class="atlas-group-emoji">${escapeHtml(cat.emoji)}</span>
          ${escapeHtml(cat.label)}
          <span class="atlas-group-count">${filteredItems.length}</span>
        </span>
        <span class="atlas-group-chevron">${isOpen ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG}<span class="atlas-chevron-fallback" style="display:none;" aria-hidden="true">${isOpen ? "▲" : "▼"}</span></span>
      `;

      const body = document.createElement("div");
      body.className = "atlas-group-body";
      if (!isOpen) body.classList.add("atlas-group-collapsed");

      header.addEventListener("click", () => {
        const expanded = header.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        groupOpenState[cat.key] = next;
        header.setAttribute("aria-expanded", String(next));
        const chevronEl = header.querySelector(".atlas-group-chevron");
        if (chevronEl) {
          chevronEl.innerHTML = (next ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG) +
            `<span class="atlas-chevron-fallback" style="display:none;" aria-hidden="true">${next ? "▲" : "▼"}</span>`;
        }
        body.classList.toggle("atlas-group-collapsed", !next);
      });

      for (const item of filteredItems) {
        body.appendChild(makeItemEl(item, query));
      }

      section.appendChild(header);
      section.appendChild(body);
      listEl.appendChild(section);
    }

    if (totalVisible === 0) {
      listEl.innerHTML = query
        ? `<div class="atlas-empty">No elements match "<strong>${escapeHtml(query)}</strong>"</div>`
        : '<div class="atlas-empty">No interactive elements found on this page.</div>';
    }
  };

  const makeItemEl = (item, query) => {
    const el = document.createElement("button");
    el.className = "atlas-item";
    el.setAttribute("role", "listitem");

    const labelSpan = document.createElement("span");
    labelSpan.className = "atlas-item-label";

    const rawLabel = String(item.label || "");
    const trimmedQuery = (query || "").trim();

    if (trimmedQuery && rawLabel.toLowerCase().includes(trimmedQuery.toLowerCase())) {
      const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escapedQuery})`, "gi");
      const parts = rawLabel.split(regex);
      labelSpan.innerHTML = parts
        .map((part) =>
          regex.test(part)
            ? `<mark class="atlas-highlight">${escapeHtml(part)}</mark>`
            : escapeHtml(part)
        )
        .join("");
    } else {
      labelSpan.textContent = rawLabel;
    }

    el.appendChild(labelSpan);
    el.addEventListener("click", () => handlers.onElementClick?.(item.id));
    return el;
  };

  // ── Public API ────────────────────────────────────────────────────────────────
  const mount = (cbs = {}) => {
    // Only mount sidebar in top window frame
    if (typeof window !== "undefined" && window.top && window !== window.top) return;
    handlers = cbs;
    groupOpenState = {};
    if (document.getElementById(ROOT_ID) || document.getElementById(HOST_ID) || (shadowRoot && shadowRoot.getElementById(ROOT_ID))) return;
    buildDom();
  };

  const unmount = () => {
    cleanUpDrag?.();
    cleanUpDrag = null;
    rootEl?.remove();
    rootEl = null;
    hostEl?.remove();
    hostEl = null;
    shadowRoot = null;
    if (typeof window !== "undefined" && window.__atlasShadowRoot) {
      delete window.__atlasShadowRoot;
    }
    statusTextEl = null;
    retryBtnEl = null;
    tourTriggerBtnEl = null;
    tourOverlayEl?.remove();
    tourOverlayEl = null;
    isTourActive = false;
    currentTourStep = 0;
    tourLastFocusedEl = null;
    badgeEl = null;
    badgeStatusDot = null;
    langPill = null;
    progressStripEl = null;
    progressStepTextEl = null;
    progressBarEl = null;
    progressBarFillEl = null;
    milestonesStepperEl = null;
    stopBtnEl = null;
    headerStopBtnEl = null;
    voiceMeterEl = null;
    currentItems = [];
    groupOpenState = {};
    isCollapsed = false;
  };

  const SIDEBAR_OWN_STATUS_MAP = {
    "Ready.": "جاهز.",
    "Connecting...": "جارٍ الاتصال...",
    "Page & Elements refreshed.": "تم تحديث الصفحة والعناصر.",
    "Refreshing page & elements...": "جارٍ تحديث الصفحة والعناصر...",
    "Refresh failed.": "فشل التحديث.",
    "Offline — click to retry": "غير متصل — اضغط لإعادة المحاولة",
    "Awaiting manual click (popup blocked)": "في انتظار النقر اليدوي (تم حظر النافذة المنبثقة)",
    "Awaiting browser credential...": "في انتظار بيانات اعتماد المتصفح...",
    "Browser credential verified": "تم التحقق من بيانات الاعتماد.",
    "Awaiting confirmation": "في انتظار التأكيد...",
    "Resuming goal...": "جارٍ استئناف الهدف...",
    "Awaiting input": "في انتظار البيانات...",
    "Completing action...": "جارٍ إكمال الإجراء...",
    "Executing...": "جارٍ التنفيذ...",
  };

  const setStatus = (text, kind = "info", options = {}) => {
    let displayText = text;
    const isAr = currentLang === "ar-EG";
    if (isAr && typeof text === "string" && SIDEBAR_OWN_STATUS_MAP[text]) {
      displayText = SIDEBAR_OWN_STATUS_MAP[text];
    } else if (isAr && typeof text === "string") {
      const retryMatch = text.match(/^Disconnected — retrying in (\d+)s$/);
      if (retryMatch) {
        displayText = `انقطع الاتصال — إعادة المحاولة خلال ${retryMatch[1]} ث`;
      }
    }

    if (statusTextEl) {
      statusTextEl.textContent = displayText;
    } else if (statusEl) {
      statusEl.textContent = displayText;
    }
    if (statusEl) {
      statusEl.className = `atlas-status atlas-status-${kind}`;
    }
    if (badgeStatusDot) {
      badgeStatusDot.className = `atlas-badge-status-dot atlas-badge-status-${kind}`;
    }
    if (badgeEl) {
      badgeEl.setAttribute("title", isAr ? `أطلس (${displayText}) — اضغط للتوسيع، اسحب للتحريك` : `Atlas (${text}) — Click to expand, drag to move`);
    }

    if (retryBtnEl) {
      const showRetry = options.showRetry || kind === "error" || kind === "offline" || (typeof text === "string" && (text.includes("retrying") || text.includes("Offline")));
      retryBtnEl.style.display = showRetry ? "inline-flex" : "none";
    }
  };

  const setControlsDisabled = (disabled, placeholderText) => {
    if (chatInputEl) {
      chatInputEl.disabled = disabled;
      if (disabled) {
        chatInputEl.setAttribute("aria-disabled", "true");
        if (!chatInputEl.hasAttribute("data-prev-placeholder")) {
          chatInputEl.setAttribute("data-prev-placeholder", chatInputEl.placeholder || "");
        }
        if (placeholderText) chatInputEl.placeholder = placeholderText;
      } else {
        chatInputEl.removeAttribute("aria-disabled");
        const prev = chatInputEl.getAttribute("data-prev-placeholder");
        if (prev) {
          chatInputEl.placeholder = prev;
          chatInputEl.removeAttribute("data-prev-placeholder");
        } else {
          chatInputEl.placeholder = "Ask anything or give a command...";
        }
      }
    }
    if (micBtn) {
      micBtn.disabled = disabled;
      if (disabled) {
        micBtn.setAttribute("aria-disabled", "true");
      } else {
        micBtn.removeAttribute("aria-disabled");
      }
    }
  };

  // ── Goal Progress & Stop Control (Track U2) ──────────────────────────────────
  const setGoalProgress = (goalState) => {
    if (!progressStripEl) return;
    if (!goalState || !Array.isArray(goalState.milestones) || goalState.milestones.length === 0) {
      progressStripEl.style.display = "none";
      return;
    }

    const milestones = goalState.milestones;
    const total = milestones.length;

    // Find active milestone index (1-based)
    let activeIdx = milestones.findIndex(
      (m) => m.id === goalState.active_milestone_id || m.status === "active"
    );
    if (activeIdx === -1) {
      activeIdx = milestones.findIndex((m) => m.status === "pending");
    }
    if (activeIdx === -1) {
      activeIdx = total - 1; // all completed or fallback
    }
    const currentStepNum = activeIdx + 1;
    const activeMilestone = milestones[activeIdx] || milestones[0];
    const desc = activeMilestone?.description || goalState.goal || "Executing...";

    const stepText = `Step ${currentStepNum} of ${total}: ${desc}`;
    if (progressStepTextEl) {
      progressStepTextEl.textContent = stepText;
      progressStepTextEl.setAttribute("title", stepText);
    }

    // Calculate percentage
    const completedCount = milestones.filter((m) => m.status === "completed").length;
    let pct = Math.round((completedCount / total) * 100);
    if (goalState.status === "goal_complete") {
      pct = 100;
    } else if (pct === 0 && currentStepNum > 0) {
      pct = Math.round(((currentStepNum - 0.5) / total) * 100);
    }

    if (progressBarFillEl) {
      progressBarFillEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    if (progressBarEl) {
      progressBarEl.setAttribute("aria-valuenow", String(currentStepNum));
      progressBarEl.setAttribute("aria-valuemin", "1");
      progressBarEl.setAttribute("aria-valuemax", String(total));
      progressBarEl.setAttribute("aria-valuetext", stepText);
    }

    // Render milestone stepper pills
    if (milestonesStepperEl) {
      milestonesStepperEl.innerHTML = milestones
        .map((m, idx) => {
          const isCurrent = idx === activeIdx;
          const statusClass = m.status === "completed"
            ? "atlas-milestone-done"
            : m.status === "failed"
            ? "atlas-milestone-failed"
            : isCurrent
            ? "atlas-milestone-active"
            : "atlas-milestone-pending";
          const icon = m.status === "completed"
            ? "✓"
            : m.status === "failed"
            ? "✕"
            : (idx + 1);
          const safeDesc = escapeHtml(m.description || `Step ${idx + 1}`);
          return `
            <div class="atlas-milestone-pill ${statusClass}" role="listitem" title="${safeDesc}">
              <span class="atlas-milestone-icon">${icon}</span>
              <span class="atlas-milestone-label">${safeDesc}</span>
            </div>
          `;
        })
        .join("");
    }

    progressStripEl.style.display = "flex";
  };

  const hideGoalProgress = () => {
    if (progressStripEl) {
      progressStripEl.style.display = "none";
    }
    if (progressBarFillEl) {
      progressBarFillEl.style.width = "0%";
    }
  };

  const setExecuting = (isExecuting) => {
    if (!rootEl) return;
    rootEl.classList.toggle("atlas-executing", Boolean(isExecuting));
    if (stopBtnEl) {
      stopBtnEl.classList.toggle("atlas-stop-active", Boolean(isExecuting));
    }
    if (headerStopBtnEl) {
      headerStopBtnEl.classList.toggle("atlas-stop-active", Boolean(isExecuting));
    }
  };

  // ── Live Voice Level Meter (Track U4) ────────────────────────────────────────
  const setVoiceLevel = (level, bars) => {
    if (!voiceMeterEl) return;
    const barEls = voiceMeterEl.querySelectorAll(".atlas-meter-bar");
    if (!barEls || barEls.length === 0) return;

    if (Array.isArray(bars) && bars.length === barEls.length) {
      barEls.forEach((bar, idx) => {
        const val = Math.max(0.15, Math.min(1.0, bars[idx]));
        bar.style.transform = `scaleY(${val.toFixed(2)})`;
      });
    } else {
      const clampedLevel = Math.max(0.15, Math.min(1.0, typeof level === "number" ? level : 0.15));
      barEls.forEach((bar) => {
        bar.style.transform = `scaleY(${clampedLevel.toFixed(2)})`;
      });
    }
  };

  const setListening = (isListening) => {
    micBtn?.classList.toggle("atlas-mic-active", isListening);
    voiceMeterEl?.classList.toggle("atlas-meter-active", isListening);
    if (!isListening) {
      setVoiceLevel(0.15);
    }
  };

  const CHAT_MODE_SVG = `<svg class="atlas-chat-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const VOICE_MODE_SVG = `<svg class="atlas-voice-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

  const updateModeUI = (mode) => {
    currentMode = mode;
    if (!modeBtn) return;
    const isVoice = mode === "voice";
    const isAr = currentLang === "ar-EG";
    modeBtn.classList.toggle("atlas-mode-voice", isVoice);
    const icon = modeBtn.querySelector(".atlas-mode-icon");
    const text = modeBtn.querySelector(".atlas-mode-text");
    if (icon) icon.innerHTML = isVoice ? VOICE_MODE_SVG : CHAT_MODE_SVG;
    if (text) text.textContent = isVoice ? (isAr ? "صوت" : "Voice") : (isAr ? "محادثة" : "Chat");
    modeBtn.setAttribute(
      "aria-label",
      isVoice
        ? (isAr ? "وضع الصوت مفعّل — يقرأ الردود بصوت عالٍ (اضغط لوضع المحادثة)" : "Voice Mode active — reads responses aloud (click for Chat Mode)")
        : (isAr ? "وضع المحادثة مفعّل — ردود نصية صامتة (اضغط لوضع الصوت)" : "Chat Mode active — silent text responses (click for Voice Mode)"),
    );
  };

  // ── Unified Atlas Language Management (WS3) ──────────────────────────────────
  const updateLangPillUI = (lang) => {
    currentLang = (lang === "ar-EG" || (typeof lang === "string" && lang.startsWith("ar"))) ? "ar-EG" : "en-US";
    currentVoiceLang = currentLang;
    if (!langPill) return;
    const isAr = currentLang === "ar-EG";
    langPill.textContent = isAr ? "AR" : "EN";
    langPill.classList.toggle("atlas-lang-ar", isAr);
    langPill.setAttribute(
      "aria-label",
      isAr
        ? "AR — Atlas language: Arabic — لغة أطلس: العربية (اضغط للتحويل إلى الإنجليزية)"
        : "EN — Atlas language: English (click to switch to Arabic)"
    );
    langPill.title = isAr ? "Atlas language: Arabic (انقر للتبديل للإنجليزية)" : "Atlas language: English (click for Arabic)";
  };

  const applyChromeLocalization = (lang) => {
    if (!rootEl) return;
    const isAr = lang === "ar-EG" || (typeof lang === "string" && lang.startsWith("ar"));

    // Mode button
    updateModeUI(currentMode);

    // Tabs
    const chatTab = rootEl.querySelector('.atlas-tab[data-tab="chat"]');
    if (chatTab) chatTab.textContent = isAr ? "محادثة" : "Chat";
    const elementsTab = rootEl.querySelector('.atlas-tab[data-tab="elements"]');
    if (elementsTab) elementsTab.textContent = isAr ? "العناصر" : "Elements";

    // Stop button
    if (stopBtnEl) {
      const stopLbl = stopBtnEl.querySelector(".atlas-stop-label");
      if (stopLbl) stopLbl.textContent = isAr ? "إيقاف" : "Stop";
      stopBtnEl.setAttribute("aria-label", isAr ? "إيقاف تنفيذ الهدف (يوقف الوكيل فوراً)" : "Stop goal execution (Halts agent mid-hop)");
      stopBtnEl.title = isAr ? "إيقاف تنفيذ الهدف (يوقف الوكيل فوراً)" : "Stop goal execution (Halts agent mid-hop)";
    }
    if (headerStopBtnEl) {
      const headerStopLbl = headerStopBtnEl.querySelector(".atlas-stop-header-label");
      if (headerStopLbl) headerStopLbl.textContent = isAr ? "إيقاف" : "Stop";
      headerStopBtnEl.setAttribute("aria-label", isAr ? "إيقاف التنفيذ" : "Stop execution");
      headerStopBtnEl.title = isAr ? "إيقاف التنفيذ" : "Stop execution";
    }

    // Goal badge
    const badge = rootEl.querySelector(".atlas-progress-badge");
    if (badge) badge.textContent = isAr ? "الهدف" : "GOAL";

    // Text scale button
    const textScaleBtn = rootEl.querySelector("#atlas-header-text-scale");
    if (textScaleBtn) {
      textScaleBtn.setAttribute("aria-label", isAr ? "تغيير حجم النص (عادي، كبير، كبير جداً)" : "Adjust text scaling (Normal, Large, XL)");
      textScaleBtn.title = isAr ? "تغيير حجم النص" : "Adjust text scaling";
    }

    // TTS toggle button
    const ttsBtn = rootEl.querySelector("#atlas-header-tts");
    if (ttsBtn) {
      ttsBtn.setAttribute("aria-label", isAr ? "تشغيل/كتم الصوت" : "Toggle voice output");
      ttsBtn.title = isAr ? "تشغيل/كتم الصوت" : "Toggle voice output";
    }

    // Refresh button
    const refreshBtn = rootEl.querySelector("#atlas-header-refresh");
    if (refreshBtn) {
      refreshBtn.setAttribute("aria-label", isAr ? "إعادة تحميل تحليل الصفحة" : "Reload page analysis");
      refreshBtn.title = isAr ? "إعادة تحميل عناصر الصفحة والملخص" : "Reload Page Elements & Summary";
    }

    // Tour trigger button
    if (tourTriggerBtnEl) {
      tourTriggerBtnEl.setAttribute("aria-label", isAr ? "بدء الجولة الإرشادية" : "Start guided tour");
      tourTriggerBtnEl.title = isAr ? "جولة تعريفية في أطلس (الجولة الإرشادية)" : "Take a tour of Atlas (Guided Tour)";
    }

    // Collapse button
    const collapseBtn = rootEl.querySelector("#atlas-header-collapse");
    if (collapseBtn) {
      collapseBtn.setAttribute("aria-label", isAr ? "تصغير أطلس" : "Collapse Atlas");
      collapseBtn.title = isAr ? "تصغير" : "Collapse";
    }

    // Close button
    const closeBtn = rootEl.querySelector("#atlas-header-close");
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", isAr ? "إغلاق مساعد أطلس" : "Close Atlas Assistant");
      closeBtn.title = isAr ? "إغلاق مساعد أطلس" : "Close Atlas Assistant";
    }

    // Chat input placeholder
    if (chatInputEl) {
      chatInputEl.placeholder = isAr ? "اسأل أي شيء أو أعطِ أمراً..." : "Ask anything or give a command...";
    }

    // Mic button
    if (micBtn) {
      micBtn.setAttribute("aria-label", isAr ? "تحدث بأمر صوتي" : "Speak a command");
      micBtn.title = isAr ? "أمر صوتي" : "Voice command";
    }

    // Elements search input placeholder
    if (searchEl) {
      searchEl.placeholder = isAr ? "بحث في الأزرار، الحقول، الروابط..." : "Search buttons, inputs, links...";
    }

    // Retry button
    if (retryBtnEl) {
      const retryText = retryBtnEl.querySelector("span");
      if (retryText) retryText.textContent = isAr ? "إعادة المحاولة الآن" : "Retry connection now";
      retryBtnEl.setAttribute("aria-label", isAr ? "إعادة محاولة الاتصال الآن" : "Retry connection now");
    }

    // Resume button
    if (resumeBtnEl) {
      const resumeLbl = resumeBtnEl.querySelector(".atlas-resume-label");
      if (resumeLbl) resumeLbl.textContent = isAr ? "استئناف" : "Resume";
      resumeBtnEl.setAttribute("aria-label", isAr ? "استئناف التنفيذ" : "Resume execution");
    }

    // Assisted open button
    if (assistedOpenBtnEl) {
      const openLbl = assistedOpenBtnEl.querySelector(".atlas-assisted-open-label");
      if (openLbl) openLbl.textContent = isAr ? "فتح النافذة" : "Open Popup";
      assistedOpenBtnEl.setAttribute("aria-label", isAr ? "فتح النافذة المنبثقة المحظورة" : "Open blocked popup window");
    }

    // Initial status text if showing ready state
    if (statusTextEl && (statusTextEl.textContent === "Ready." || statusTextEl.textContent === "جاهز.")) {
      statusTextEl.textContent = isAr ? "جاهز." : "Ready.";
    }
  };

  const setLanguage = (lang, syncStorage = true) => {
    const targetLang = (lang === "ar-EG" || (typeof lang === "string" && lang.startsWith("ar"))) ? "ar-EG" : "en-US";
    currentLang = targetLang;
    currentVoiceLang = targetLang;
    updateLangPillUI(targetLang);

    // Keep window.AtlasSpeech.getLanguage() in sync at all times
    if (typeof window !== "undefined" && window.AtlasSpeech?.setLanguage) {
      try {
        window.AtlasSpeech.setLanguage(targetLang, false);
      } catch (_) {}
    }

    if (syncStorage && typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      try {
        chrome.storage.local.set({ atlas_lang: targetLang, atlas_voice_lang: targetLang });
      } catch (_) {}
    }

    applyChromeLocalization(targetLang);
    return targetLang;
  };

  const setVoiceLanguage = (lang) => setLanguage(lang);

  const toggleLanguage = () => {
    const next = currentLang === "ar-EG" ? "en-US" : "ar-EG";
    return setLanguage(next);
  };

  const toggleVoiceLanguage = () => toggleLanguage();

  const handleSpeechTranscript = (transcript) => {
    if (typeof transcript === "string" && /[\u0600-\u06FF]/.test(transcript)) {
      setLanguage("ar-EG");
      return true;
    }
    return false;
  };

  if (typeof chrome !== "undefined" && chrome.storage?.onChanged?.addListener) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
          if (changes.atlas_lang && changes.atlas_lang.newValue) {
            setLanguage(changes.atlas_lang.newValue, false);
          } else if (changes.atlas_voice_lang && changes.atlas_voice_lang.newValue) {
            setLanguage(changes.atlas_voice_lang.newValue, false);
          }
        }
      });
    } catch (_) {}
  }

  // ── Guided Tour Controller (Task U7) ─────────────────────────────────────────
  const TOUR_STEPS = [
    {
      step: 1,
      title: "Open Atlas Anywhere",
      desc: "Summon Atlas on any webpage with Alt+A or by clicking the extension icon. You can also drag the window or minimize it into a compact floating badge at any time.",
      shortcut: "Alt + A",
      badgeLabel: "Global Shortcut",
      highlightTarget: ".atlas-header",
    },
    {
      step: 2,
      title: "Chat & Voice Commands",
      desc: "Ask questions about this page or state what you want to do in plain language. Type in the chat input or click the microphone for hands-free voice control (English & Arabic).",
      shortcut: "🎤 Voice / 💬 Chat",
      badgeLabel: "Bilingual Input",
      highlightTarget: ".atlas-chat-input-bar",
    },
    {
      step: 3,
      title: "Watch Atlas Navigate",
      desc: "Atlas plans actions, tracks milestones in real time, and pauses for sensitive confirmations. Press the red Stop button at any time to immediately halt execution mid-hop.",
      shortcut: "■ Emergency Stop",
      badgeLabel: "Safe Autonomous Control",
      highlightTarget: "#atlas-progress-strip",
    },
  ];

  const AR_TOUR_STEPS = [
    {
      step: 1,
      title: "افتح أطلس من أي مكان",
      desc: "استدعِ أطلس على أي صفحة ويب باستخدام Alt+A أو بالنقر على أيقونة الإضافة. يمكنك أيضاً سحب النافذة أو تصغيرها إلى شارة عائمة في أي وقت.",
      shortcut: "Alt + A",
      badgeLabel: "اختصار عام",
      highlightTarget: ".atlas-header",
    },
    {
      step: 2,
      title: "الأوامر النصية والصوتية",
      desc: "اطرح أسئلة حول هذه الصفحة أو اذكر ما تريد القيام به بلغة طبيعية. اكتب في المحادثة أو انقر فوق الميكروفون للتحكم الصوتي (بالإنجليزية والعربية).",
      shortcut: "🎤 صوت / 💬 محادثة",
      badgeLabel: "إدخال ثنائي اللغة",
      highlightTarget: ".atlas-chat-input-bar",
    },
    {
      step: 3,
      title: "شاهد أطلس يتنقل",
      desc: "يخطط أطلس للإجراءات، ويتتبع المراحل في الوقت الفعلي، ويتوقف مؤقتاً عند التأكيدات الحساسة. اضغط على زر الإيقاف الأحمر في أي وقت لإيقاف التنفيذ فوراً.",
      shortcut: "■ إيقاف طوارئ",
      badgeLabel: "تحكم ذاتي آمن",
      highlightTarget: "#atlas-progress-strip",
    },
  ];

  const renderTourStep = (stepIdx) => {
    if (!tourOverlayEl || !rootEl) return;
    const isAr = currentLang === "ar-EG";
    currentTourStep = Math.max(0, Math.min(stepIdx, TOUR_STEPS.length - 1));
    const step = isAr ? AR_TOUR_STEPS[currentTourStep] : TOUR_STEPS[currentTourStep];
    const isFirst = currentTourStep === 0;
    const isLast = currentTourStep === TOUR_STEPS.length - 1;

    tourOverlayEl.innerHTML = `
      <div class="atlas-tour-card" role="document" dir="${isAr ? "rtl" : "ltr"}" lang="${isAr ? "ar" : "en"}">
        <div class="atlas-tour-header">
          <span class="atlas-tour-badge" aria-live="polite">${isAr ? `الخطوة ${step.step} من ${TOUR_STEPS.length}` : `Step ${step.step} of ${TOUR_STEPS.length}`}</span>
          <button class="atlas-tour-close-btn" id="atlas-tour-close" type="button" aria-label="${isAr ? "إغلاق الجولة الإرشادية" : "Close guided tour"}" title="${isAr ? "إغلاق الجولة (Esc)" : "Close tour (Esc)"}">✕</button>
        </div>

        <div class="atlas-tour-body">
          <h2 class="atlas-tour-title" id="atlas-tour-title">${escapeHtml(step.title)}</h2>
          <p class="atlas-tour-desc" id="atlas-tour-desc">${escapeHtml(step.desc)}</p>
          
          <div class="atlas-tour-callout">
            <span class="atlas-tour-callout-tag">${escapeHtml(step.badgeLabel)}</span>
            <span class="atlas-tour-callout-val">${escapeHtml(step.shortcut)}</span>
          </div>
        </div>

        <div class="atlas-tour-dots" role="tablist" aria-label="Tour step indicators">
          ${TOUR_STEPS.map((_, i) => `
            <span class="atlas-tour-dot ${i === currentTourStep ? 'active' : ''}" 
                  role="tab" 
                  aria-selected="${i === currentTourStep ? 'true' : 'false'}"
                  aria-label="Step ${i + 1}"></span>
          `).join('')}
        </div>

        <div class="atlas-tour-footer">
          <label class="atlas-tour-checkbox-label" for="atlas-tour-dont-show">
            <input type="checkbox" id="atlas-tour-dont-show" class="atlas-tour-checkbox" />
            <span>${isAr ? "عدم الإظهار مرة أخرى" : "Don't show again"}</span>
          </label>

          <div class="atlas-tour-actions">
            <button type="button" class="atlas-tour-btn atlas-tour-btn-secondary atlas-tour-prev-btn" 
                    id="atlas-tour-prev" ${isFirst ? 'disabled aria-disabled="true"' : ''} 
                    aria-label="${isAr ? "الرجوع للخطوة السابقة" : "Back to previous step"}">${isAr ? "← السابق" : "← Back"}</button>
            
            <button type="button" class="atlas-tour-btn atlas-tour-btn-primary atlas-tour-next-btn" 
                    id="atlas-tour-next" 
                    aria-label="${isLast ? (isAr ? 'إنهاء الجولة' : 'Finish Tour') : (isAr ? 'الخطوة التالية' : 'Next step')}">
              ${isLast ? (isAr ? 'إنهاء الجولة ✓' : 'Finish Tour ✓') : (isAr ? 'التالي ←' : 'Next →')}
            </button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = tourOverlayEl.querySelector("#atlas-tour-close");
    const prevBtn = tourOverlayEl.querySelector("#atlas-tour-prev");
    const nextBtn = tourOverlayEl.querySelector("#atlas-tour-next");
    const dontShow = tourOverlayEl.querySelector("#atlas-tour-dont-show");

    closeBtn?.addEventListener("click", () => dismissTour(dontShow?.checked || false));
    prevBtn?.addEventListener("click", () => prevTourStep());
    nextBtn?.addEventListener("click", () => {
      if (isLast) {
        dismissTour(true);
      } else {
        nextTourStep();
      }
    });

    rootEl.querySelectorAll(".atlas-tour-highlighted").forEach((el) => el.classList.remove("atlas-tour-highlighted"));
    if (step.highlightTarget) {
      const target = rootEl.querySelector(step.highlightTarget);
      target?.classList.add("atlas-tour-highlighted");
    }

    setTimeout(() => {
      nextBtn?.focus();
    }, 30);
  };

  const startTour = (step = 0) => {
    if (!rootEl) return;
    if (isCollapsed) expand();

    isTourActive = true;
    tourLastFocusedEl = shadowRoot ? shadowRoot.activeElement : (typeof document !== 'undefined' ? document.activeElement : null);

    if (!tourOverlayEl) {
      tourOverlayEl = document.createElement("div");
      tourOverlayEl.id = "atlas-tour-overlay";
      tourOverlayEl.className = "atlas-tour-overlay";
      tourOverlayEl.setAttribute("role", "dialog");
      tourOverlayEl.setAttribute("aria-modal", "true");
      tourOverlayEl.setAttribute("aria-labelledby", "atlas-tour-title");
      tourOverlayEl.setAttribute("aria-describedby", "atlas-tour-desc");

      tourOverlayEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          const dontShow = tourOverlayEl.querySelector("#atlas-tour-dont-show");
          dismissTour(dontShow?.checked || false);
          return;
        }

        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          const dontShow = tourOverlayEl.querySelector("#atlas-tour-dont-show");
          if (e.target !== dontShow) {
            e.preventDefault();
            e.stopPropagation();
            nextTourStep();
            return;
          }
        }

        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          const dontShow = tourOverlayEl.querySelector("#atlas-tour-dont-show");
          if (e.target !== dontShow) {
            e.preventDefault();
            e.stopPropagation();
            prevTourStep();
            return;
          }
        }

        if (e.key === "Tab") {
          const focusableSelector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
          const focusables = Array.from(tourOverlayEl.querySelectorAll(focusableSelector)).filter(
            (el) => !el.disabled && el.style.display !== "none"
          );
          if (!focusables.length) return;

          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const activeEl = shadowRoot ? shadowRoot.activeElement : (typeof document !== 'undefined' ? document.activeElement : null);

          if (e.shiftKey) {
            if (activeEl === first || !tourOverlayEl.contains(activeEl)) {
              e.preventDefault();
              e.stopPropagation();
              last.focus();
            }
          } else {
            if (activeEl === last || !tourOverlayEl.contains(activeEl)) {
              e.preventDefault();
              e.stopPropagation();
              first.focus();
            }
          }
        }
      });

      rootEl.appendChild(tourOverlayEl);
    }

    tourOverlayEl.style.display = "flex";
    renderTourStep(step);
  };

  const dismissTour = (savePreference = false) => {
    isTourActive = false;
    if (tourOverlayEl) {
      tourOverlayEl.style.display = "none";
    }
    rootEl?.querySelectorAll(".atlas-tour-highlighted").forEach((el) => el.classList.remove("atlas-tour-highlighted"));

    if (savePreference && typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      try {
        chrome.storage.local.set({ atlas_tour_completed: true });
      } catch (_) {}
    }

    if (tourLastFocusedEl && typeof tourLastFocusedEl.focus === "function") {
      try {
        tourLastFocusedEl.focus();
      } catch (_) {}
    } else {
      chatInputEl?.focus();
    }
  };

  const nextTourStep = () => {
    if (currentTourStep < TOUR_STEPS.length - 1) {
      renderTourStep(currentTourStep + 1);
    }
  };

  const prevTourStep = () => {
    if (currentTourStep > 0) {
      renderTourStep(currentTourStep - 1);
    }
  };

  const resetTour = () => {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      chrome.storage.local.set({ atlas_tour_completed: false });
    }
  };

  const AtlasSidebar = {
    mount,
    unmount,
    collapse,
    expand,
    toggleCollapse,
    isCollapsed: () => isCollapsed,
    getHost: () => hostEl,
    getShadowRoot: () => shadowRoot,
    getRoot: () => rootEl,
    getChatInput: () => chatInputEl,
    renderElements,
    deriveDisplayItems,
    setStatus,
    setListening,
    setLoading,
    setRefreshing,
    addChatMessage,
    addChatThinking,
    removeThinking,
    getMode: () => currentMode,
    setMode: updateModeUI,
    getLanguage: () => currentLang,
    setLanguage,
    toggleLanguage,
    getVoiceLanguage: () => currentLang,
    setVoiceLanguage,
    toggleVoiceLanguage,
    handleSpeechTranscript,
    checkAutoStickyArabic: handleSpeechTranscript,
    setGoalProgress,
    hideGoalProgress,
    setExecuting,
    getTextScale: () => currentTextScale,
    setTextScale,
    cycleTextScale,
    setVoiceLevel,
    setControlsDisabled,
    startTour,
    dismissTour,
    nextTourStep,
    prevTourStep,
    getTourStep: () => currentTourStep,
    isTourActive: () => isTourActive,
    resetTour,
    setAutoHide,
    isAutoHidden: () => isAutoHiddenForExecution,
    isCompactMode: () => isCompactViewport(),
    checkViewportResponsive,
    elementFromPoint: elementFromPointExcludingAtlas,
    showResumeButton,
    hideResumeButton,
    showAssistedClickPrompt,
    hideAssistedClickPrompt,
    showAssistedOpenButton,
    hideAssistedOpenButton,
    setGuidedAuthMode,
    applyPosition,
    resetPosition,
    getCollapsedSize,
    PILL_SIZE: COMPACT_PILL_SIZE,
    COMPACT_VIEWPORT_THRESHOLD,
  };

  if (typeof window !== "undefined") {
    window.AtlasSidebar = AtlasSidebar;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AtlasSidebar;
  }
})();

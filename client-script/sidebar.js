(function () {
  // sidebar.js — Apple-Style Floating Window + Grouped Panel & Chat

  const ROOT_ID = "atlas-sidebar-root";
  const DEFAULT_WIDTH = 348;
  const DEFAULT_HEIGHT = 520;
  const COLLAPSED_SIZE = 52;
  const VIEWPORT_PADDING = 12;
  const SCROLLBAR_CLEARANCE = 20;

  let rootEl = null;
  let listEl = null;
  let statusEl = null;
  let chatInputEl = null;
  let searchEl = null;
  let micBtn = null;
  let modeBtn = null;
  let chatLogEl = null;
  let badgeEl = null;
  let badgeStatusDot = null;
  let handlers = {};
  let currentItems = [];
  let groupOpenState = {};
  let currentMode = "chat"; // 'chat' | 'voice'
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
    const width = isCollapsed ? COLLAPSED_SIZE : (rootEl.offsetWidth || DEFAULT_WIDTH);
    const height = isCollapsed ? COLLAPSED_SIZE : (rootEl.offsetHeight || DEFAULT_HEIGHT);
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
    const width = isCollapsed ? COLLAPSED_SIZE : DEFAULT_WIDTH;
    const height = isCollapsed ? COLLAPSED_SIZE : DEFAULT_HEIGHT;
    const defaultX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - 24);
    const defaultY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - 24);
    const pos = applyPosition(defaultX, defaultY);
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ atlasWindowPos: pos });
    }
  };

  const collapse = () => {
    if (!rootEl || isCollapsed) return;
    isCollapsed = true;
    rootEl.classList.add("atlas-collapsed");
    rootEl.setAttribute("aria-expanded", "false");

    // Re-clamp position for circular notch dimensions
    const rect = rootEl.getBoundingClientRect();
    applyPosition(rect.left, rect.top);

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ atlasIsCollapsed: true });
    }
  };

  const expand = () => {
    if (!rootEl || !isCollapsed) return;
    isCollapsed = false;
    rootEl.classList.remove("atlas-collapsed");
    rootEl.setAttribute("aria-expanded", "true");

    // Overlap project edge case: Auto-adjust position if expanding pushes it past the right or bottom
    const rect = rootEl.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - DEFAULT_WIDTH - SCROLLBAR_CLEARANCE);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - DEFAULT_HEIGHT - VIEWPORT_PADDING);
    const targetX = clamp(rect.left, VIEWPORT_PADDING, maxX);
    const targetY = clamp(rect.top, VIEWPORT_PADDING, maxY);
    applyPosition(targetX, targetY);

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
      });
    } else {
      applyPosition(defaultX, defaultY);
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

  // ── DOM construction ──────────────────────────────────────────────────────────
  const buildDom = () => {
    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;
    rootEl.setAttribute("role", "dialog");
    rootEl.setAttribute("aria-label", "Atlas Accessibility Assistant");

    rootEl.innerHTML = `
    <!-- macOS Window Titlebar / Header -->
    <div class="atlas-header" title="Drag to move Atlas window (Double-click to reset)">
      <div class="atlas-traffic-lights">
        <button class="atlas-traffic-btn atlas-traffic-close" aria-label="Close Atlas window" title="Close">
          <span class="atlas-traffic-close-icon">✕</span>
        </button>
        <button class="atlas-traffic-btn atlas-traffic-minimize" aria-label="Minimize to notch" title="Collapse">
          <span class="atlas-traffic-minimize-icon">−</span>
        </button>
      </div>

      <span class="atlas-title">Atlas</span>

      <div class="atlas-tab-bar" role="tablist">
        <button class="atlas-tab atlas-tab-active" data-tab="chat" role="tab" aria-selected="true">Chat</button>
        <button class="atlas-tab" data-tab="elements" role="tab" aria-selected="false">Elements</button>
      </div>

      <div class="atlas-header-actions">
        <button class="atlas-refresh-btn" id="atlas-header-refresh" aria-label="Reload page analysis" title="Reload Page Elements & Summary">
          <svg class="atlas-refresh-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
          <span class="atlas-refresh-label">Reload</span>
        </button>
        <button class="atlas-collapse-btn" id="atlas-header-collapse" aria-label="Collapse Atlas" title="Collapse">
          <svg class="atlas-collapse-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <!-- Fallback close button for accessibility / test compatibility -->
        <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
      </div>
    </div>

    <!-- Hoisted Status Bar (Visible & Accessible Across All Tabs) -->
    <div class="atlas-status" aria-live="polite"></div>

    <!-- CHAT TAB PANE -->
    <div class="atlas-pane" id="atlas-pane-chat">
      <div class="atlas-chat-log" id="atlas-chat-log" role="log" aria-live="polite"></div>
      <div class="atlas-chat-input-bar">
        <button class="atlas-mode-btn" id="atlas-mode-toggle" aria-label="Toggle Voice Mode" title="Switch between Chat and Voice Mode">
          <span class="atlas-mode-icon">💬</span>
          <span class="atlas-mode-text">Chat</span>
        </button>
        <input class="atlas-chat-input" type="text"
          placeholder="Ask anything or give a command..." />
        <button class="atlas-mic-btn" aria-label="Speak a command" title="Voice command">🎤</button>
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

    document.body.appendChild(rootEl);

    listEl = rootEl.querySelector(".atlas-list");
    statusEl = rootEl.querySelector(".atlas-status");
    chatInputEl = rootEl.querySelector(".atlas-chat-input");
    searchEl = rootEl.querySelector(".atlas-search");
    micBtn = rootEl.querySelector(".atlas-mic-btn");
    modeBtn = rootEl.querySelector("#atlas-mode-toggle");
    chatLogEl = rootEl.querySelector("#atlas-chat-log");
    badgeEl = rootEl.querySelector(".atlas-collapsed-badge");
    badgeStatusDot = rootEl.querySelector(".atlas-badge-status-dot");

    const headerEl = rootEl.querySelector(".atlas-header");
    cleanUpDrag = setupDragging(headerEl, badgeEl);
    initWindowPosition();

    // Collapse handlers
    rootEl.querySelector("#atlas-header-collapse")?.addEventListener("click", collapse);
    rootEl.querySelector(".atlas-traffic-minimize")?.addEventListener("click", collapse);

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
          const isConfirm = /yes|proceed|place|confirm|ok/i.test(rawLabel);
          const isCancel = /no|cancel|stop/i.test(rawLabel);
          const extraClass = isConfirm ? "atlas-chip-confirm" : (isCancel ? "atlas-chip-cancel" : "");
          return `<button class="atlas-chip-btn ${extraClass}" data-chip-idx="${idx}">${label}</button>`;
        })
        .join("");
    }

    const bubble = document.createElement("div");
    bubble.className = "atlas-msg-bubble";
    const textNode = document.createElement("div");
    textNode.className = "atlas-msg-text";
    textNode.textContent = text;
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
    if (document.getElementById("atlas-thinking-indicator")) return;
    const msg = document.createElement("div");
    msg.className = "atlas-msg atlas-msg-agent atlas-msg-thinking";
    msg.id = "atlas-thinking-indicator";
    msg.innerHTML = `
      <div class="atlas-msg-bubble">
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
    document.getElementById("atlas-thinking-indicator")?.remove();
  };

  const setRefreshing = (isRefreshing) => {
    if (!rootEl) return;
    rootEl
      .querySelectorAll(".atlas-refresh-svg, .atlas-refresh-icon")
      .forEach((el) => {
        if (isRefreshing) {
          el.classList.add("atlas-spin");
        } else {
          el.classList.remove("atlas-spin");
        }
      });
    const labelEl = rootEl.querySelector(".atlas-refresh-label");
    if (labelEl) {
      labelEl.textContent = isRefreshing ? "Reloading..." : "Reload";
    }
  };

  // ── Skeleton loader ───────────────────────────────────────────────────────────
  const setLoading = (isLoading) => {
    if (!listEl || !isLoading) return;
    listEl.innerHTML = `
      <div class="atlas-skeleton-label">Reading page elements...</div>
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
        <span class="atlas-group-chevron">${isOpen ? "▲" : "▼"}</span>
      `;

      const body = document.createElement("div");
      body.className = "atlas-group-body";
      if (!isOpen) body.classList.add("atlas-group-collapsed");

      header.addEventListener("click", () => {
        const expanded = header.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        groupOpenState[cat.key] = next;
        header.setAttribute("aria-expanded", String(next));
        header.querySelector(".atlas-group-chevron").textContent = next
          ? "▲"
          : "▼";
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
    handlers = cbs;
    groupOpenState = {};
    if (document.getElementById(ROOT_ID)) return;
    buildDom();
  };

  const unmount = () => {
    cleanUpDrag?.();
    cleanUpDrag = null;
    rootEl?.remove();
    rootEl = null;
    badgeEl = null;
    badgeStatusDot = null;
    currentItems = [];
    groupOpenState = {};
    isCollapsed = false;
  };

  const setStatus = (text, kind = "info") => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = `atlas-status atlas-status-${kind}`;
    }
    if (badgeStatusDot) {
      badgeStatusDot.className = `atlas-badge-status-dot atlas-badge-status-${kind}`;
    }
    if (badgeEl) {
      badgeEl.setAttribute("title", `Atlas (${text}) — Click to expand, drag to move`);
    }
  };

  const setListening = (isListening) => {
    micBtn?.classList.toggle("atlas-mic-active", isListening);
  };

  const updateModeUI = (mode) => {
    currentMode = mode;
    if (!modeBtn) return;
    const isVoice = mode === "voice";
    modeBtn.classList.toggle("atlas-mode-voice", isVoice);
    const icon = modeBtn.querySelector(".atlas-mode-icon");
    const text = modeBtn.querySelector(".atlas-mode-text");
    if (icon) icon.textContent = isVoice ? "🔊" : "💬";
    if (text) text.textContent = isVoice ? "Voice" : "Chat";
    modeBtn.setAttribute(
      "aria-label",
      isVoice
        ? "Voice Mode active — reads responses aloud (click for Chat Mode)"
        : "Chat Mode active — silent text responses (click for Voice Mode)",
    );
  };

  window.AtlasSidebar = {
    mount,
    unmount,
    collapse,
    expand,
    toggleCollapse,
    isCollapsed: () => isCollapsed,
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
  };
})();

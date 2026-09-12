(function () {
  // sidebar.js — Apple-Style Floating Window + Grouped Panel & Chat

  const ROOT_ID = "atlas-sidebar-root";
  const DEFAULT_WIDTH = 348;
  const DEFAULT_HEIGHT = 520;
  const VIEWPORT_PADDING = 12;

  let rootEl = null;
  let listEl = null;
  let statusEl = null;
  let chatInputEl = null;
  let searchEl = null;
  let micBtn = null;
  let modeBtn = null;
  let chatLogEl = null;
  let handlers = {};
  let currentItems = [];
  let groupOpenState = {};
  let currentMode = "chat"; // 'chat' | 'voice'

  // Drag state cleanup ref
  let cleanUpDrag = null;

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

    // 1. Files, Folders & Documents (Google Drive, Cloud storage, attachments, file lists)
    if (
      /\.(pdf|docx?|pptx?|xlsx?|csv|zip|rar|tar|gz|7z|txt|png|jpe?g|gif|svg|mp[34]|avi|mkv|json|py|js|html|epub)\b/i.test(rawLabel) ||
      ((role === "row" || role === "treeitem" || role === "gridcell") && !/^(home|activity|my drive|shared|trash|starred|recent|spam|storage)\b/i.test(l)) ||
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
      /\b(home|activity|workspaces|my drive|shared with me|recent|starred|spam|trash|storage|computers|dashboard|explore|subscriptions|library|overview|menu|back|forward|next|previous|page)\b/i.test(l)
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

  // ── Window Positioning & Dragging ─────────────────────────────────────────────
  const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

  const applyPosition = (x, y) => {
    if (!rootEl) return;
    const width = rootEl.offsetWidth || DEFAULT_WIDTH;
    const height = rootEl.offsetHeight || DEFAULT_HEIGHT;
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
    const clampedX = clamp(x, VIEWPORT_PADDING, maxX);
    const clampedY = clamp(y, VIEWPORT_PADDING, maxY);

    rootEl.style.left = `${clampedX}px`;
    rootEl.style.top = `${clampedY}px`;
    return { x: clampedX, y: clampedY };
  };

  const initWindowPosition = () => {
    const defaultX = Math.max(VIEWPORT_PADDING, window.innerWidth - DEFAULT_WIDTH - 24);
    const defaultY = Math.max(VIEWPORT_PADDING, window.innerHeight - DEFAULT_HEIGHT - 24);

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["atlasWindowPos"], (result) => {
        const pos = result?.atlasWindowPos;
        if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
          applyPosition(pos.x, pos.y);
        } else {
          applyPosition(defaultX, defaultY);
        }
      });
    } else {
      applyPosition(defaultX, defaultY);
    }
  };

  const setupDragging = (headerEl) => {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onMouseDown = (e) => {
      // Don't drag when interacting with controls
      if (e.target.closest("button, input, [role='tab'], .atlas-tab, .atlas-traffic-btn")) {
        return;
      }
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = rootEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      rootEl.classList.add("atlas-dragging");
      document.body.style.userSelect = "none";
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      applyPosition(initialLeft + dx, initialTop + dy);
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      rootEl.classList.remove("atlas-dragging");
      document.body.style.userSelect = "";
      const rect = rootEl.getBoundingClientRect();
      const pos = { x: Math.round(rect.left), y: Math.round(rect.top) };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ atlasWindowPos: pos });
      }
    };

    const onResize = () => {
      if (!rootEl) return;
      const rect = rootEl.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    };

    headerEl.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onResize);

    return () => {
      headerEl.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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
    <div class="atlas-header" title="Drag to move Atlas window">
      <div class="atlas-traffic-lights">
        <button class="atlas-traffic-btn atlas-traffic-close" aria-label="Close Atlas window" title="Close">
          <span class="atlas-traffic-close-icon">✕</span>
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
        <!-- Fallback close button for accessibility / test compatibility -->
        <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
      </div>
    </div>

    <!-- CHAT TAB PANE -->
    <div class="atlas-pane" id="atlas-pane-chat">
      <div class="atlas-chat-log" id="atlas-chat-log"></div>
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
      <div class="atlas-status" aria-live="polite"></div>
      <div class="atlas-list" role="list"></div>
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

    const headerEl = rootEl.querySelector(".atlas-header");
    cleanUpDrag = setupDragging(headerEl);
    initWindowPosition();

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

    let actionsHtml = "";
    if (options && Array.isArray(options.actions) && options.actions.length > 0) {
      actionsHtml = `
        <div class="atlas-chat-actions">
          ${options.actions
            .map((act, idx) => {
              const label = typeof act === "string" ? act : act.label;
              const isConfirm = /yes|proceed|place|confirm|ok/i.test(label);
              const isCancel = /no|cancel|stop/i.test(label);
              const extraClass = isConfirm ? "atlas-chip-confirm" : (isCancel ? "atlas-chip-cancel" : "");
              return `<button class="atlas-chip-btn ${extraClass}" data-chip-idx="${idx}">${label}</button>`;
            })
            .join("")}
        </div>
      `;
    }

    msg.innerHTML = `
      <div class="atlas-msg-bubble">
        <div class="atlas-msg-text">${text}</div>
        ${actionsHtml}
      </div>
    `;

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
          <span class="atlas-group-emoji">${cat.emoji}</span>
          ${cat.label}
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
        ? `<div class="atlas-empty">No elements match "<strong>${query}</strong>"</div>`
        : '<div class="atlas-empty">No interactive elements found on this page.</div>';
    }
  };

  const makeItemEl = (item, query) => {
    const el = document.createElement("button");
    el.className = "atlas-item";
    el.setAttribute("role", "listitem");
    const labelHtml = query
      ? item.label.replace(
          new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
          '<mark class="atlas-highlight">$1</mark>',
        )
      : item.label;
    el.innerHTML = `<span class="atlas-item-label">${labelHtml}</span>`;
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
    currentItems = [];
    groupOpenState = {};
  };

  const setStatus = (text, kind = "info") => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `atlas-status atlas-status-${kind}`;
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

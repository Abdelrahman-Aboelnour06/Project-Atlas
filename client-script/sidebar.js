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

  const CATEGORY_CONFIG = {
    button: { label: "Buttons", emoji: "🔘" },
    input: { label: "Text fields & forms", emoji: "✏️" },
    link: { label: "Links", emoji: "🔗" },
    select: { label: "Dropdowns", emoji: "▾" },
    other: { label: "Other", emoji: "⚙️" },
  };
  const CATEGORY_ORDER = ["button", "input", "link", "select", "other"];

  const categoryFor = (node) => {
    if (node.tag === "a") return "link";
    if (node.tag === "button") return "button";
    if (node.tag === "input" || node.tag === "textarea") return "input";
    if (node.tag === "select") return "select";
    return node.role || "other";
  };

  const deriveDisplayItems = (domMap) =>
    domMap.map((node) => ({
      id: node.id,
      label:
        node.resolved_label ||
        node.aria_label ||
        node.inner_text ||
        node.placeholder ||
        node.name ||
        node.tag,
      category: categoryFor(node),
      group: node.group_label || null,
    }));

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

      <!-- Fallback close button for accessibility / test compatibility -->
      <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
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
    const msg = document.createElement("div");
    msg.className = "atlas-msg atlas-msg-agent atlas-msg-thinking";
    msg.id = "atlas-thinking-indicator";
    msg.innerHTML = `<div class="atlas-msg-bubble"><span class="atlas-dots"><span>.</span><span>.</span><span>.</span></span></div>`;
    chatLogEl.appendChild(msg);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  };

  const removeThinking = () => {
    document.getElementById("atlas-thinking-indicator")?.remove();
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

    const groups = {};
    for (const cat of CATEGORY_ORDER)
      groups[cat] = { ungrouped: [], subgroups: {} };

    for (const item of items) {
      const cat = CATEGORY_ORDER.includes(item.category)
        ? item.category
        : "other";
      if (item.group) {
        if (!groups[cat].subgroups[item.group])
          groups[cat].subgroups[item.group] = [];
        groups[cat].subgroups[item.group].push(item);
      } else {
        groups[cat].ungrouped.push(item);
      }
    }

    let totalVisible = 0;

    for (const cat of CATEGORY_ORDER) {
      const { ungrouped, subgroups } = groups[cat];
      const allInCat = [...ungrouped, ...Object.values(subgroups).flat()];
      if (allInCat.length === 0) continue;

      const filteredUngrouped = query
        ? ungrouped.filter((i) => i.label.toLowerCase().includes(query))
        : ungrouped;

      const filteredSubgroups = {};
      for (const [grpLabel, grpItems] of Object.entries(subgroups)) {
        const f = query
          ? grpItems.filter((i) => i.label.toLowerCase().includes(query))
          : grpItems;
        if (f.length) filteredSubgroups[grpLabel] = f;
      }

      const totalFiltered =
        filteredUngrouped.length +
        Object.values(filteredSubgroups).flat().length;
      if (query && totalFiltered === 0) continue;
      totalVisible += totalFiltered;

      const config = CATEGORY_CONFIG[cat] || { label: cat, emoji: "⚙️" };
      let isOpen = query ? true : (groupOpenState[cat] ?? false);

      const section = document.createElement("div");
      section.className = "atlas-group";

      const header = document.createElement("button");
      header.className = "atlas-group-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.innerHTML = `
        <span class="atlas-group-title">
          <span class="atlas-group-emoji">${config.emoji}</span>
          ${config.label}
          <span class="atlas-group-count">${totalFiltered}</span>
        </span>
        <span class="atlas-group-chevron">${isOpen ? "▲" : "▼"}</span>
      `;

      const body = document.createElement("div");
      body.className = "atlas-group-body";
      if (!isOpen) body.classList.add("atlas-group-collapsed");

      header.addEventListener("click", () => {
        const expanded = header.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        groupOpenState[cat] = next;
        header.setAttribute("aria-expanded", String(next));
        header.querySelector(".atlas-group-chevron").textContent = next
          ? "▲"
          : "▼";
        body.classList.toggle("atlas-group-collapsed", !next);
      });

      for (const [grpLabel, grpItems] of Object.entries(filteredSubgroups)) {
        const subSection = document.createElement("div");
        subSection.className = "atlas-subgroup";

        const subHeader = document.createElement("div");
        subHeader.className = "atlas-subgroup-header";
        subHeader.textContent = grpLabel;

        subSection.appendChild(subHeader);
        for (const item of grpItems) {
          subSection.appendChild(makeItemEl(item, query));
        }
        body.appendChild(subSection);
      }

      for (const item of filteredUngrouped) {
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
    addChatMessage,
    addChatThinking,
    removeThinking,
    getMode: () => currentMode,
    setMode: updateModeUI,
  };
})();

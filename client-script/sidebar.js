(function () {
  // sidebar.js — grouped panel + chat interface

  const ROOT_ID = "atlas-sidebar-root";

  let rootEl = null;
  let listEl = null;
  let statusEl = null;
  let chatInputEl = null;
  let searchEl = null;
  let micBtn = null;
  let chatLogEl = null;
  let handlers = {};
  let currentItems = [];
  let groupOpenState = {};

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

  // ── DOM construction ──────────────────────────────────────────────────────────
  const buildDom = () => {
    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;

    rootEl.innerHTML = `
    <div class="atlas-header">
      <span class="atlas-title">⚡ Atlas</span>
      <div class="atlas-tab-bar">
        <button class="atlas-tab atlas-tab-active" data-tab="chat">💬 Chat</button>
        <button class="atlas-tab" data-tab="elements">🗂 Elements</button>
      </div>
      <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
    </div>

    <!-- CHAT TAB -->
    <div class="atlas-pane" id="atlas-pane-chat">
      <div class="atlas-chat-log" id="atlas-chat-log"></div>
      <div class="atlas-chat-input-bar">
        <input class="atlas-chat-input" type="text"
          placeholder="Ask anything or give a command..." />
        <button class="atlas-mic-btn" aria-label="Speak a command">🎤</button>
      </div>
    </div>

    <!-- ELEMENTS TAB -->
    <div class="atlas-pane atlas-pane-hidden" id="atlas-pane-elements">
      <div class="atlas-search-bar">
        <input class="atlas-search" type="text" placeholder="🔍 Search for a button or field..." />
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
    chatLogEl = rootEl.querySelector("#atlas-chat-log");

    // Tab switching
    rootEl.querySelectorAll(".atlas-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        rootEl
          .querySelectorAll(".atlas-tab")
          .forEach((t) => t.classList.remove("atlas-tab-active"));
        tab.classList.add("atlas-tab-active");
        const target = tab.dataset.tab;
        rootEl
          .querySelectorAll(".atlas-pane")
          .forEach((p) => p.classList.add("atlas-pane-hidden"));
        rootEl
          .querySelector(`#atlas-pane-${target}`)
          .classList.remove("atlas-pane-hidden");
      });
    });

    rootEl
      .querySelector(".atlas-close")
      .addEventListener("click", () => handlers.onClose?.());

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
  const addChatMessage = (role, text) => {
    if (!chatLogEl) return;
    const msg = document.createElement("div");
    msg.className = `atlas-msg atlas-msg-${role}`;
    msg.innerHTML = `
    <div class="atlas-msg-bubble">${text}</div>
  `;
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
    <div class="atlas-skeleton-label">AI is reading the page...</div>
    ${Array.from({ length: 4 })
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

    // Sub-group items that share a group_label first
    // e.g. "Price range" contains "Minimum price" and "Maximum price"
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

      // Filter by search
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

      // Render subgroups first (e.g. "Price Range" containing min/max)
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

      // Then ungrouped items
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
  };
})();

(function () {
  // sidebar.js — two-tier panel + chat interface

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
  let showMoreState = {}; // tracks which categories have "show more" expanded

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
      tier: node.tier || "primary",
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

    rootEl.querySelectorAll(".atlas-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        rootEl
          .querySelectorAll(".atlas-tab")
          .forEach((t) => t.classList.remove("atlas-tab-active"));
        tab.classList.add("atlas-tab-active");
        rootEl
          .querySelectorAll(".atlas-pane")
          .forEach((p) => p.classList.add("atlas-pane-hidden"));
        rootEl
          .querySelector(`#atlas-pane-${tab.dataset.tab}`)
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

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const addChatMessage = (role, text) => {
    if (!chatLogEl) return;
    const msg = document.createElement("div");
    msg.className = `atlas-msg atlas-msg-${role}`;
    msg.innerHTML = `<div class="atlas-msg-bubble">${text}</div>`;
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

  // ── Skeleton ──────────────────────────────────────────────────────────────────
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

  // ── Item element builder ──────────────────────────────────────────────────────
  const makeItemEl = (item, query) => {
    const el = document.createElement("button");
    el.className = "atlas-item";
    if (item.tier === "secondary") el.classList.add("atlas-item-secondary");
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

  // ── Render ────────────────────────────────────────────────────────────────────
  const renderElements = (items) => {
    if (!listEl) return;
    currentItems = items;
    const query = (searchEl?.value || "").trim().toLowerCase();
    listEl.innerHTML = "";

    // Bucket items into categories, then into primary/secondary within each
    const groups = {};
    for (const cat of CATEGORY_ORDER) {
      groups[cat] = {
        primary: { ungrouped: [], subgroups: {} },
        secondary: { ungrouped: [], subgroups: {} },
      };
    }

    for (const item of items) {
      const cat = CATEGORY_ORDER.includes(item.category)
        ? item.category
        : "other";
      const tier = item.tier === "secondary" ? "secondary" : "primary";
      if (item.group) {
        if (!groups[cat][tier].subgroups[item.group])
          groups[cat][tier].subgroups[item.group] = [];
        groups[cat][tier].subgroups[item.group].push(item);
      } else {
        groups[cat][tier].ungrouped.push(item);
      }
    }

    let totalVisible = 0;

    for (const cat of CATEGORY_ORDER) {
      const { primary, secondary } = groups[cat];

      const filterItems = (list) =>
        query
          ? list.filter((i) => i.label.toLowerCase().includes(query))
          : list;

      const filtPrimaryUngrouped = filterItems(primary.ungrouped);
      const filtPrimarySubgroups = {};
      for (const [k, v] of Object.entries(primary.subgroups)) {
        const f = filterItems(v);
        if (f.length) filtPrimarySubgroups[k] = f;
      }
      const filtSecondaryUngrouped = filterItems(secondary.ungrouped);
      const filtSecondarySubgroups = {};
      for (const [k, v] of Object.entries(secondary.subgroups)) {
        const f = filterItems(v);
        if (f.length) filtSecondarySubgroups[k] = f;
      }

      const primaryCount =
        filtPrimaryUngrouped.length +
        Object.values(filtPrimarySubgroups).flat().length;
      const secondaryCount =
        filtSecondaryUngrouped.length +
        Object.values(filtSecondarySubgroups).flat().length;
      const total = primaryCount + secondaryCount;

      if (total === 0) continue;
      totalVisible += total;

      const config = CATEGORY_CONFIG[cat] || { label: cat, emoji: "⚙️" };
      const isOpen = query ? true : (groupOpenState[cat] ?? false);

      const section = document.createElement("div");
      section.className = "atlas-group";

      const header = document.createElement("button");
      header.className = "atlas-group-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.innerHTML = `
      <span class="atlas-group-title">
        <span class="atlas-group-emoji">${config.emoji}</span>
        ${config.label}
        <span class="atlas-group-count">${primaryCount}${secondaryCount > 0 ? `<span class="atlas-secondary-badge">+${secondaryCount}</span>` : ""}</span>
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

      // Render primary subgroups
      for (const [grpLabel, grpItems] of Object.entries(filtPrimarySubgroups)) {
        const sub = document.createElement("div");
        sub.className = "atlas-subgroup";
        sub.innerHTML = `<div class="atlas-subgroup-header">${grpLabel}</div>`;
        grpItems.forEach((item) => sub.appendChild(makeItemEl(item, query)));
        body.appendChild(sub);
      }

      // Render primary ungrouped
      filtPrimaryUngrouped.forEach((item) =>
        body.appendChild(makeItemEl(item, query)),
      );

      // Render secondary section if there are any
      if (secondaryCount > 0) {
        const showMore = showMoreState[cat] || false;

        const moreToggle = document.createElement("button");
        moreToggle.className = "atlas-show-more";
        moreToggle.textContent = showMore
          ? `▲ Hide ${secondaryCount} extra item${secondaryCount !== 1 ? "s" : ""}`
          : `▼ Show ${secondaryCount} more item${secondaryCount !== 1 ? "s" : ""}`;

        const moreBody = document.createElement("div");
        moreBody.className = "atlas-more-body";
        if (!showMore) moreBody.classList.add("atlas-group-collapsed");

        // Render secondary subgroups
        for (const [grpLabel, grpItems] of Object.entries(
          filtSecondarySubgroups,
        )) {
          const sub = document.createElement("div");
          sub.className = "atlas-subgroup";
          sub.innerHTML = `<div class="atlas-subgroup-header">${grpLabel}</div>`;
          grpItems.forEach((item) => sub.appendChild(makeItemEl(item, query)));
          moreBody.appendChild(sub);
        }
        filtSecondaryUngrouped.forEach((item) =>
          moreBody.appendChild(makeItemEl(item, query)),
        );

        moreToggle.addEventListener("click", () => {
          const next = !showMoreState[cat];
          showMoreState[cat] = next;
          moreBody.classList.toggle("atlas-group-collapsed", !next);
          moreToggle.textContent = next
            ? `▲ Hide ${secondaryCount} extra item${secondaryCount !== 1 ? "s" : ""}`
            : `▼ Show ${secondaryCount} more item${secondaryCount !== 1 ? "s" : ""}`;
        });

        body.appendChild(moreToggle);
        body.appendChild(moreBody);
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

  // ── Public API ────────────────────────────────────────────────────────────────
  const mount = (cbs = {}) => {
    handlers = cbs;
    groupOpenState = {};
    showMoreState = {};
    if (document.getElementById(ROOT_ID)) return;
    buildDom();
  };

  const unmount = () => {
    rootEl?.remove();
    rootEl = null;
    currentItems = [];
    groupOpenState = {};
    showMoreState = {};
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

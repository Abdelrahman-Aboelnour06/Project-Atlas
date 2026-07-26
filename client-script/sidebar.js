// sidebar.js
// Renders the Atlas sidebar with grouped categories, collapsible sections,
// live search, and a skeleton loading state while the LLM is thinking.

const ROOT_ID = "atlas-sidebar-root";

let rootEl = null;
let listEl = null;
let statusEl = null;
let inputEl = null;
let searchEl = null;
let micBtn = null;
let handlers = {};
let currentItems = [];

const CATEGORY_CONFIG = {
  button: { label: "Buttons", emoji: "🔘", startOpen: true },
  link: { label: "Links", emoji: "🔗", startOpen: false },
  input: { label: "Inputs", emoji: "✏️", startOpen: true },
  select: { label: "Dropdowns", emoji: "▾", startOpen: false },
  form: { label: "Forms", emoji: "📋", startOpen: false },
  other: { label: "Other", emoji: "⚙️", startOpen: false },
};
const CATEGORY_ORDER = ["button", "input", "link", "select", "form", "other"];

const labelFor = (node) =>
  node.aria_label ||
  node.inner_text ||
  node.placeholder ||
  node.name ||
  `${node.tag}${node.type ? ` (${node.type})` : ""}`;

const categoryFor = (node) => {
  if (node.tag === "a") return "link";
  if (node.tag === "button") return "button";
  if (node.tag === "input" || node.tag === "textarea") return "input";
  if (node.tag === "select") return "select";
  if (node.tag === "form") return "form";
  return node.role || "other";
};

const deriveDisplayItems = (domMap) =>
  domMap.map((node) => ({
    id: node.id,
    label: labelFor(node),
    category: categoryFor(node),
  }));

const buildDom = () => {
  rootEl = document.createElement("div");
  rootEl.id = ROOT_ID;

  rootEl.innerHTML = `
    <div class="atlas-header">
      <span class="atlas-title">⚡ Atlas</span>
      <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
    </div>
    <div class="atlas-command-bar">
      <input class="atlas-input" type="text" placeholder="Type a command, e.g. 'click checkout'" />
      <button class="atlas-mic-btn" aria-label="Speak a command">🎤</button>
    </div>
    <div class="atlas-search-bar">
      <input class="atlas-search" type="text" placeholder="🔍 Search elements..." />
    </div>
    <div class="atlas-status" aria-live="polite"></div>
    <div class="atlas-list" role="list"></div>
  `;

  document.body.appendChild(rootEl);

  listEl = rootEl.querySelector(".atlas-list");
  statusEl = rootEl.querySelector(".atlas-status");
  inputEl = rootEl.querySelector(".atlas-input");
  searchEl = rootEl.querySelector(".atlas-search");
  micBtn = rootEl.querySelector(".atlas-mic-btn");

  rootEl.querySelector(".atlas-close").addEventListener("click", () => {
    handlers.onClose?.();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inputEl.value.trim()) {
      handlers.onCommandSubmit?.(inputEl.value.trim());
      inputEl.value = "";
    }
  });

  micBtn.addEventListener("click", () => handlers.onMicClick?.());

  searchEl.addEventListener("input", () => {
    renderElements(currentItems);
  });
};

// ── Skeleton loader ───────────────────────────────────────────────────────────
const setLoading = (isLoading) => {
  if (!listEl) return;
  if (!isLoading) return;

  // Show skeleton cards while LLM is processing
  listEl.innerHTML = `
    <div class="atlas-skeleton-label">AI is reading the page...</div>
    ${Array.from({ length: 5 })
      .map(
        () => `
      <div class="atlas-skeleton-group">
        <div class="atlas-skeleton-header"></div>
        <div class="atlas-skeleton-body">
          <div class="atlas-skeleton-item"></div>
          <div class="atlas-skeleton-item short"></div>
          <div class="atlas-skeleton-item"></div>
        </div>
      </div>
    `,
      )
      .join("")}
  `;
};

// ── Rendering ─────────────────────────────────────────────────────────────────
const renderElements = (items) => {
  if (!listEl) return;
  currentItems = items;
  const query = (searchEl?.value || "").trim().toLowerCase();
  listEl.innerHTML = "";

  const groups = {};
  for (const cat of CATEGORY_ORDER) groups[cat] = [];
  for (const item of items) {
    const cat = CATEGORY_ORDER.includes(item.category)
      ? item.category
      : "other";
    groups[cat].push(item);
  }

  let totalVisible = 0;

  for (const cat of CATEGORY_ORDER) {
    const catItems = groups[cat];
    if (catItems.length === 0) continue;

    const filtered = query
      ? catItems.filter((i) => i.label.toLowerCase().includes(query))
      : catItems;

    if (query && filtered.length === 0) continue;

    totalVisible += filtered.length;

    const config = CATEGORY_CONFIG[cat] || {
      label: cat,
      emoji: "⚙️",
      startOpen: false,
    };
    const isOpen = query ? true : config.startOpen;

    const section = document.createElement("div");
    section.className = "atlas-group";

    const header = document.createElement("button");
    header.className = "atlas-group-header";
    header.setAttribute("aria-expanded", isOpen);
    header.innerHTML = `
      <span class="atlas-group-title">
        <span class="atlas-group-emoji">${config.emoji}</span>
        ${config.label}
        <span class="atlas-group-count">${filtered.length}</span>
      </span>
      <span class="atlas-group-chevron">${isOpen ? "▲" : "▼"}</span>
    `;

    const body = document.createElement("div");
    body.className = "atlas-group-body";
    if (!isOpen) body.classList.add("atlas-group-collapsed");

    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", !expanded);
      header.querySelector(".atlas-group-chevron").textContent = expanded
        ? "▼"
        : "▲";
      body.classList.toggle("atlas-group-collapsed", expanded);
    });

    for (const item of filtered) {
      const el = document.createElement("button");
      el.className = "atlas-item";
      el.setAttribute("role", "listitem");

      const labelHtml = query
        ? item.label.replace(
            new RegExp(
              `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
              "gi",
            ),
            '<mark class="atlas-highlight">$1</mark>',
          )
        : item.label;

      el.innerHTML = `<span class="atlas-item-label">${labelHtml}</span>`;
      el.addEventListener("click", () => handlers.onElementClick?.(item.id));
      body.appendChild(el);
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

const mount = (cbs = {}) => {
  handlers = cbs;
  if (document.getElementById(ROOT_ID)) return;
  buildDom();
};

const unmount = () => {
  rootEl?.remove();
  rootEl = null;
  currentItems = [];
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
};

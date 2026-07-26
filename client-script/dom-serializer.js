// dom-serializer.js
// Task A — owns all DOM READING.
// Scans the page for interactive/semantic elements, tags each one with a
// stable synthetic id (data-atlas-id), and produces the flat array defined
// in docs/contracts.md Contract 3.
//
// Public API (attached to window.AtlasSerializer so other content scripts
// loaded after this one can use it without a bundler):
//   AtlasSerializer.serialize() -> DomNode[]
//   AtlasSerializer.getElementByAtlasId(id) -> HTMLElement | null
//   AtlasSerializer.observe(onChange) -> fn  (call to stop)

const ATLAS_ID_ATTR = "data-atlas-id";
const DEBOUNCE_MS = 300;

const INTERACTIVE_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "tab",
  "combobox",
  "textbox",
  "slider",
];

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "form",
  ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`),
  "[onclick]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const SENSITIVE_INPUT_TYPES = new Set(["password", "email", "tel"]);

// ── Noise filter ─────────────────────────────────────────────────────────────
// Selectors that match UI chrome we never want cluttering the panel:
// language pickers, account menus, cookie banners, price/filter widgets, etc.
const NOISE_SELECTORS = [
  // Amazon-specific nav/utility chrome
  "#nav-global-location-popover-link",
  "#nav-link-accountList",
  "#icp-nav-flyout",
  "#nav-flyout-icp-anchor",
  '[data-csa-c-type="widget"][data-csa-c-slot-id*="language"]',
  "#languageDropdown",
  ".icp-nav-link",
  // Price / filter / facet widgets
  '[id*="price-filter"]',
  '[id*="priceRefinements"]',
  '[class*="price-filter"]',
  '[class*="priceFilter"]',
  '[id*="facet"]',
  '[class*="facet"]',
  '[id*="refinement"]',
  '[class*="refinement"]',
  // Cookie / GDPR banners
  "#sp-cc",
  "#cookie-banner",
  '[id*="cookie"]',
  '[class*="cookie-banner"]',
  // Generic footer / utility patterns
  "footer a",
  '[aria-label*="language" i]',
  '[aria-label*="country" i]',
  '[aria-label*="currency" i]',
  '[aria-label*="region" i]',
];

const NOISE_TEXT_PATTERNS = [
  /^change (language|country|region|currency)/i,
  /^select (language|country|region|currency)/i,
  /^\$\d+(\.\d+)?\s*[-–]\s*\$\d+/, // price ranges like "$10 - $50"
  /^filter by/i,
  /^sort by/i,
  /^all departments/i,
  /^sign in$/i,
  /^returns & orders/i,
];

const isNoise = (el) => {
  // Check structural noise selectors
  for (const sel of NOISE_SELECTORS) {
    try {
      if (el.matches(sel) || el.closest(sel)) return true;
    } catch (_) {}
  }
  // Check text content patterns
  const text = (el.innerText || el.textContent || "").trim();
  for (const pattern of NOISE_TEXT_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
};

let idCounter = 0;
const nextAtlasId = () => `atlas-${idCounter++}`;

const isVisible = (el) => {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const truncate = (str, max = 200) => {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
};

const safeInnerText = (el) => {
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(type) || type === "password") return null;
  }
  return truncate(el.innerText || el.textContent);
};

const serializeNode = (el) => {
  let atlasId = el.getAttribute(ATLAS_ID_ATTR);
  if (!atlasId) {
    atlasId = nextAtlasId();
    el.setAttribute(ATLAS_ID_ATTR, atlasId);
  }
  return {
    id: atlasId,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || null,
    inner_text: safeInnerText(el),
    placeholder: el.getAttribute("placeholder") || null,
    aria_label: el.getAttribute("aria-label") || null,
    href: el.getAttribute("href") || null,
    name: el.getAttribute("name") || null,
    role: el.getAttribute("role") || null,
  };
};

const isEnabled = (el) => !el.disabled;

const serialize = () => {
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((el) => !el.closest("#atlas-sidebar-root"))
    .filter(isVisible)
    .filter(isEnabled)
    .filter((el) => !isNoise(el))
    .map(serializeNode);
  return nodes;
};

const getElementByAtlasId = (atlasId) =>
  document.querySelector(`[${ATLAS_ID_ATTR}="${CSS.escape(atlasId)}"]`);

const observe = (onChange) => {
  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(serialize()), DEBOUNCE_MS);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "disabled"],
  });
  return () => observer.disconnect();
};

window.AtlasSerializer = { serialize, getElementByAtlasId, observe };

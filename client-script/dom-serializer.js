(function () {
  // dom-serializer.js

  const ATLAS_ID_ATTR = "data-atlas-id";
  const DEBOUNCE_MS = 800;

  // ── Selectors ─────────────────────────────────────────────────────────────────
  const INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="switch"]',
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

// ── Hidden element detection (defends against prompt injection) ─────────────
function isTrulyHidden(el) {
  if (el.hidden) return true;
  if (el.closest('[aria-hidden="true"]')) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  if (parseFloat(style.opacity) < 0.1) return true;
  if (parseFloat(style.fontSize) === 0) return true;
  if (el.offsetParent === null && el.tagName !== 'BODY') return true;
  return false;
}


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
  // ── Hard noise: always skip these regardless of content ───────────────────────
  const NOISE_SELECTORS = [
    "#atlas-sidebar-root", // never scan ourselves
    // cookie / GDPR banners
    '[id*="cookie"]',
    '[class*="cookie"]',
    '[id*="gdpr"]',
    '[class*="gdpr"]',
    // language / region pickers
    '[aria-label*="language" i]',
    '[aria-label*="country" i]',
    '[aria-label*="currency" i]',
    '[aria-label*="region" i]',
    // breadcrumbs, pagination, footer links
    '[aria-label*="breadcrumb" i]',
    "footer a",
    "footer button",
    // skip elements inside known chrome/nav containers
    "nav a", // pure nav links handled separately
    '[role="navigation"] a',
    '[role="navigation"] button',
    '[role="banner"] a', // header links (logo, home)
    // Google / internal widget chrome
    "[data-ogsr-up]",
    '[jsaction*="dismiss"]',
  ];

  // ── Text patterns that are always noise ───────────────────────────────────────
  const NOISE_TEXT_PATTERNS = [
    /^change (language|country|region|currency)/i,
    /^\$[\d,]+(\.\d+)?\s*[-–]\s*\$[\d,]+/, // price ranges
    /^filter by/i,
    /^sort by/i,
    /^sign in$/i,
    /^log in$/i,
    /^returns & orders/i,
    /^back to top/i,
    /^skip to (main|content|nav)/i,
  ];

  // ── Universal quality filters ─────────────────────────────────────────────────
  // These run on EVERY site, not just Amazon.

  // 1. No meaningful label at all — not useful to show
  const hasMeaningfulLabel = (el) => {
    const candidates = [
      el.getAttribute("aria-label"),
      el.getAttribute("aria-labelledby") ? "has-ref" : null,
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
      el.innerText || el.textContent,
      el.getAttribute("name"),
      el.getAttribute("value"),
    ];
    const text = candidates
      .filter(Boolean)
      .map((s) => s.trim())
      .find((s) => s.length > 0);

    if (!text) return false;

    // Label must be more than 1 character and not purely punctuation/numbers
    if (text.length < 2) return false;
    if (/^[\d\s\W]+$/.test(text)) return false;

    return true;
  };

  // 2. Looks like an internal/machine-generated label (React keys, hash IDs etc.)
  const MACHINE_LABEL_PATTERN =
    /^[a-z]{4,12}\d{3,}$|^[A-Z][a-z]{2,5}[A-Z][a-z]{2,5}[A-Z]|^\w{8,}-\w{4}-\w{4}/;

  const isMachineLabel = (el) => {
    const ariaLabel = el.getAttribute("aria-label") || "";
    const id = el.id || "";
    // If aria-label looks machine-generated AND there's no inner text, skip
    if (MACHINE_LABEL_PATTERN.test(ariaLabel) && !(el.innerText || "").trim())
      return true;
    return false;
  };

  // 3. Tiny icon buttons with no visible text (likely decorative chrome)
  const isBareIconButton = (el) => {
    const text = (el.innerText || el.textContent || "").trim();
    if (text.length > 0) return false; // has text, keep it
    const rect = el.getBoundingClientRect();
    // Small square with no text = almost certainly an icon button
    if (rect.width < 36 && rect.height < 36) return true;
    return false;
  };

  // 4. Duplicate labels — keep only the first occurrence per page
  const seenLabels = new Set();
  const isDuplicate = (label) => {
    const key = label.toLowerCase().trim();
    if (seenLabels.has(key)) return true;
    seenLabels.add(key);
    return false;
  };

  // ── Noise check (structural) ──────────────────────────────────────────────────
  const isStructuralNoise = (el) => {
    if (el.closest("#atlas-sidebar-root")) return true;
    for (const sel of NOISE_SELECTORS) {
      try {
        if (el.matches(sel) || el.closest(sel)) return true;
      } catch (_) {}
    }
    return false;
  };

  const isTextNoise = (text) => {
    for (const p of NOISE_TEXT_PATTERNS) {
      if (p.test(text)) return true;
    }
    return false;
  };

  // ── Visibility ────────────────────────────────────────────────────────────────
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.1) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // ── Smart label resolution ────────────────────────────────────────────────────
  // Priority: <label for> > aria-labelledby > title attr > aria-label >
  //           inner text (buttons/links) > wrapping label > name attr >
  //           placeholder (last resort)
  const truncate = (str, max = 80) => {
    if (!str) return null;
    const t = str.trim().replace(/\s+/g, " ");
    if (!t) return null;
    return t.length > max ? t.slice(0, max) + "..." : t;
  };

  const resolveLabel = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();

    // 1. Explicit <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) {
        const t = truncate(lbl.innerText || lbl.textContent);
        if (t) return t;
      }
    }

    // 2. aria-labelledby — resolve referenced elements
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (parts.length) {
        const t = truncate(parts.join(" "));
        if (t) return t;
      }
    }

    // 3. title attribute (often descriptive on icon buttons)
    const title = el.getAttribute("title");
    if (title?.trim() && !MACHINE_LABEL_PATTERN.test(title)) {
      return truncate(title);
    }

    // 4. aria-label — but only if it doesn't look machine-generated
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim() && !MACHINE_LABEL_PATTERN.test(ariaLabel)) {
      return truncate(ariaLabel);
    }

    // 5. Inner text for buttons and links
    if (tag === "button" || tag === "a") {
      // Strip out icon-only content (single chars, emoji, etc.)
      const text = (el.innerText || el.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
      if (text.length > 1 && !/^[\W\d]$/.test(text)) return truncate(text);
    }

    // 6. Wrapping <label>
    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone
        .querySelectorAll("input,textarea,select")
        .forEach((i) => i.remove());
      const t = truncate(clone.innerText || clone.textContent);
      if (t) return t;
    }

    // 7. name attribute (human-readable ones only)
    const name = el.getAttribute("name");
    if (name && !/^[a-z_-]{0,3}$/.test(name)) {
      return truncate(name.replace(/[-_]/g, " "));
    }

    // 8. Placeholder — last resort for inputs
    const placeholder = el.getAttribute("placeholder");
    if (placeholder?.trim()) return truncate(placeholder);

    return null; // signal: no usable label
  };

  // ── Group detection ───────────────────────────────────────────────────────────
  const GROUP_SELECTORS = [
    "fieldset",
    '[role="group"]',
    ".form-group",
    ".input-group",
    ".filter-card",
    ".price-range",
  ];

  const detectGroupLabel = (el) => {
    for (const sel of GROUP_SELECTORS) {
      const container = el.closest(sel);
      if (!container) continue;
      const heading = container.querySelector(
        'legend, h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"]',
      );
      if (heading) {
        const t = truncate(heading.innerText || heading.textContent, 40);
        if (t) return t;
      }
    }
    return null;
  };

  // ── Atlas ID management ───────────────────────────────────────────────────────
  let idCounter = 0;
  const nextAtlasId = () => `atlas-${Date.now()}-${idCounter++}`;

  const serializeNode = (el, label) => {
    let atlasId = el.getAttribute(ATLAS_ID_ATTR);
    if (!atlasId) {
      atlasId = nextAtlasId();
      el.setAttribute(ATLAS_ID_ATTR, atlasId);
    }
    return {
      id: atlasId,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      inner_text:
        el.tagName === "INPUT" && el.type === "password"
          ? null
          : truncate(el.innerText || el.textContent),
      placeholder: el.getAttribute("placeholder") || null,
      aria_label: el.getAttribute("aria-label") || null,
      href: el.getAttribute("href") || null,
      name: el.getAttribute("name") || null,
      role: el.getAttribute("role") || null,
      resolved_label: label,
      group_label: detectGroupLabel(el),
    };
  };

const isEnabled = (el) => !el.disabled;

const serialize = () => {
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((el) => !el.closest("#atlas-sidebar-root"))
    .filter(isVisible)
    .filter((el) => !isTrulyHidden(el))
    .filter(isEnabled)
    .filter((el) => !isNoise(el))
    .map(serializeNode);
  return nodes;
};
  // ── Main serialize ────────────────────────────────────────────────────────────
  const serialize = () => {
    seenLabels.clear(); // reset duplicate tracker on each scan

    return Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter(isVisible)
      .filter((el) => !el.disabled)
      .filter((el) => !isStructuralNoise(el))
      .filter((el) => !isMachineLabel(el))
      .filter((el) => !isBareIconButton(el))
      .filter((el) => hasMeaningfulLabel(el))
      .map((el) => ({ el, label: resolveLabel(el) }))
      .filter(({ label }) => label !== null) // must have a resolved label
      .filter(({ label }) => !isTextNoise(label)) // label must not be noise text
      .filter(({ label }) => !isDuplicate(label)) // no duplicate labels
      .map(({ el, label }) => serializeNode(el, label));
  };

  const getElementByAtlasId = (atlasId) =>
    document.querySelector(`[${ATLAS_ID_ATTR}="${CSS.escape(atlasId)}"]`);

  // Pause/resume for content.js to suppress re-renders during interactions
  let paused = false;
  const pause = () => {
    paused = true;
  };
  const resume = () => {
    paused = false;
  };

  const observe = (onChange) => {
    let timer = null;
    const observer = new MutationObserver((mutations) => {
      if (paused) return;
      const onlyAtlas = mutations.every(
        (m) =>
          m.target.id === "atlas-sidebar-root" ||
          m.target.closest?.("#atlas-sidebar-root") ||
          (m.type === "attributes" && m.attributeName === ATLAS_ID_ATTR),
      );
      if (onlyAtlas) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onChange(serialize()), DEBOUNCE_MS);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "disabled", "aria-hidden"],
    });
    return () => observer.disconnect();
  };

  window.AtlasSerializer = {
    serialize,
    getElementByAtlasId,
    observe,
    pause,
    resume,
  };
})();

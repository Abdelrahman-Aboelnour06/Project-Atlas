(function () {
  // dom-serializer.js

  const ATLAS_ID_ATTR = "data-atlas-id";
  const ATLAS_REVEAL_VIA_ATTR = "data-atlas-reveal-via";
  const DEBOUNCE_MS = 800;

  // ── Selectors ─────────────────────────────────────────────────────────────────
  const INTERACTIVE_SELECTOR = [
    "button",
    "summary",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="searchbox"]',
    '[role="treeitem"]',
    '[role="option"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable]',
    // Google Drive, web app rows, cards & clickable elements
    '[role="row"][data-id]',
    '[role="row"][data-target]',
    '[role="row"][tabindex]',
    '[data-id][tabindex="0"]',
    '[data-target][tabindex="0"]',
    '[jsaction*="click"][tabindex="0"]',
    '[data-tooltip][tabindex="0"]',
  ].join(",");

const SENSITIVE_INPUT_TYPES = new Set(["password", "email", "tel"]);
const SENSITIVE_KEYWORD_REGEX =
  /card|cvv|cvc|ssn|dob|birth|otp|pin|pass|secret|token|security/i;
const SENSITIVE_AUTOCOMPLETE_REGEX =
  /cc-|current-password|new-password|one-time-code|bday/i;

const IDENTITY_KEYWORDS = [
  "national id",
  "national_id",
  "national-id",
  "civil id",
  "civil_id",
  "civil-id",
  "passport",
  "الرقم القومي",
  "رقم الهوية",
  "جواز السفر",
  "بطاقة الرقم القومي",
];

const ID_LIKE_LABEL_KEYWORDS = [
  "id",
  "identity",
  "identification",
  "رقم",
  "هوية",
  "قومي",
];

const isIdentityField = (el, resolvedLabel = "") => {
  if (!el) return false;
  const name = (el.getAttribute?.("name") || el.name || "").toLowerCase();
  const id = (el.id || el.getAttribute?.("id") || "").toLowerCase();
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const placeholder = (el.getAttribute?.("placeholder") || el.placeholder || "").toLowerCase();
  const autocomplete = (el.getAttribute?.("autocomplete") || el.autocomplete || "").toLowerCase();
  const title = (el.getAttribute?.("title") || "").toLowerCase();
  const label = (resolvedLabel || "").toLowerCase();
  const combined = `${autocomplete} ${name} ${id} ${aria} ${placeholder} ${title} ${label}`.toLowerCase();

  if (IDENTITY_KEYWORDS.some((kw) => combined.includes(kw))) {
    return true;
  }

  const pattern = el.getAttribute?.("pattern") || "";
  const maxlengthAttr = el.getAttribute?.("maxlength");
  const maxlength = (el.maxLength > 0 && el.maxLength < 100000) ? el.maxLength : (maxlengthAttr ? parseInt(maxlengthAttr, 10) : null);
  const type = (el.getAttribute?.("type") || el.type || "").toLowerCase();
  const inputmode = (el.getAttribute?.("inputmode") || "").toLowerCase();

  let patternLength = null;
  if (pattern) {
    const m = pattern.match(/\{(\d+)(?:,\s*(\d*))?\}/);
    if (m) patternLength = parseInt(m[1], 10);
  }

  const isNumeric = type === "number" || type === "tel" || pattern.includes("0-9") || pattern.includes("\\d") || inputmode === "numeric";
  const effectiveLength = (maxlength && !isNaN(maxlength)) ? maxlength : patternLength;
  const hasIdLabel = ID_LIKE_LABEL_KEYWORDS.some((kw) => combined.includes(kw));

  if (isNumeric && effectiveLength && effectiveLength >= 9 && hasIdLabel) {
    return true;
  }

  return false;
};

const isSensitiveField = (el, label = "") => {
  if (!el) return false;
  if (el.hasAttribute?.("data-atlas-token")) return true;
  const type = (el.getAttribute?.("type") || el.type || "").toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const autocomplete = (el.getAttribute?.("autocomplete") || el.autocomplete || "").toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE_REGEX.test(autocomplete)) return true;
  const name = el.getAttribute?.("name") || el.name || "";
  const id = el.id || el.getAttribute?.("id") || "";
  const aria = el.getAttribute?.("aria-label") || "";
  const placeholder = el.getAttribute?.("placeholder") || el.placeholder || "";
  if (SENSITIVE_KEYWORD_REGEX.test(`${name} ${id} ${aria} ${placeholder}`)) return true;

  // D6: 10+ digits run (normalizing Arabic-Indic digits) without token is sensitive
  const val = el.value != null && el.value !== "" ? String(el.value) : (el.getAttribute?.("value") || "");
  if (val && !el.hasAttribute?.("data-atlas-token")) {
    const normalizedDigits = val
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
    if (/\d{10,}/.test(normalizedDigits)) return true;
  }

  return isIdentityField(el, label);
};

const classifySensitiveField = (el) => {
  if (!el) return null;
  if (el.hasAttribute?.("data-atlas-token")) return "secret";
  const type = (el.getAttribute?.("type") || el.type || "").toLowerCase();
  const autocomplete = (el.getAttribute?.("autocomplete") || el.autocomplete || "").toLowerCase();
  const name = (el.getAttribute?.("name") || el.name || "").toLowerCase();
  const id = (el.id || el.getAttribute?.("id") || "").toLowerCase();
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const placeholder = (el.getAttribute?.("placeholder") || el.placeholder || "").toLowerCase();
  const combined = `${autocomplete} ${name} ${id} ${aria} ${placeholder}`;

  if (isIdentityField(el)) return "secret";

  // If none of the sensitive signals trigger, return null
  // Note: type="email" and type="tel" are PII for isSensitiveField DOM masking,
  // but are not secret tokens under Contract 11.
  const isSens = type === "password" ||
    SENSITIVE_AUTOCOMPLETE_REGEX.test(autocomplete) ||
    SENSITIVE_KEYWORD_REGEX.test(combined);
  if (!isSens) return null;

  // Refined classification per Contract 11 categories:
  // password | cc_number | cc_cvv | cc_expiry | cc_name | ssn | otp | pin | secret
  if (type === "password" || autocomplete === "current-password" || autocomplete === "new-password" || /\b(password|passwd)\b/i.test(combined)) {
    return "password";
  }
  if (autocomplete.includes("cc-number") || /\b(cc[-_ ]?number|card[-_ ]?number|credit[-_ ]?card)\b/i.test(combined)) {
    return "cc_number";
  }
  if (autocomplete.includes("cc-csc") || /\b(cc[-_ ]?(?:csc|cvv|cvc)|cvv|cvc|csc|security[-_ ]?code)\b/i.test(combined)) {
    return "cc_cvv";
  }
  if (autocomplete.includes("cc-exp") || /\b(cc[-_ ]?exp|expiry|expiration)\b/i.test(combined)) {
    return "cc_expiry";
  }
  if (autocomplete.includes("cc-name") || /\b(cc[-_ ]?name|cardholder|name[-_ ]?on[-_ ]?card)\b/i.test(combined)) {
    return "cc_name";
  }
  if (autocomplete.includes("one-time-code") || /\b(one[-_ ]?time[-_ ]?code|otp|2fa|mfa|verification[-_ ]?code)\b/i.test(combined)) {
    return "otp";
  }
  if (/(?:^|[-_ \b])ssn(?:[-_ \b]|$)|social[-_ ]?security/i.test(combined)) {
    return "ssn";
  }
  if (/(?:^|[-_ \b])pin(?:[-_ \b]|$)/i.test(combined)) {
    return "pin";
  }
  return "secret";
};

// ── Noise filter ─────────────────────────────────────────────────────────────
// Selectors that match UI chrome we never want cluttering the panel:
// language pickers, cookie banners, price/filter widgets, etc.
const NOISE_SELECTORS = [
  "#atlas-sidebar-host",
  "#atlas-sidebar-root",
  "atlas-sidebar-host",
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
  "#cookie-banner",
  '[id*="cookie"]',
  '[class*="cookie"]',
  '[class*="cookie-banner"]',
  '[id*="gdpr"]',
  '[class*="gdpr"]',
  // Generic footer / utility patterns
  "footer a",
  "footer button",
  '[aria-label*="language" i]',
  '[aria-label*="country" i]',
  '[aria-label*="currency" i]',
  '[aria-label*="region" i]',
  '[aria-label*="breadcrumb" i]',
];

const NOISE_TEXT_PATTERNS = [
  /^change (language|country|region|currency)/i,
  /^select (language|country|region|currency)/i,
  /^\$[\d,]+(\.\d+)?\s*[-–]\s*\$[\d,]+/, // price ranges like "$10 - $50"
  /^filter by/i,
  /^sort by/i,
  /^back to top/i,
  /^skip to (main|content|nav)/i,
];



  // ── Universal quality filters ─────────────────────────────────────────────────
  // These run on EVERY site.

  // 1. No meaningful label at all — not useful to show
  const hasMeaningfulLabel = (el) => {
    const candidates = [
      el.getAttribute("data-tooltip"),
      el.getAttribute("data-title"),
      el.getAttribute("data-name"),
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

    if (!text) {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || el.isContentEditable) {
        return true;
      }
      return false;
    }

    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || el.isContentEditable) {
      return true;
    }

    // Label must be substantive: allow 1-character controls if they are letters, digits, or symbols (e.g. "X", "+", "-", "1", "×")
    if (text.length === 1 && !/[\p{L}\p{N}+×✕\-><?!]/u.test(text)) return false;
    if (text.length === 0) return false;
    // Discard if text contains NO letters, digits, or interactive action symbols.
    // Uses Unicode property escape \p{L} with /u flag to support Arabic, CJK, Cyrillic, Hebrew, Latin.
    if (!/\p{L}/u.test(text) && !/[\p{N}+×✕\-><?!]/u.test(text)) return false;

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

  // 3. Tiny icon buttons with no visible text AND no descriptive tooltip/label
  const isBareIconButton = (el) => {
    const text = (el.innerText || el.textContent || "").trim();
    if (text.length > 0) return false; // has text, keep it

    // Accessible icon buttons with tooltips, titles, or aria-labels are NOT bare!
    const aria = (el.getAttribute("aria-label") || "").trim();
    const title = (el.getAttribute("title") || "").trim();
    const tooltip = (el.getAttribute("data-tooltip") || el.getAttribute("data-title") || "").trim();
    if (aria && !MACHINE_LABEL_PATTERN.test(aria) && aria.length > 1) return false;
    if (title && !MACHINE_LABEL_PATTERN.test(title) && title.length > 1) return false;
    if (tooltip && !MACHINE_LABEL_PATTERN.test(tooltip) && tooltip.length > 1) return false;

    const rect = el.getBoundingClientRect();
    // Small square with no text and no accessible label = decorative/bare chrome
    if (rect.width < 36 && rect.height < 36) return true;
    return false;
  };

  // ── Stable element identity & FNV-1a (§9.2) ──────────────────────────────
  const fnv1a64 = (str) => {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
      hash ^= BigInt(str.charCodeAt(i));
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash;
  };

  const normaliseLabel = (label) =>
    (label || "").toLowerCase().trim().replace(/\s+/g, " ");

  const computeRef = (el, label, formId, ordinal) => {
    const basis = [
      el.tagName.toLowerCase(),
      el.getAttribute("role") || "",
      el.getAttribute("type") || "",
      normaliseLabel(label),
      formId || "",
      String(ordinal),
    ].join("|");
    return "el_" + fnv1a64(basis).toString(16).padStart(12, "0");
  };

  // 4. Duplicate labels — keep only first occurrence outside forms; inside forms, preserve all
  const seenLabels = new Set();
  const isDuplicate = (label, formId) => {
    if (formId) return false; // Suspend label dedup inside forms (§11.2)
    const key = label.toLowerCase().trim();
    if (seenLabels.has(key)) return true;
    seenLabels.add(key);
    return false;
  };

  // ── Noise check (structural) ──────────────────────────────────────────────────
  const isStructuralNoise = (el) => {
    if (
      el.id === "atlas-sidebar-host" ||
      el.id === "atlas-sidebar-root" ||
      el.closest("#atlas-sidebar-host") ||
      el.closest("#atlas-sidebar-root")
    ) {
      return true;
    }
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
    if (el.hidden) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.closest('dialog:not([open])')) return false;
    if (el.closest('details:not([open])') && (el.tagName || "").toLowerCase() !== "summary") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.1) return false;
    if (parseFloat(style.fontSize) === 0) return false;
    if (el.offsetParent === null && el.tagName !== "BODY") {
      // W3C CSSOM: position: fixed/sticky, open dialogs, popovers, SVGs, and Shadow DOM return offsetParent === null
      let isAllowedNullOffset = style.position === "fixed" || style.position === "sticky";
      if (!isAllowedNullOffset && (
        el.closest("dialog[open]") ||
        el.closest("[popover]") ||
        el.closest("svg") ||
        (el.getRootNode && el.getRootNode() && el.getRootNode().nodeType === 11)
      )) {
        isAllowedNullOffset = true;
      }
      if (!isAllowedNullOffset && el.parentElement) {
        let curr = el.parentElement;
        while (curr && curr !== document.body) {
          const s = window.getComputedStyle(curr);
          if (s.position === "fixed" || s.position === "sticky") {
            isAllowedNullOffset = true;
            break;
          }
          curr = curr.parentElement;
        }
      }
      if (!isAllowedNullOffset) return false;
    }
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

    // 3. data-tooltip or data-title (Google Drive & modern web apps use this extensively)
    const tooltip = el.getAttribute("data-tooltip") || el.getAttribute("data-title") || el.getAttribute("aria-description");
    if (tooltip?.trim() && !MACHINE_LABEL_PATTERN.test(tooltip)) {
      return truncate(tooltip);
    }

    // 4. title attribute (often descriptive on icon buttons)
    const title = el.getAttribute("title");
    if (title?.trim() && !MACHINE_LABEL_PATTERN.test(title)) {
      return truncate(title);
    }

    // 5. aria-label — but only if it doesn't look machine-generated
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim() && !MACHINE_LABEL_PATTERN.test(ariaLabel)) {
      return truncate(ariaLabel);
    }

    // 6. data-name attribute
    const dataName = el.getAttribute("data-name");
    if (dataName?.trim() && !MACHINE_LABEL_PATTERN.test(dataName)) {
      return truncate(dataName);
    }

    // 7. Child title or filename (for rows, treeitems, cards in Drive/web apps)
    const elRole = el.getAttribute("role");
    if (elRole === "row" || elRole === "treeitem" || elRole === "gridcell") {
      const childItem = el.querySelector('[data-tooltip], [data-name], [class*="name"], [class*="title"], [role="gridcell"]');
      if (childItem) {
        const cText = childItem.getAttribute("data-tooltip") || childItem.getAttribute("data-name") || (childItem.innerText || "").trim();
        if (cText && cText.length > 1 && !MACHINE_LABEL_PATTERN.test(cText)) {
          return truncate(cText);
        }
      }
    }

    // 8. Inner text for buttons, links, rows, and interactive elements
    const text = (el.innerText || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ");
    if (text.length > 1 && !/^[^\p{L}\p{N}]$/u.test(text)) return truncate(text);
    if (text.length === 1 && /[\p{L}\p{N}+×✕\-><?!]/u.test(text)) return truncate(text);

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

  // ── Form-aware helpers (§11.2) ──────────────────────────────────────────
  const detectFormId = (el) => {
    const form = el.closest("form");
    if (!form) return null;
    return form.id || form.getAttribute("name") || form.getAttribute(ATLAS_ID_ATTR) || "form_0";
  };

  const collectOptions = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    let opts = [];

    if (tag === "select") {
      const optionEls = Array.from(el.querySelectorAll("option"));
      opts = optionEls.slice(0, 200).map((opt) => ({
        value: opt.value || opt.text || "",
        label: (opt.text || opt.label || opt.value || "").trim(),
        selected: Boolean(opt.selected),
      }));
    } else if (role === "combobox" || role === "listbox") {
      let optionEls = [];
      const controlsId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      if (controlsId) {
        const target = document.getElementById(controlsId);
        if (target) optionEls = Array.from(target.querySelectorAll('[role="option"]'));
      }
      if (!optionEls.length) {
        optionEls = Array.from(el.querySelectorAll('[role="option"]'));
      }
      if (!optionEls.length && el.nextElementSibling) {
        optionEls = Array.from(el.nextElementSibling.querySelectorAll('[role="option"]'));
      }
      if (!optionEls.length && el.parentElement) {
        optionEls = Array.from(el.parentElement.querySelectorAll('[role="option"]'));
      }
      opts = optionEls.slice(0, 200).map((opt) => ({
        value: opt.getAttribute("data-value") || opt.getAttribute("value") || (opt.innerText || opt.textContent || "").trim(),
        label: (opt.innerText || opt.textContent || opt.getAttribute("data-value") || "").trim(),
        selected: opt.getAttribute("aria-selected") === "true",
      }));
    } else if (el.type === "radio" && el.name) {
      const form = el.closest("form") || document;
      const radios = Array.from(form.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
      opts = radios.slice(0, 200).map((r) => {
        const lbl = resolveLabel(r) || r.value;
        return {
          value: r.value,
          label: lbl,
          selected: Boolean(r.checked),
        };
      });
    }

    return opts.length > 0 ? opts : null;
  };

  const resolveErrorText = (el) => {
    // 1. aria-errormessage
    const errMsgId = el.getAttribute("aria-errormessage");
    if (errMsgId) {
      const errEl = document.getElementById(errMsgId);
      if (errEl && isVisible(errEl)) {
        const t = truncate(errEl.innerText || errEl.textContent);
        if (t) return t;
      }
    }
    // 2. aria-describedby
    const descId = el.getAttribute("aria-describedby");
    if (descId) {
      const parts = descId.split(/\s+/).map((id) => {
        const dEl = document.getElementById(id);
        return dEl && isVisible(dEl) ? (dEl.innerText || dEl.textContent || "").trim() : null;
      }).filter(Boolean);
      if (parts.length) {
        const t = truncate(parts.join(" "));
        if (t && /error|invalid|required|fail|must/i.test(t)) return t;
      }
    }
    // 3. nearest following sibling with [role=alert] or an error class
    let sib = el.nextElementSibling;
    while (sib) {
      if (isVisible(sib) && (sib.getAttribute("role") === "alert" || /error|invalid|alert/i.test(sib.className || ""))) {
        const t = truncate(sib.innerText || sib.textContent);
        if (t) return t;
      }
      sib = sib.nextElementSibling;
    }
    const parentGroup = el.closest(".form-group, .input-group, fieldset, [role='group']");
    if (parentGroup) {
      const alertEl = parentGroup.querySelector('[role="alert"], [class*="error"], [class*="invalid"]');
      if (alertEl && isVisible(alertEl) && alertEl !== el) {
        const t = truncate(alertEl.innerText || alertEl.textContent);
        if (t) return t;
      }
    }
    // 4. validationMessage from Constraint Validation API
    if (el.validationMessage && typeof el.checkValidity === "function" && !el.checkValidity()) {
      return truncate(el.validationMessage);
    }
    return null;
  };

  const detectSectionLabel = (el) => {
    const fs = el.closest("fieldset");
    if (fs) {
      const leg = fs.querySelector("legend");
      if (leg) {
        const t = truncate(leg.innerText || leg.textContent, 50);
        if (t) return t;
      }
    }
    let curr = el;
    while (curr && curr !== document.body) {
      let prev = curr.previousElementSibling;
      while (prev) {
        if (/^h[1-6]$/i.test(prev.tagName) || (prev.querySelector && prev.querySelector("h1,h2,h3,h4,h5,h6"))) {
          const heading = /^h[1-6]$/i.test(prev.tagName) ? prev : prev.querySelector("h1,h2,h3,h4,h5,h6");
          const t = truncate(heading.innerText || heading.textContent, 50);
          if (t) return t;
        }
        prev = prev.previousElementSibling;
      }
      curr = curr.parentElement;
    }
    return null;
  };

  // ── Universal Shadow DOM & Modal Helpers ─────────────────────────────────────
  const collectInteractiveElements = (root = document) => {
    const results = [];
    try {
      const elements = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
      results.push(...elements);
    } catch (_) {}

    // Recursively collect from open shadow roots across Web Components
    try {
      const all = root.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === "atlas-sidebar-host" || el.id === "atlas-sidebar-root") continue;
        if (el.shadowRoot) {
          results.push(...collectInteractiveElements(el.shadowRoot));
        }
      }
    } catch (_) {}
    return results;
  };

  const getActiveModalDialog = () => {
    try {
      const dialogs = Array.from(
        document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')
      );
      for (let i = 0; i < dialogs.length; i++) {
        const d = dialogs[i];
        if (isVisible(d)) return d;
      }
    } catch (_) {}
    return null;
  };

  // ── Landmark detection ───────────────────────────────────────────────────────
  const detectLandmark = (el) => {
    if (!el || !el.closest) return null;
    try {
      const match = el.closest(
        'header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]'
      );
      if (!match) return null;
      const tag = (match.tagName || "").toLowerCase();
      const role = (match.getAttribute?.("role") || "").toLowerCase();
      if (tag === "header" || role === "banner") return "header";
      if (tag === "nav" || role === "navigation") return "nav";
      if (tag === "main" || role === "main") return "main";
      if (tag === "footer" || role === "contentinfo") return "footer";
      if (tag === "aside" || role === "complementary") return "aside";
    } catch (_) {}
    return null;
  };

  // ── Menu toggle detection ────────────────────────────────────────────────────
  const detectMenu = (el) => {
    if (!el) return null;
    const tag = (el.tagName || "").toLowerCase();
    const hasPopupAttr = el.getAttribute?.("aria-haspopup");
    const hasExpandedAttr = el.hasAttribute?.("aria-expanded");
    let expandedVal = hasExpandedAttr ? el.getAttribute("aria-expanded") === "true" : null;
    let controlsId = el.getAttribute?.("aria-controls") || null;
    let hasPopupVal = hasPopupAttr || null;

    // 1. Native disclosure widget: <summary> inside <details>
    if (tag === "summary" && el.parentElement && (el.parentElement.tagName || "").toLowerCase() === "details") {
      const details = el.parentElement;
      const isOpen = Boolean(details.open || details.hasAttribute("open"));
      return {
        haspopup: hasPopupAttr || "true",
        expanded: isOpen,
        controls: controlsId || details.id || null,
      };
    }

    // Check sibling or controlled element to infer missing controls/expanded
    if (!controlsId || expandedVal === null) {
      if (controlsId) {
        try {
          const target = document.getElementById(controlsId);
          if (target && expandedVal === null) {
            expandedVal = isVisible(target);
          }
        } catch (_) {}
      } else if (tag === "button" || tag === "a" || el.getAttribute?.("role") === "button") {
        let sib = el.nextElementSibling;
        while (sib && sib.nodeType === 1) {
          const sTag = (sib.tagName || "").toLowerCase();
          const sRole = (sib.getAttribute?.("role") || "").toLowerCase();
          if (sTag === "ul" || sTag === "ol" || sTag === "nav" || sRole === "menu" || sRole === "menubar") {
            if (!controlsId) controlsId = sib.id || null;
            if (expandedVal === null) expandedVal = isVisible(sib);
            if (!hasPopupVal) hasPopupVal = "true";
          }
          break;
        }
      }
    }

    if (hasPopupVal || hasExpandedAttr || controlsId) {
      return {
        haspopup: hasPopupVal || (expandedVal !== null || controlsId ? "true" : null),
        expanded: expandedVal,
        controls: controlsId,
      };
    }

    return null;
  };

  // ── Hierarchical menu breadcrumb ─────────────────────────────────────────────
  const detectBreadcrumb = (el, controlsMap) => {
    if (!el || !el.parentElement) return null;
    const breadcrumbLabels = [];
    let curr = el.parentElement;
    let depth = 0;

    while (curr && curr !== document.body && curr !== document.documentElement && depth < 12) {
      depth++;
      const tag = (curr.tagName || "").toLowerCase();
      const role = (curr.getAttribute?.("role") || "").toLowerCase();

      // Case A: <details> ancestor -> <summary>
      if (tag === "details") {
        const summary = Array.from(curr.children || []).find(
          (c) => (c.tagName || "").toLowerCase() === "summary"
        );
        if (summary && summary !== el && curr.contains(el)) {
          const lbl = summary.__atlas_lbl || (summary.__atlas_lbl = resolveLabel(summary));
          if (lbl && !breadcrumbLabels.includes(lbl)) {
            breadcrumbLabels.push(lbl);
          }
        }
      }

      // Case B: aria-controls container target
      if (curr.id && controlsMap && controlsMap.has(curr.id)) {
        const ctrlToggle = controlsMap.get(curr.id);
        if (ctrlToggle && ctrlToggle !== el && !curr.contains(ctrlToggle) && curr.contains(el)) {
          const lbl = ctrlToggle.__atlas_lbl || (ctrlToggle.__atlas_lbl = resolveLabel(ctrlToggle));
          if (lbl && !breadcrumbLabels.includes(lbl)) {
            breadcrumbLabels.push(lbl);
          }
        }
      }

      // Case C: Adjacent toggle preceding container or parent <li> toggle
      if (tag === "ul" || tag === "ol" || tag === "nav" || role === "menu" || role === "menubar" || (curr.className && /menu|dropdown|drawer/i.test(String(curr.className)))) {
        const prev = curr.previousElementSibling;
        if (prev && prev !== el && curr.contains(el)) {
          const pTag = (prev.tagName || "").toLowerCase();
          const pRole = (prev.getAttribute?.("role") || "").toLowerCase();
          if (pTag === "button" || pTag === "a" || pRole === "button" || pRole === "menuitem") {
            const lbl = prev.__atlas_lbl || (prev.__atlas_lbl = resolveLabel(prev));
            if (lbl && !breadcrumbLabels.includes(lbl)) {
              breadcrumbLabels.push(lbl);
            }
          }
        } else if (curr.parentElement && (curr.parentElement.tagName || "").toLowerCase() === "li") {
          const li = curr.parentElement;
          const trigger = Array.from(li.children || []).find((c) => {
            if (c === curr || c === el) return false;
            const cT = (c.tagName || "").toLowerCase();
            const cR = (c.getAttribute?.("role") || "").toLowerCase();
            return cT === "button" || cT === "a" || cR === "button" || cR === "menuitem";
          });
          if (trigger && curr.contains(el)) {
            const lbl = trigger.__atlas_lbl || (trigger.__atlas_lbl = resolveLabel(trigger));
            if (lbl && !breadcrumbLabels.includes(lbl)) {
              breadcrumbLabels.push(lbl);
            }
          }
        }
      }

      curr = curr.parentElement;
    }

    if (breadcrumbLabels.length === 0) return null;
    return breadcrumbLabels.reverse().slice(-3);
  };

  // ── Find nearest toggle for reveal_via ─────────────────────────────────────────
  const findNearestToggle = (el, controlsMap) => {
    if (!el || !el.parentElement) return null;
    let curr = el.parentElement;
    let depth = 0;

    while (curr && curr !== document.body && curr !== document.documentElement && depth < 12) {
      depth++;
      const tag = (curr.tagName || "").toLowerCase();
      const role = (curr.getAttribute?.("role") || "").toLowerCase();

      // 1. <details> ancestor -> <summary>
      if (tag === "details") {
        const summary = Array.from(curr.children || []).find(
          (c) => (c.tagName || "").toLowerCase() === "summary"
        );
        if (summary && summary !== el && curr.contains(el)) return summary;
      }

      // 2. Container ID mapped in controlsMap
      if (curr.id && controlsMap && controlsMap.has(curr.id)) {
        const ctrl = controlsMap.get(curr.id);
        if (ctrl && ctrl !== el && !curr.contains(ctrl) && curr.contains(el)) return ctrl;
      }

      // 3. ul/ol/nav/menu preceding sibling or parent <li> trigger
      if (
        tag === "ul" ||
        tag === "ol" ||
        tag === "nav" ||
        role === "menu" ||
        role === "menubar" ||
        (curr.className && /menu|dropdown|drawer/i.test(String(curr.className)))
      ) {
        const prev = curr.previousElementSibling;
        if (prev && prev !== el && curr.contains(el)) {
          const pTag = (prev.tagName || "").toLowerCase();
          const pRole = (prev.getAttribute?.("role") || "").toLowerCase();
          if (pTag === "button" || pTag === "a" || pRole === "button" || pRole === "menuitem") {
            return prev;
          }
        }
        if (curr.parentElement && (curr.parentElement.tagName || "").toLowerCase() === "li") {
          const li = curr.parentElement;
          const trigger = Array.from(li.children || []).find((c) => {
            if (c === curr || c === el) return false;
            const cT = (c.tagName || "").toLowerCase();
            const cR = (c.getAttribute?.("role") || "").toLowerCase();
            return cT === "button" || cT === "a" || cR === "button" || cR === "menuitem";
          });
          if (trigger && curr.contains(el)) {
            return trigger;
          }
        }
      }

      curr = curr.parentElement;
    }
    return null;
  };

  // ── Two-Phase Layout-Safe Serializer (Feature 16 + v2 + v3) ────────────────────
  // Phase 1: Read all DOM & layout properties without modifying the DOM (Visible pass).
  // Phase 1b: Latent pass — discover hidden menu & drawer items.
  // Phase 2: Batch-write data-atlas-id & data-atlas-reveal-via attributes.
  // Phase 3: Construct the final clean payload array (visible followed by latent).
  let lastLatentDurationMs = 0;
  const getLastLatentDuration = () => lastLatentDurationMs;

  const serialize = () => {
    seenLabels.clear(); // reset duplicate tracker on each scan
    const ordinalCounter = new Map();
    const latentOrdinalCounter = new Map();

    // Check for active modal focus trap per W3C APG
    const activeModal = getActiveModalDialog();

    // Pre-build aria-controls index for O(1) toggle resolution
    const controlsMap = new Map();
    try {
      const controlledEls = document.querySelectorAll("[aria-controls]");
      for (let i = 0; i < controlledEls.length; i++) {
        const toggle = controlledEls[i];
        const ctrl = toggle.getAttribute("aria-controls");
        if (ctrl) {
          const ids = ctrl.trim().split(/\s+/);
          for (let j = 0; j < ids.length; j++) {
            const id = ids[j];
            if (id && !controlsMap.has(id)) {
              controlsMap.set(id, toggle);
            }
          }
        }
      }
    } catch (_) {}

    // Phase 1: All DOM Reads (piercing open shadow roots) — VISIBLE PASS
    const candidates = collectInteractiveElements(document);
    const passedElements = [];
    const visibleElementsSet = new Set();
    const hiddenCandidates = [];

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      // When a modal dialog is active, elements outside it are inert and occluded
      if (activeModal && !activeModal.contains(el) && !el.closest("#atlas-sidebar-root") && !el.closest("#atlas-sidebar-host")) continue;
      // Note: do NOT skip el.disabled; emit disabled: true (§11.2)
      if (!isVisible(el)) {
        const t = (el.tagName || "").toLowerCase();
        if (t !== "input" && t !== "select" && t !== "textarea") {
          hiddenCandidates.push(el);
        }
        continue;
      }
      if (isStructuralNoise(el)) continue;
      if (isMachineLabel(el)) continue;
      if (isBareIconButton(el)) continue;
      if (!hasMeaningfulLabel(el)) continue;

      const label = resolveLabel(el);
      if (!label) continue;
      if (isTextNoise(label)) continue;

      const formId = detectFormId(el);
      if (isDuplicate(label, formId)) continue;

      // Clean up stale reveal-via attribute if element is now visible (User Addition 3)
      if (el.hasAttribute(ATLAS_REVEAL_VIA_ATTR)) {
        el.removeAttribute(ATLAS_REVEAL_VIA_ATTR);
      }

      const atlasToken = el.getAttribute?.("data-atlas-token") || null;
      let sensitive = Boolean(atlasToken || isSensitiveField(el, label));

      // D6: If a field's value contains a run of 10 or more digits (normalise Arabic-Indic digits first)
      // and has no data-atlas-token, emit current_value null and sensitive true.
      const rawVal = el.value != null && el.value !== "" ? String(el.value) : "";
      if (rawVal && !atlasToken) {
        const normalizedDigits = rawVal
          .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
          .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
        if (/\d{10,}/.test(normalizedDigits)) {
          sensitive = true;
        }
      }
      const groupLabel = detectGroupLabel(el);
      const sectionLabel = detectSectionLabel(el);
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || null;
      const innerText = sensitive ? null : truncate(el.innerText || el.textContent);
      const placeholder = sensitive ? null : (el.getAttribute("placeholder") || null);
      const ariaLabel = el.getAttribute("aria-label") || null;
      const href = el.getAttribute("href") || null;
      const name = el.getAttribute("name") || null;
      const role = el.getAttribute("role") || null;
      const existingAtlasId = el.getAttribute(ATLAS_ID_ATTR);

      // v2 fields (§9.3)
      const disabled = Boolean(el.disabled || el.getAttribute("aria-disabled") === "true");
      const required = Boolean(el.required || el.getAttribute("aria-required") === "true");
      const isCheckable = type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio" || role === "switch";
      const checked = isCheckable ? Boolean(el.checked || el.getAttribute("aria-checked") === "true") : null;
      const options = collectOptions(el);
      const errorText = resolveErrorText(el);
      const invalid = Boolean(errorText || el.getAttribute("aria-invalid") === "true" || (typeof el.checkValidity === "function" && !el.checkValidity()));
      const pattern = el.getAttribute("pattern") || null;
      const maxlength = (el.maxLength > 0 && el.maxLength < 100000) ? el.maxLength : (parseInt(el.getAttribute("maxlength"), 10) || null);
      const inputmode = el.getAttribute("inputmode") || null;
      const autocomplete = el.getAttribute("autocomplete") || null;
      const currentValue = atlasToken
        ? atlasToken
        : (sensitive ? null : (el.value != null && el.value !== "" ? String(el.value) : null));

      // Disambiguate identical tuples using ordinal
      const basisKey = [tag, role || "", type || "", normaliseLabel(label), formId || ""].join("|");
      const ordinal = ordinalCounter.get(basisKey) || 0;
      ordinalCounter.set(basisKey, ordinal + 1);

      const ref = computeRef(el, label, formId, ordinal);

      // v3 metadata (§9.3)
      const menu = detectMenu(el);
      const landmark = detectLandmark(el);
      const breadcrumb = detectBreadcrumb(el, controlsMap);

      visibleElementsSet.add(el);

      el.__atlas_id = existingAtlasId || ref;
      el.__atlas_lbl = label;
      passedElements.push({
        el,
        existingAtlasId,
        ref,
        tag,
        type,
        inner_text: innerText,
        placeholder,
        aria_label: ariaLabel,
        href,
        name,
        role,
        sensitive,
        resolved_label: label,
        group_label: groupLabel,
        section_label: sectionLabel,
        form_id: formId,
        required,
        disabled,
        current_value: currentValue,
        checked,
        options,
        pattern,
        maxlength,
        inputmode,
        autocomplete,
        invalid,
        error_text: errorText,
        visible: true,
        reveal_via: null,
        menu,
        landmark,
        breadcrumb,
      });
    }

    // Phase 1b: LATENT PASS (Appended strictly after visible pass)
    const latentStartTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const passedLatentElements = [];
    let isGlobalHidden = false;
    try {
      if (document.body) {
        const bodyStyle = window.getComputedStyle(document.body);
        if (bodyStyle.display === "none" || bodyStyle.visibility === "hidden") isGlobalHidden = true;
      }
      if (!isGlobalHidden && document.documentElement) {
        const htmlStyle = window.getComputedStyle(document.documentElement);
        if (htmlStyle.display === "none" || htmlStyle.visibility === "hidden") isGlobalHidden = true;
      }
    } catch (_) {}

    if (!isGlobalHidden) {
      try {
        const parentInfoCache = new Map();
        for (let i = 0; i < hiddenCandidates.length; i++) {
          if (passedLatentElements.length >= 150) break; // Cap at 150
          const el = hiddenCandidates[i];

          // 1. Skip elements already in visible pass
          if (visibleElementsSet.has(el)) continue;

          // 2. Strict exclusions: never inputs, selects, textareas, sensitive fields
          const tag = (el.tagName || "").toLowerCase();
          if (tag === "input" || tag === "select" || tag === "textarea") continue;
          if (isSensitiveField(el)) continue;

          let info = parentInfoCache.get(el.parentElement);
          if (!info) {
            let isBlocked = false;
            let validContainer = false;
            let landmark = null;
            let formId = null;

            let curr = el.parentElement;
            let depth = 0;
            while (curr && curr !== document.body && curr !== document.documentElement && depth < 12) {
              depth++;

              const cTag = (curr.tagName || "").toLowerCase();
              const cRole = (curr.getAttribute?.("role") || "").toLowerCase();
              const cClass = (curr.getAttribute?.("class") || "").toLowerCase();
              const cId = curr.id || "";

              const isControlledOrValidContainer =
                cTag === "nav" ||
                cTag === "header" ||
                cTag === "aside" ||
                cTag === "details" ||
                cRole === "menu" ||
                cRole === "menubar" ||
                cRole === "navigation" ||
                cClass.includes("drawer") ||
                cId.includes("drawer") ||
                Boolean(cId && controlsMap.has(cId));

              if (
                (curr.getAttribute?.("aria-hidden") === "true" && !isControlledOrValidContainer) ||
                (curr.tagName === "DIALOG" && !curr.open && !curr.hasAttribute("open")) ||
                curr.hasAttribute?.("inert") ||
                curr.id === "atlas-sidebar-host" ||
                curr.id === "atlas-sidebar-root"
              ) {
                isBlocked = true;
                break;
              }

              if (cTag === "form" && !formId) {
                formId = curr.id || curr.getAttribute?.("name") || curr.getAttribute?.(ATLAS_ID_ATTR) || "form_0";
              }

              if (isControlledOrValidContainer) {
                validContainer = true;
              }

              // Closest landmark
              if (!landmark) {
                if (cTag === "header" || cRole === "banner") landmark = "header";
                else if (cTag === "nav" || cRole === "navigation") landmark = "nav";
                else if (cTag === "main" || cRole === "main") landmark = "main";
                else if (cTag === "footer" || cRole === "contentinfo") landmark = "footer";
                else if (cTag === "aside" || cRole === "complementary") landmark = "aside";
              }

              curr = curr.parentElement;
            }

            const toggleEl = findNearestToggle(el, controlsMap);
            const breadcrumb = detectBreadcrumb(el, controlsMap);

            info = {
              isBlocked,
              validContainer,
              landmark,
              formId,
              toggleEl,
              breadcrumb,
            };

            if (el.parentElement) {
              parentInfoCache.set(el.parentElement, info);
            }
          }

          if (info.isBlocked || !info.validContainer) continue;
          if (activeModal && !activeModal.contains(el)) continue;
          if (isStructuralNoise(el)) continue;

          // 4. Label resolution: fallback to textContent, aria-label, title (Rule 4)
          const ariaLabel = el.getAttribute?.("aria-label") || null;
          const title = el.getAttribute?.("title") || null;
          const rawText = ariaLabel || title || el.textContent || "";
          const label = truncate(rawText);
          if (!label) continue;
          if (isTextNoise(label)) continue;
          if (isMachineLabel(el)) continue;

          // 5. Deduplication: shared seenLabels (cannot block visible elements)
          if (isDuplicate(label, info.formId)) continue;

          // 6. Ordinal and Ref: separate latentOrdinalCounter to prevent affecting visible refs
          const role = el.getAttribute("role") || null;
          const type = el.getAttribute("type") || null;
          const basisKey = [tag, role || "", type || "", normaliseLabel(label), info.formId || ""].join("|");
          const ordinal = latentOrdinalCounter.get(basisKey) || 0;
          latentOrdinalCounter.set(basisKey, ordinal + 1);

          const ref = computeRef(el, label, info.formId, ordinal);
          const existingAtlasId = el.getAttribute(ATLAS_ID_ATTR);

          // 7. Reveal via ID
          let revealVia = null;
          const toggleEl = info.toggleEl;
          if (toggleEl) {
            let toggleId = toggleEl.__atlas_id || toggleEl.getAttribute(ATLAS_ID_ATTR);
            if (!toggleId) {
              const tLbl = toggleEl.__atlas_lbl || (toggleEl.__atlas_lbl = resolveLabel(toggleEl));
              const tRef = computeRef(toggleEl, tLbl || "toggle", info.formId, 0);
              toggleId = tRef;
              toggleEl.__atlas_id = tRef;
              toggleEl.setAttribute(ATLAS_ID_ATTR, tRef);
            }
            revealVia = toggleId;
          }

          el.__atlas_id = existingAtlasId || ref;
          el.__atlas_lbl = label;

          const innerText = truncate(el.textContent || el.innerText);
          const href = el.getAttribute("href") || null;
          const name = el.getAttribute("name") || null;
          const menu = detectMenu(el);
          const disabled = Boolean(el.disabled || el.getAttribute("aria-disabled") === "true");

          passedLatentElements.push({
            el,
            existingAtlasId,
            ref,
            tag,
            type,
            inner_text: innerText,
            placeholder: null,
            aria_label: ariaLabel,
            href,
            name,
            role,
            sensitive: false,
            resolved_label: label,
            group_label: null,
            section_label: null,
            form_id: info.formId,
            required: false,
            disabled,
            current_value: null,
            checked: null,
            options: null,
            pattern: null,
            maxlength: null,
            inputmode: null,
            autocomplete: null,
            invalid: false,
            error_text: null,
            visible: false,
            reveal_via: revealVia,
            menu,
            landmark: info.landmark,
            breadcrumb: info.breadcrumb,
          });
        }
      } catch (_) {}
    }

    const latentEndTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    lastLatentDurationMs = latentEndTime - latentStartTime;

    // Phase 2: DOM Writes (Batch data-atlas-id and data-atlas-reveal-via writes)
    for (let i = 0; i < passedElements.length; i++) {
      const item = passedElements[i];
      if (!item.existingAtlasId) {
        item.existingAtlasId = item.ref;
        item.el.setAttribute(ATLAS_ID_ATTR, item.ref);
      }
    }
    for (let i = 0; i < passedLatentElements.length; i++) {
      const item = passedLatentElements[i];
      if (!item.existingAtlasId) {
        item.existingAtlasId = item.ref;
        item.el.setAttribute(ATLAS_ID_ATTR, item.ref);
      }
      if (item.reveal_via) {
        item.el.setAttribute(ATLAS_REVEAL_VIA_ATTR, item.reveal_via);
      } else {
        item.el.removeAttribute(ATLAS_REVEAL_VIA_ATTR);
      }
    }

    // Phase 3: Output Assembly
    const assembleNode = (item) => ({
      id: item.existingAtlasId,
      tag: item.tag,
      type: item.type,
      inner_text: item.inner_text,
      placeholder: item.placeholder,
      aria_label: item.aria_label,
      href: item.href,
      name: item.name,
      role: item.role,
      sensitive: item.sensitive,
      resolved_label: item.resolved_label,
      group_label: item.group_label,
      ref: item.ref,
      form_id: item.form_id,
      required: item.required,
      disabled: item.disabled,
      current_value: item.current_value,
      checked: item.checked,
      options: item.options,
      pattern: item.pattern,
      maxlength: item.maxlength,
      inputmode: item.inputmode,
      autocomplete: item.autocomplete,
      invalid: item.invalid,
      error_text: item.error_text,
      section_label: item.section_label,
      visible: item.visible,
      reveal_via: item.reveal_via,
      menu: item.menu,
      landmark: item.landmark,
      breadcrumb: item.breadcrumb,
    });

    return passedElements.map(assembleNode).concat(passedLatentElements.map(assembleNode));
  };

  const getElementByAtlasId = (atlasId, root = document) => {
    if (!atlasId) return null;
    try {
      const direct = root.querySelector(`[${ATLAS_ID_ATTR}="${CSS.escape(atlasId)}"]`);
      if (direct) return direct;
      const all = root.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        if (all[i].id === "atlas-sidebar-host" || all[i].id === "atlas-sidebar-root") continue;
        if (all[i].shadowRoot) {
          const found = getElementByAtlasId(atlasId, all[i].shadowRoot);
          if (found) return found;
        }
      }
    } catch (_) {}
    return null;
  };

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
          m.target.id === "atlas-sidebar-host" ||
          m.target.id === "atlas-sidebar-root" ||
          m.target.closest?.("#atlas-sidebar-host") ||
          m.target.closest?.("#atlas-sidebar-root") ||
          (m.type === "attributes" && (m.attributeName === ATLAS_ID_ATTR || m.attributeName === ATLAS_REVEAL_VIA_ATTR)),
      );
      if (onlyAtlas) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onChange(serialize()), DEBOUNCE_MS);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "disabled", "aria-hidden", "aria-expanded"],
    });
    return () => observer.disconnect();
  };

  const serializerApi = {
    serialize,
    getElementByAtlasId,
    observe,
    pause,
    resume,
    isSensitiveField,
    classifySensitiveField,
    computeRef,
    fnv1a64,
    detectLandmark,
    detectMenu,
    detectBreadcrumb,
    findNearestToggle,
    getLastLatentDuration,
    ATLAS_REVEAL_VIA_ATTR,
  };

  if (typeof window !== "undefined") {
    window.AtlasSerializer = serializerApi;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = serializerApi;
  }
})();

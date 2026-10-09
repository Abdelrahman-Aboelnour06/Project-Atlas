(function () {
  // dom-serializer.js

  const ATLAS_ID_ATTR = "data-atlas-id";
  const DEBOUNCE_MS = 800;

  // ── Selectors ─────────────────────────────────────────────────────────────────
  const INTERACTIVE_SELECTOR = [
    "button",
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

const isSensitiveField = (el) => {
  if (!el) return false;
  const type = (el.getAttribute?.("type") || el.type || "").toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const autocomplete = (el.getAttribute?.("autocomplete") || el.autocomplete || "").toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE_REGEX.test(autocomplete)) return true;
  const name = el.getAttribute?.("name") || el.name || "";
  const id = el.id || el.getAttribute?.("id") || "";
  const aria = el.getAttribute?.("aria-label") || "";
  const placeholder = el.getAttribute?.("placeholder") || el.placeholder || "";
  return SENSITIVE_KEYWORD_REGEX.test(`${name} ${id} ${aria} ${placeholder}`);
};

const classifySensitiveField = (el) => {
  if (!el) return null;
  const type = (el.getAttribute?.("type") || el.type || "").toLowerCase();
  const autocomplete = (el.getAttribute?.("autocomplete") || el.autocomplete || "").toLowerCase();
  const name = (el.getAttribute?.("name") || el.name || "").toLowerCase();
  const id = (el.id || el.getAttribute?.("id") || "").toLowerCase();
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const placeholder = (el.getAttribute?.("placeholder") || el.placeholder || "").toLowerCase();
  const combined = `${autocomplete} ${name} ${id} ${aria} ${placeholder}`;

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
  "#atlas-sidebar-root", // never scan ourselves
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
    if (el.hidden) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.1) return false;
    if (parseFloat(style.fontSize) === 0) return false;
    if (el.offsetParent === null && el.tagName !== "BODY") return false;
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
    if (text.length > 1 && !/^[\W\d]$/.test(text)) return truncate(text);

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

  // ── Two-Phase Layout-Safe Serializer (Feature 16 + v2) ─────────────────────────
  // Phase 1: Read all DOM & layout properties without modifying the DOM.
  // Phase 2: Batch-write data-atlas-id attributes to newly identified elements.
  // Phase 3: Construct the final clean payload array.
  const serialize = () => {
    seenLabels.clear(); // reset duplicate tracker on each scan
    const ordinalCounter = new Map();

    // Phase 1: All DOM Reads
    const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const passedElements = [];

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      // Note: do NOT skip el.disabled; emit disabled: true (§11.2)
      if (!isVisible(el)) continue;
      if (isStructuralNoise(el)) continue;
      if (isMachineLabel(el)) continue;
      if (isBareIconButton(el)) continue;
      if (!hasMeaningfulLabel(el)) continue;

      const label = resolveLabel(el);
      if (!label) continue;
      if (isTextNoise(label)) continue;

      const formId = detectFormId(el);
      if (isDuplicate(label, formId)) continue;

      const sensitive = isSensitiveField(el);
      const groupLabel = detectGroupLabel(el);
      const sectionLabel = detectSectionLabel(el);
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || null;
      const innerText = sensitive ? null : truncate(el.innerText || el.textContent);
      const placeholder = el.getAttribute("placeholder") || null;
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
      const currentValue = sensitive ? null : (el.value != null && el.value !== "" ? String(el.value) : null);

      // Disambiguate identical tuples using ordinal
      const basisKey = [tag, role || "", type || "", normaliseLabel(label), formId || ""].join("|");
      const ordinal = ordinalCounter.get(basisKey) || 0;
      ordinalCounter.set(basisKey, ordinal + 1);

      const ref = computeRef(el, label, formId, ordinal);

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
      });
    }

    // Phase 2: DOM Writes (Batch data-atlas-id writes only)
    for (let i = 0; i < passedElements.length; i++) {
      const item = passedElements[i];
      if (!item.existingAtlasId) {
        item.existingAtlasId = item.ref;
        item.el.setAttribute(ATLAS_ID_ATTR, item.ref);
      }
    }

    // Phase 3: Output Assembly
    return passedElements.map((item) => ({
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
    }));
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
  };

  if (typeof window !== "undefined") {
    window.AtlasSerializer = serializerApi;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = serializerApi;
  }
})();

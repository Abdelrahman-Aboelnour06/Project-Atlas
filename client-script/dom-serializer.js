(function () {
  // dom-serializer.js
  // Elements are scored into two tiers:
  //   tier: 'primary'   — clean label, clearly useful, shown by default
  //   tier: 'secondary' — ambiguous or noisy, hidden under "Show more"
  // Nothing is ever fully discarded.

  const ATLAS_ID_ATTR = "data-atlas-id";
  const DEBOUNCE_MS = 800;

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

  // ── Always skip (truly invisible infrastructure) ──────────────────────────────
  const ALWAYS_SKIP_SELECTORS = [
    "#atlas-sidebar-root",
    '[aria-hidden="true"]',
    '[style*="display: none"]',
    '[style*="display:none"]',
  ];

  const NOISE_TEXT_PATTERNS = [
    /^change (language|country|region|currency)/i,
    /^\$[\d,]+(\.\d+)?\s*[-–]\s*\$[\d,]+/,
    /^filter by/i,
    /^sort by/i,
    /^back to top/i,
    /^skip to (main|content|nav)/i,
  ];

  // ── Scoring — determines primary vs secondary tier ────────────────────────────
  // Returns a score 0-100. >= 50 = primary, < 50 = secondary (shown under "more")

  const MACHINE_LABEL_RE =
    /^[a-z]{4,12}\d{3,}$|^[A-Z][a-z]{2,5}[A-Z][a-z]{2,5}[A-Z]/;

  const scoreElement = (el, label) => {
    let score = 50; // start neutral

    // Has a clean human-readable label
    if (label && label.length >= 3) score += 20;
    if (label && label.length >= 6) score += 10;

    // Label looks machine-generated
    if (label && MACHINE_LABEL_RE.test(label)) score -= 40;

    // Has explicit accessible label (someone put effort in)
    if (el.getAttribute("aria-label")) score += 10;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
      score += 15;

    // Meaningful tag
    const tag = el.tagName.toLowerCase();
    if (tag === "button") score += 15;
    if (tag === "input" || tag === "textarea") score += 15;
    if (tag === "select") score += 10;
    if (tag === "a") score += 5;

    // Tiny unlabeled icon button
    const rect = el.getBoundingClientRect();
    if (rect.width < 36 && rect.height < 36 && (!label || label.length < 3))
      score -= 30;

    // Inside navigation chrome
    if (el.closest('nav, [role="navigation"], [role="banner"], footer'))
      score -= 25;

    // Noise text
    if (label && NOISE_TEXT_PATTERNS.some((p) => p.test(label))) score -= 50;

    return Math.max(0, Math.min(100, score));
  };

  // ── Visibility ────────────────────────────────────────────────────────────────
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.1) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // ── Label resolution ──────────────────────────────────────────────────────────
  const truncate = (str, max = 80) => {
    if (!str) return null;
    const t = str.trim().replace(/\s+/g, " ");
    if (!t || t.length < 1) return null;
    return t.length > max ? t.slice(0, max) + "..." : t;
  };

  const resolveLabel = (el) => {
    const tag = el.tagName.toLowerCase();

    // 1. <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) {
        const t = truncate(lbl.innerText || lbl.textContent);
        if (t) return t;
      }
    }

    // 2. aria-labelledby
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

    // 3. title attribute
    const title = el.getAttribute("title");
    if (title?.trim()) return truncate(title);

    // 4. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim()) return truncate(ariaLabel);

    // 5. inner text (buttons / links)
    if (tag === "button" || tag === "a") {
      const text = (el.innerText || el.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
      if (text.length >= 1) return truncate(text);
    }

    // 6. Wrapping label
    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone
        .querySelectorAll("input,textarea,select")
        .forEach((i) => i.remove());
      const t = truncate(clone.innerText || clone.textContent);
      if (t) return t;
    }

    // 7. name attribute
    const name = el.getAttribute("name");
    if (name && name.length > 2) return truncate(name.replace(/[-_]/g, " "));

    // 8. placeholder
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return truncate(ph);

    // 9. value (for submit inputs)
    const val = el.getAttribute("value");
    if (val?.trim() && el.getAttribute("type") === "submit")
      return truncate(val);

    // Give it something rather than nothing so it lands in secondary
    return el.getAttribute("type")
      ? `${tag} (${el.getAttribute("type")})`
      : tag;
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

  // ── Atlas ID ──────────────────────────────────────────────────────────────────
  let idCounter = 0;
  const nextAtlasId = () => `atlas-${Date.now()}-${idCounter++}`;

  const serializeNode = (el, label, tier) => {
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
        el.type === "password"
          ? null
          : truncate(el.innerText || el.textContent),
      placeholder: el.getAttribute("placeholder") || null,
      aria_label: el.getAttribute("aria-label") || null,
      href: el.getAttribute("href") || null,
      name: el.getAttribute("name") || null,
      role: el.getAttribute("role") || null,
      resolved_label: label,
      group_label: detectGroupLabel(el),
      tier, // 'primary' | 'secondary'
    };
  };

  // ── Serialize ─────────────────────────────────────────────────────────────────
  const serialize = () => {
    const seenLabels = new Set();

    return (
      Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
        .filter(isVisible)
        .filter((el) => !el.disabled)
        .filter((el) => {
          // Hard skip only truly invisible infrastructure
          for (const sel of ALWAYS_SKIP_SELECTORS) {
            try {
              if (el.matches(sel) || el.closest(sel)) return false;
            } catch (_) {}
          }
          return true;
        })
        .map((el) => {
          const label = resolveLabel(el);
          const score = scoreElement(el, label);
          const tier = score >= 50 ? "primary" : "secondary";
          return { el, label, tier, score };
        })
        // Deduplicate within primary tier only — secondary keeps everything
        .filter(({ label, tier }) => {
          if (tier === "secondary") return true;
          const key = label.toLowerCase().trim();
          if (seenLabels.has(key)) return false;
          seenLabels.add(key);
          return true;
        })
        .map(({ el, label, tier }) => serializeNode(el, label, tier))
    );
  };

  const getElementByAtlasId = (atlasId) =>
    document.querySelector(`[${ATLAS_ID_ATTR}="${CSS.escape(atlasId)}"]`);

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

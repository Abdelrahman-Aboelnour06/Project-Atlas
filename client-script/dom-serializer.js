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
//   AtlasSerializer.observe(onChange) -> stops a MutationObserver-driven
//     re-scan, debounced 300ms per docs/conventions.md DEBOUNCE_MS

const ATLAS_ID_ATTR = 'data-atlas-id'
const DEBOUNCE_MS = 300

// Only ARIA roles that represent something a user can actually act on.
// A bare [role] selector also matches presentation/structural roles
// (role="presentation", role="img", role="region", role="list", ...),
// which are not actionable and would just add noise to the sidebar.
const INTERACTIVE_ROLES = [
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'menuitem',
    'tab',
    'combobox',
    'textbox',
    'slider',
]

// Elements we care about — matches Contract 3's "only interactive/semantic"
// rule.
// Note: [tabindex="-1"] is intentionally excluded — it means "focusable via
// JS only, not part of tab order" and is commonly used on non-interactive
// containers (modals, scroll regions) for focus management, not to mark
// something the user can act on.
const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    'form',
    ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`),
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

// Typed-in values must never reach the LLM — only labels/placeholders.
// input types considered sensitive per README Privacy & Safety section.
const SENSITIVE_INPUT_TYPES = new Set(['password', 'email', 'tel'])

let idCounter = 0
const nextAtlasId = () => `atlas-${idCounter++}`

const isVisible = (el) => {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (style.opacity === '0') return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
}

const truncate = (str, max = 200) => {
    if (!str) return null
    const trimmed = str.trim()
    if (!trimmed) return null
    return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed
}

// Note: <input> elements are void elements — they never have innerText or
// textContent in the first place (the typed value lives only in `.value`,
// which this serializer never reads or includes anywhere). So the real
// PII safeguard is simply "we never touch `.value`" — this function's
// sensitive-type branch is a defensive no-op for inputs specifically, kept
// here in case this helper is ever reused for a non-void element type.
const safeInnerText = (el) => {
    if (el.tagName === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase()
        if (SENSITIVE_INPUT_TYPES.has(type) || type === 'password') return null
    }
    return truncate(el.innerText || el.textContent)
}

const serializeNode = (el) => {
    let atlasId = el.getAttribute(ATLAS_ID_ATTR)
    if (!atlasId) {
        atlasId = nextAtlasId()
        el.setAttribute(ATLAS_ID_ATTR, atlasId)
    }
    return {
        id: atlasId,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || null,
        inner_text: safeInnerText(el),
        placeholder: el.getAttribute('placeholder') || null,
        aria_label: el.getAttribute('aria-label') || null,
        href: el.getAttribute('href') || null,
        name: el.getAttribute('name') || null,
        role: el.getAttribute('role') || null,
    }
}

// A disabled element isn't actionable right now — surfacing it in the
// sidebar as something the user "can do" would be misleading.
const isEnabled = (el) => !el.disabled

const serialize = () => {
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
        .filter((el) => !el.closest('#atlas-sidebar-root'))
        .filter(isVisible)
        .filter(isEnabled)
        .map(serializeNode)
    return nodes
}

const getElementByAtlasId = (atlasId) =>
    document.querySelector(`[${ATLAS_ID_ATTR}="${CSS.escape(atlasId)}"]`)

// Debounced MutationObserver so SPA pages (React/Vue re-renders) keep the
// sidebar in sync without hammering serialize() on every DOM tick.
const observe = (onChange) => {
    let timer = null
    const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => onChange(serialize()), DEBOUNCE_MS)
    })
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'disabled'],
    })
    return () => observer.disconnect()
}

window.AtlasSerializer = { serialize, getElementByAtlasId, observe }
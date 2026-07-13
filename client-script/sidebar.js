// sidebar.js
// Task J — the headline feature. Renders the sidebar, lists elements, and
// wires up click / mic / typed-command input.
//
// The backend "simplify" pipeline (Contract 5) now exists, so
// content.js prefers it: it calls AtlasSocket.sendSimplify() and hands
// this module the plain-language {id, label, category} items it returns.
// If simplify fails (LLM/network error) or hasn't resolved yet,
// content.js falls back to AtlasSidebar.deriveDisplayItems(domMap), which
// keeps the old inner_text / aria_label / placeholder heuristic here so
// the DOM-shape knowledge for that fallback stays in one place.
//
// Public API (window.AtlasSidebar):
//   AtlasSidebar.mount({ onElementClick, onCommandSubmit, onMicClick }) -> void
//   AtlasSidebar.unmount() -> void
//   AtlasSidebar.renderElements(items) -> void   // items: {id, label, category}[]
//   AtlasSidebar.deriveDisplayItems(domMap) -> items[]  // local fallback
//   AtlasSidebar.setStatus(text, kind) -> void   // kind: 'info'|'error'|'ok'
//   AtlasSidebar.setListening(isListening) -> void

const ROOT_ID = 'atlas-sidebar-root'

let rootEl = null
let listEl = null
let statusEl = null
let inputEl = null
let micBtn = null
let handlers = {}

// Fallback heuristic used only when the simplify pipeline hasn't answered
// yet (or errored) — turns a raw Contract-3 DOM node into a display item.
const labelFor = (node) =>
  node.aria_label ||
  node.inner_text ||
  node.placeholder ||
  node.name ||
  `${node.tag}${node.type ? ` (${node.type})` : ''}`

const categoryFor = (node) => {
  if (node.tag === 'a') return 'link'
  if (node.tag === 'button') return 'button'
  if (node.tag === 'input' || node.tag === 'textarea') return 'input'
  if (node.tag === 'select') return 'select'
  if (node.tag === 'form') return 'form'
  return node.role || 'other'
}

// Public: converts a raw dom_map (Contract 3) into the same {id, label,
// category} shape the simplify pipeline (Contract 5) returns, so
// renderElements() never needs to know which source it came from.
const deriveDisplayItems = (domMap) =>
  domMap.map((node) => ({
    id: node.id,
    label: labelFor(node),
    category: categoryFor(node),
  }))

const categoryDisplayName = (category) => {
  const names = {
    button: 'Button',
    link: 'Link',
    input: 'Input',
    select: 'Dropdown',
    textarea: 'Input',
    form: 'Form',
    other: 'Element',
  }
  return names[category] || 'Element'
}

const buildDom = () => {
  rootEl = document.createElement('div')
  rootEl.id = ROOT_ID

  rootEl.innerHTML = `
    <div class="atlas-header">
      <span class="atlas-title">Atlas</span>
      <button class="atlas-close" aria-label="Close Atlas sidebar">×</button>
    </div>
    <div class="atlas-command-bar">
      <input
        class="atlas-input"
        type="text"
        placeholder="Type a command, e.g. 'click checkout'"
      />
      <button class="atlas-mic-btn" aria-label="Speak a command">🎤</button>
    </div>
    <div class="atlas-status" aria-live="polite"></div>
    <div class="atlas-list" role="list"></div>
  `

  document.body.appendChild(rootEl)

  listEl = rootEl.querySelector('.atlas-list')
  statusEl = rootEl.querySelector('.atlas-status')
  inputEl = rootEl.querySelector('.atlas-input')
  micBtn = rootEl.querySelector('.atlas-mic-btn')

  rootEl.querySelector('.atlas-close').addEventListener('click', () => {
    handlers.onClose?.()
  })

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inputEl.value.trim()) {
      handlers.onCommandSubmit?.(inputEl.value.trim())
      inputEl.value = ''
    }
  })

  micBtn.addEventListener('click', () => {
    handlers.onMicClick?.()
  })
}

const mount = (cbs = {}) => {
  handlers = cbs
  if (document.getElementById(ROOT_ID)) return
  buildDom()
}

const unmount = () => {
  rootEl?.remove()
  rootEl = null
}

// items: [{ id, label, category }]  — already resolved by content.js,
// either from the simplify pipeline or deriveDisplayItems() above.
const renderElements = (items) => {
  if (!listEl) return
  listEl.innerHTML = ''

  items.forEach((item) => {
    const el = document.createElement('button')
    el.className = 'atlas-item'
    el.setAttribute('role', 'listitem')
    el.innerHTML = `
      <span class="atlas-item-category">${categoryDisplayName(item.category)}</span>
      <span class="atlas-item-label">${item.label}</span>
    `
    el.addEventListener('click', () => handlers.onElementClick?.(item.id))
    listEl.appendChild(el)
  })

  if (items.length === 0) {
    listEl.innerHTML =
      '<div class="atlas-empty">No interactive elements found on this page.</div>'
  }
}

const setStatus = (text, kind = 'info') => {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.className = `atlas-status atlas-status-${kind}`
}

const setListening = (isListening) => {
  micBtn?.classList.toggle('atlas-mic-active', isListening)
}

window.AtlasSidebar = {
  mount,
  unmount,
  renderElements,
  deriveDisplayItems,
  setStatus,
  setListening,
}

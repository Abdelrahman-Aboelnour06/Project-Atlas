// sidebar.js
// Task J — the headline feature. Renders the sidebar, lists elements from
// the DOM map, and wires up click / mic / typed-command input.
//
// NOTE: the backend "simplify" pipeline (README Part 4, item 1) isn't wired
// yet, so labels here fall back to inner_text / aria_label / placeholder.
// Once /v1/simplify (or equivalent) exists, swap renderElements() to use
// its plain-language labels + categories instead of the raw DOM map.
//
// Public API (window.AtlasSidebar):
//   AtlasSidebar.mount({ onElementClick, onCommandSubmit, onMicClick }) -> void
//   AtlasSidebar.unmount() -> void
//   AtlasSidebar.renderElements(domMap) -> void
//   AtlasSidebar.setStatus(text, kind) -> void   // kind: 'info'|'error'|'ok'
//   AtlasSidebar.setListening(isListening) -> void

const ROOT_ID = 'atlas-sidebar-root'

let rootEl = null
let listEl = null
let statusEl = null
let inputEl = null
let micBtn = null
let handlers = {}

// Best-effort plain-language label until the simplify pipeline exists.
const labelFor = (node) =>
  node.aria_label ||
  node.inner_text ||
  node.placeholder ||
  node.name ||
  `${node.tag}${node.type ? ` (${node.type})` : ''}`

const categoryFor = (node) => {
  if (node.tag === 'a') return 'Link'
  if (node.tag === 'button') return 'Button'
  if (node.tag === 'input' || node.tag === 'textarea') return 'Input'
  if (node.tag === 'select') return 'Dropdown'
  if (node.tag === 'form') return 'Form'
  return node.role || 'Element'
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

const renderElements = (domMap) => {
  if (!listEl) return
  listEl.innerHTML = ''

  domMap.forEach((node) => {
    const item = document.createElement('button')
    item.className = 'atlas-item'
    item.setAttribute('role', 'listitem')
    item.innerHTML = `
      <span class="atlas-item-category">${categoryFor(node)}</span>
      <span class="atlas-item-label">${labelFor(node)}</span>
    `
    item.addEventListener('click', () => handlers.onElementClick?.(node.id))
    listEl.appendChild(item)
  })

  if (domMap.length === 0) {
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

window.AtlasSidebar = { mount, unmount, renderElements, setStatus, setListening }

// executor.js
// Task D — owns all DOM WRITING (per docs/conventions.md: executor.js owns
// DOM writes, dom-serializer.js owns DOM reads — don't cross the line).
// Takes an ActionResponse (Contract 2) from the backend and performs it,
// keyed off data-atlas-id.
//
// Public API (window.AtlasExecutor):
//   AtlasExecutor.execute(actionResponse) -> { ok: boolean, message: string }

const HIGHLIGHT_CLASS = 'atlas-glow-highlight'
const HIGHLIGHT_DURATION_MS = 2000

const ensureHighlightStyleInjected = () => {
  if (document.getElementById('atlas-glow-style')) return
  const style = document.createElement('style')
  style.id = 'atlas-glow-style'
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 4px solid rgba(255, 255, 255, 0.95) !important;
      box-shadow: 0 0 24px 8px rgba(255, 255, 255, 0.85) !important;
      transition: box-shadow 0.2s ease, outline 0.2s ease;
      border-radius: 6px;
    }
  `
  document.head.appendChild(style)
}

const glow = (el) => {
  ensureHighlightStyleInjected()
  el.classList.add(HIGHLIGHT_CLASS)
  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS)
}

const scrollToElement = (el) => {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const doClick = (el) => {
  scrollToElement(el)
  glow(el)
  el.click()
}

const doFill = (el, value) => {
  scrollToElement(el)
  glow(el)
  el.focus()
  // Use the native setter so React/Vue-controlled inputs pick up the
  // change (plain `el.value = x` is ignored by these frameworks).
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

const doScroll = (el) => {
  scrollToElement(el)
  glow(el)
}

const doFocus = (el) => {
  scrollToElement(el)
  glow(el)
  el.focus()
}

const execute = (actionResponse) => {
  const { status, action, element_id: elementId, value } = actionResponse

  if (status === 'error' || status === 'no_match' || action === 'none') {
    return { ok: false, message: actionResponse.message }
  }

  const el = window.AtlasSerializer?.getElementByAtlasId(elementId)
  if (!el) {
    return {
      ok: false,
      message: `Couldn't find that element on the page anymore — try again.`,
    }
  }

  try {
    switch (action) {
      case 'click':
        doClick(el)
        break
      case 'fill':
        doFill(el, value)
        break
      case 'scroll':
        doScroll(el)
        break
      case 'focus':
        doFocus(el)
        break
      default:
        return { ok: false, message: `Unknown action '${action}'` }
    }
  } catch (err) {
    return { ok: false, message: `Failed to perform action: ${err.message}` }
  }

  return { ok: true, message: actionResponse.message }
}

window.AtlasExecutor = { execute }

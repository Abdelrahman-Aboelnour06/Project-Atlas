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

// Tracks the pending "remove highlight" timeout per element so that
// re-glowing the same element within the highlight window resets the
// timer instead of letting an earlier timeout remove the class early.
const glowTimers = new WeakMap()

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

    // Clear any previous pending removal for this element so overlapping
    // glow() calls don't let an earlier timer strip the class early.
    const existingTimer = glowTimers.get(el)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
        el.classList.remove(HIGHLIGHT_CLASS)
        glowTimers.delete(el)
    }, HIGHLIGHT_DURATION_MS)
    glowTimers.set(el, timer)
}

const scrollToElement = (el) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const doClick = (el) => {
    scrollToElement(el)
    glow(el)
    el.click()
}

// Maps a tag name to the native value-setter it needs — using the native
// setter (rather than plain `el.value = x`) is required for React/Vue-
// controlled inputs to pick up the change, and the setter must be called
// with a receiver matching the prototype it came from or it throws
// "Illegal invocation".
const NATIVE_VALUE_SETTERS = {
    TEXTAREA: () =>
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set,
    SELECT: () =>
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set,
}
const defaultInputSetter = () =>
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

const doFill = (el, value) => {
    scrollToElement(el)
    glow(el)
    el.focus()
    const getSetter = NATIVE_VALUE_SETTERS[el.tagName] || defaultInputSetter
    const setter = getSetter()
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
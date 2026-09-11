(function () {
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

const READ_ONLY_ACTIONS = new Set(['scroll', 'focus'])
const MUTATE_ACTIONS   = new Set(['click', 'fill'])

function requestConfirmation(el, action, value) {
    return new Promise((resolve) => {
        const originalOutline = el.style.outline
        el.style.outline = '4px solid rgba(255, 200, 0, 0.9)'

        const banner = document.createElement('div')
        banner.id = 'atlas-confirm-banner'
        banner.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
            background: #1b1d22; color: #f4f4f6; padding: 14px 20px;
            border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 12px; font-size: 14px;
        `
        const label = action === 'fill'
            ? `Atlas wants to type “${value}” into this field.`
            : `Atlas wants to click this element.`

        banner.innerHTML = `
            <span><strong>Confirm action:</strong> ${label}</span>
            <button id="atlas-confirm-yes" style="background:#22c55e;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Confirm</button>
            <button id="atlas-confirm-no" style="background:#ef4444;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Cancel</button>
        `
        document.body.appendChild(banner)

        const cleanup = (result) => {
            el.style.outline = originalOutline
            banner.remove()
            resolve(result)
        }

        document.getElementById('atlas-confirm-yes').onclick = () => cleanup(true)
        document.getElementById('atlas-confirm-no').onclick = () => cleanup(false)
    })
}

const execute = async (actionResponse, options = {}) => {
    const { status, action, element_id: elementId, value } = actionResponse
    if (status === 'error' || status === 'no_match' || action === 'none') {
        return { ok: false, message: actionResponse.message }
    }
    const el = window.AtlasSerializer?.getElementByAtlasId(elementId)
    if (!el) {
        return { ok: false, message: `Couldn't find that element on the page anymore — try again.` }
    }
    
    // Scroll element into view before asking for confirmation
    if (action === 'click') scrollToElement(el)
    if (action === 'fill') scrollToElement(el)

    // Require user confirmation for destructive action if not handled conversationally
    if (MUTATE_ACTIONS.has(action) && !options.skipConfirmation) {
        const confirmed = await requestConfirmation(el, action, value)
        if (!confirmed) {
            return { ok: false, message: 'Action cancelled by user.' }
        }
    }

    try {
        switch (action) {
            case 'click':   doClick(el); break
            case 'fill':    doFill(el, value); break
            case 'scroll':  doScroll(el); break
            case 'focus':   doFocus(el); break
            default:        return { ok: false, message: `Unknown action '${action}'` }
        }
    } catch (err) {
        return { ok: false, message: `Failed to perform action: ${err.message}` }
    }
    return { ok: true, message: actionResponse.message }
}

const executeStep = async (step) => {
    return execute({
        status: 'ok',
        action: step.action,
        element_id: step.element_id,
        value: step.value,
        message: step.description || `Performed ${step.action}`,
    }, { skipConfirmation: true })
}

window.AtlasExecutor = { execute, executeStep }
})();
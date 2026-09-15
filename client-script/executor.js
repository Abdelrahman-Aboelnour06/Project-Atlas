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
const TOKEN_REGEX = /^\{(password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret)(_\d+)?\}$/

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
    if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
};

const dispatchMouseSequence = (el, detail = 1) => {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail,
        clientX,
        clientY,
        buttons: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new PointerEvent('pointerup', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.dispatchEvent(new MouseEvent('click', eventInit));
};

const doClick = (el) => {
    scrollToElement(el);
    glow(el);
    el.focus();
    dispatchMouseSequence(el, 1);
    el.click();

    // If this element or a parent/child is an anchor with href, activate it
    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    if (link && link !== el && link.href) {
        link.click();
    }
};

const doOpen = async (el) => {
    scrollToElement(el);
    glow(el);
    el.focus();

    // 1. First click in sequence (detail: 1)
    dispatchMouseSequence(el, 1);
    el.click();

    await new Promise((r) => setTimeout(r, 60));

    // 2. Second click in sequence (detail: 2) + dblclick
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const dblInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 2,
        clientX,
        clientY,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', dblInit));
    el.dispatchEvent(new MouseEvent('mousedown', dblInit));
    el.dispatchEvent(new PointerEvent('pointerup', dblInit));
    el.dispatchEvent(new MouseEvent('mouseup', dblInit));
    el.dispatchEvent(new MouseEvent('click', dblInit));
    el.dispatchEvent(new MouseEvent('dblclick', dblInit));

    // 3. Enter keypress (universal accessibility standard for opening selected items, folders, files)
    const enterInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        view: window,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    el.dispatchEvent(new KeyboardEvent('keypress', enterInit));
    el.dispatchEvent(new KeyboardEvent('keyup', enterInit));

    // 4. If anchor with href
    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    if (link && link.href) {
        link.click();
    }
};

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
const MUTATE_ACTIONS   = new Set(['click', 'open', 'double_click', 'dblclick', 'fill'])

const isCredentialField = (el) => {
    if (!el || el.tagName !== 'INPUT') return false
    const type = (el.type || '').toLowerCase()
    const name = (el.name || '').toLowerCase()
    const id = (el.id || '').toLowerCase()
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase()
    return (
        type === 'password' ||
        autocomplete.includes('password') ||
        autocomplete.includes('username') ||
        name.includes('password') ||
        id.includes('password')
    )
}

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
            ? `Atlas wants to fill this field: “${value || 'value'}”.`
            : `Atlas wants to click this element.`

        const textSpan = document.createElement('span')
        const strongPrefix = document.createElement('strong')
        strongPrefix.textContent = 'Confirm action: '
        textSpan.appendChild(strongPrefix)
        textSpan.appendChild(document.createTextNode(label))

        const yesBtn = document.createElement('button')
        yesBtn.id = 'atlas-confirm-yes'
        yesBtn.style.cssText = 'background:#22c55e;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;'
        yesBtn.textContent = 'Confirm (Tap)'

        const noBtn = document.createElement('button')
        noBtn.id = 'atlas-confirm-no'
        noBtn.style.cssText = 'background:#ef4444;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;'
        noBtn.textContent = 'Cancel'

        banner.appendChild(textSpan)
        banner.appendChild(yesBtn)
        banner.appendChild(noBtn)
        document.body.appendChild(banner)

        const cleanup = (result) => {
            el.style.outline = originalOutline
            banner.remove()
            resolve(result)
        }

        yesBtn.onclick = () => cleanup(true)
        noBtn.onclick = () => cleanup(false)
    })
}

const requestNativeCredentials = async (el) => {
    if (typeof navigator === 'undefined' || !navigator.credentials?.get) {
        return { ok: false, message: 'Native credential management is not supported in this browser.' }
    }
    try {
        // Voice Guardrail (§6): strictly requires physical tap confirmation
        const confirmed = await requestConfirmation(el, 'fill', 'Stored Credentials (requires physical tap)')
        if (!confirmed) {
            return { ok: false, message: 'Credential autofill cancelled by user.' }
        }

        const cred = await navigator.credentials.get({
            password: true,
            mediation: 'optional',
        })

        if (cred && cred.password) {
            doFill(el, cred.password)
            const form = el.closest('form')
            if (form && cred.id) {
                const userField = form.querySelector('input[type="text"], input[type="email"], input[autocomplete*="username"]')
                if (userField && userField !== el) {
                    doFill(userField, cred.id)
                }
            }
            return { ok: true, message: 'Autofilled credentials securely via native browser vault.' }
        }
        return { ok: false, message: 'No stored credentials selected or available.' }
    } catch (err) {
        return { ok: false, message: `Credential autofill: ${err.message}` }
    }
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

    // Handle credential autofill flow when targeting credential fields with null or placeholder value
    if (action === 'fill' && isCredentialField(el) && (!value || value === '[AUTOFILL]' || value === '[CREDENTIAL]')) {
        return await requestNativeCredentials(el)
    }

    // Voice Guardrail (§6): credential/sensitive fields ALWAYS require physical tap confirmation
    const requiresPhysicalTap = isCredentialField(el)
    const shouldConfirm = requiresPhysicalTap || (MUTATE_ACTIONS.has(action) && !options.skipConfirmation)

    if (shouldConfirm) {
        const confirmed = await requestConfirmation(el, action, value)
        if (!confirmed) {
            return { ok: false, message: 'Action cancelled by user.' }
        }
    }

    try {
        switch (action) {
            case 'click':
                doClick(el);
                break;
            case 'open':
            case 'double_click':
            case 'dblclick':
                await doOpen(el);
                break;
            case 'fill': {
                let fillValue = value;
                if (typeof fillValue === 'string' && TOKEN_REGEX.test(fillValue.trim())) {
                    const tokenToResolve = fillValue.trim();
                    const vault = window.AtlasSecretVault || (typeof secretVault !== 'undefined' ? secretVault : null);
                    const currentOrigin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
                    const resolved = vault ? await vault.resolve(currentOrigin, tokenToResolve) : null;
                    if (!resolved) {
                        return { ok: false, message: "That value isn't saved — please say it again." };
                    }
                    fillValue = resolved;
                }
                doFill(el, fillValue);
                break;
            }
            case 'scroll':
                doScroll(el);
                break;
            case 'focus':
                doFocus(el);
                break;
            default:
                return { ok: false, message: `Unknown action '${action}'` };
        }
    } catch (err) {
        return { ok: false, message: `Failed to perform action: ${err.message}` };
    }
    return { ok: true, message: actionResponse.message };
};

const executeStep = async (step) => {
    return await execute({
        status: 'ok',
        action: step.action,
        element_id: step.element_id,
        value: step.value,
        message: step.description || `Performed ${step.action}`,
    }, { skipConfirmation: true });
};

const executorApi = { execute, executeStep, isCredentialField, requestNativeCredentials, TOKEN_REGEX };
if (typeof window !== 'undefined') {
    window.AtlasExecutor = executorApi;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = executorApi;
}
})();
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
const TOKEN_REGEX = /^\{(password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret|profile\.[a-z0-9_]+)(_\d+)?\}$/

// Tracks the pending "remove highlight" timeout per element so that
// re-glowing the same element within the highlight window resets the
// timer instead of letting an earlier timeout remove the class early.
const glowTimers = new WeakMap()

const ensureHighlightStyleInjected = () => {
    if (typeof document === 'undefined' || !document.head) return
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
    .glowing-prompt-btn, .atlas-assisted-click-glow {
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.6) !important;
      animation: pulse-glow 1.8s infinite !important;
    }
    @keyframes pulse-glow {
      0% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
      50% { box-shadow: 0 0 18px rgba(245, 158, 11, 0.9); }
      100% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
    }
  `
    document.head.appendChild(style)
}

const glow = (el) => {
    if (typeof document === 'undefined' || !el?.classList) return
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

let lastActionElement = null;

const getLastActionElement = () => lastActionElement;
const setLastActionElement = (el) => { lastActionElement = el; };

const checkAndArmTargetBlank = (link) => {
    if (!link) return;
    const target = (link.target || (typeof link.getAttribute === 'function' && link.getAttribute('target')) || '').toLowerCase().trim();
    if (target === '_blank' || target === '_new') {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            try {
                chrome.runtime.sendMessage({ type: "ATLAS_ARM_CAUSAL_WINDOW", windowMs: 3000 });
            } catch (_) {}
        }
    }
};

const doClick = (el) => {
    lastActionElement = el;
    scrollToElement(el);
    glow(el);
    el.focus();
    dispatchMouseSequence(el, 1);
    el.click();

    // If this element or a parent/child is an anchor with href, activate it
    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    if (link) {
        checkAndArmTargetBlank(link);
    }
    if (link && link !== el && link.href) {
        link.click();
        return;
    }

    // SPA child dispatch: try clicking a role=link/button child if present
    const clickableChild = el.querySelector('[role="link"], [role="button"], a[href]');
    if (clickableChild && clickableChild !== el) {
        clickableChild.click();
    }
};

const doOpen = async (el) => {
    lastActionElement = el;
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

    // 3. Enter keypress on the element AND on document (apps like Google Drive listen globally)
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
    // Also dispatch on document for apps with global keyboard listeners
    document.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    document.dispatchEvent(new KeyboardEvent('keyup', enterInit));

    // 4. If anchor with href — navigate directly (most reliable for links)
    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    if (link) {
        checkAndArmTargetBlank(link);
    }
    if (link && link.href) {
        link.click();
        return;
    }

    // 5. React/SPA child dispatch: for rows in apps like Google Drive where the real
    //    event listener lives on a specific child element (aria name cell, icon div, etc.)
    //    rather than the row container itself.
    await new Promise((r) => setTimeout(r, 40));
    const clickableChild = el.querySelector('[role="link"], [role="button"], a[href]') ||
        el.querySelector('[data-id], [data-itemid], [data-entryid]');
    if (clickableChild && clickableChild !== el) {
        clickableChild.focus();
        clickableChild.click();
        clickableChild.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true, cancelable: true, view: window, detail: 2, clientX, clientY,
        }));
    }
};

const doTripleClick = async (el) => {
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

    await new Promise((r) => setTimeout(r, 60));

    // 3. Third click in sequence (detail: 3)
    const triInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 3,
        clientX,
        clientY,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', triInit));
    el.dispatchEvent(new MouseEvent('mousedown', triInit));
    el.dispatchEvent(new PointerEvent('pointerup', triInit));
    el.dispatchEvent(new MouseEvent('mouseup', triInit));
    el.dispatchEvent(new MouseEvent('click', triInit));

    // Native browser triple-click behavior: select text contents if selectable
    if (typeof window !== 'undefined' && window.getSelection && document.createRange) {
        try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (_) {}
    }
};

const doMultiClick = async (el, count = 1) => {
    if (count <= 1) {
        doClick(el);
        return;
    }
    if (count === 2) {
        await doOpen(el);
        return;
    }
    if (count === 3) {
        await doTripleClick(el);
        return;
    }

    // For arbitrary N clicks > 3
    scrollToElement(el);
    glow(el);
    el.focus();
    for (let i = 1; i <= count; i++) {
        const detail = i <= 3 ? i : 1;
        dispatchMouseSequence(el, detail);
        el.click();
        if (i === 2) {
            const rect = el.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            el.dispatchEvent(new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                view: window,
                detail: 2,
                clientX,
                clientY,
            }));
        }
        if (i < count) {
            await new Promise((r) => setTimeout(r, 60));
        }
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
    scrollToElement(el);
    glow(el);
    el.focus();

    const stringValue = value !== null && value !== undefined ? String(value) : '';

    try {
        const getSetter = NATIVE_VALUE_SETTERS[el.tagName] || (el.tagName === 'INPUT' ? defaultInputSetter : null);
        if (getSetter) {
            const setter = getSetter();
            setter.call(el, stringValue);
        } else {
            el.value = stringValue;
            if (el.isContentEditable) el.innerText = stringValue;
        }
    } catch (_) {
        el.value = stringValue;
        if (el.isContentEditable) el.innerText = stringValue;
    }

    // Dispatch input and change events with modern InputEvent for reactive frameworks (Polymer, React, Vue)
    try {
        el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: stringValue,
        }));
    } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Key events for frameworks listening to typing
    const keyInit = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    el.dispatchEvent(new KeyboardEvent('keyup', keyInit));

    // If this is a search input, trigger Enter key to submit search
    const isSearch = el.type === 'search' || /search/i.test(el.id || '') || /search/i.test(el.name || '') || /search/i.test(el.placeholder || '') || el.getAttribute('role') === 'searchbox';
    if (isSearch) {
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
        if (el.form && typeof el.form.requestSubmit === 'function') {
            try { el.form.requestSubmit(); } catch (_) {}
        }
    }
};

const doScroll = (el) => {
    scrollToElement(el)
    glow(el)
}

const doFocus = (el) => {
    scrollToElement(el)
    glow(el)
    el.focus()
}

// ── v2 Form & Automation Actions (§9.1, §12.4) ──────────────────────────────
const defaultCheckedSetter = () =>
    (typeof window !== 'undefined' && window.HTMLInputElement)
        ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set
        : null;

const doSelectOption = (el, value) => {
    scrollToElement(el);
    glow(el);
    el.focus();

    const targetVal = String(value || '').trim();
    if (el.tagName === 'SELECT') {
        const options = Array.from(el.options || []);
        const match = options.find((opt) =>
            opt.value === targetVal ||
            opt.text.trim().toLowerCase() === targetVal.toLowerCase() ||
            (opt.label && opt.label.trim().toLowerCase() === targetVal.toLowerCase())
        );
        const resolvedValue = match ? match.value : targetVal;
        try {
            const getSetter = NATIVE_VALUE_SETTERS.SELECT;
            if (getSetter) {
                const setter = getSetter();
                setter.call(el, resolvedValue);
            } else {
                el.value = resolvedValue;
            }
        } catch (_) {
            el.value = resolvedValue;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        const role = el.getAttribute('role');
        if (role === 'combobox') {
            el.click();
            const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
            const targetContainer = controlsId ? document.getElementById(controlsId) : (el.parentElement || document);
            const opt = Array.from(targetContainer.querySelectorAll('[role="option"]')).find((o) =>
                (o.getAttribute('data-value') || o.innerText || o.textContent || '').trim().toLowerCase() === targetVal.toLowerCase()
            );
            if (opt) {
                opt.click();
            }
        } else if (role === 'option') {
            el.click();
        }
    }
};

const doSetCheckbox = (el, value) => {
    scrollToElement(el);
    glow(el);
    el.focus();

    const desiredChecked = typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
    const currentChecked = Boolean(el.checked || el.getAttribute('aria-checked') === 'true');

    if (currentChecked === desiredChecked) {
        return; // Idempotent: already in desired state
    }

    try {
        const setter = defaultCheckedSetter();
        if (setter) {
            setter.call(el, desiredChecked);
        } else {
            el.checked = desiredChecked;
        }
    } catch (_) {
        el.checked = desiredChecked;
    }

    if (el.hasAttribute('aria-checked')) {
        el.setAttribute('aria-checked', String(desiredChecked));
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

const doSetRadio = (el) => {
    scrollToElement(el);
    glow(el);
    el.focus();

    try {
        const setter = defaultCheckedSetter();
        if (setter) {
            setter.call(el, true);
        } else {
            el.checked = true;
        }
    } catch (_) {
        el.checked = true;
    }

    if (el.hasAttribute('aria-checked')) {
        el.setAttribute('aria-checked', 'true');
    }

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

const doPressKey = (el, keyName = 'Enter') => {
    scrollToElement(el);
    glow(el);
    el.focus();

    const key = String(keyName || 'Enter');
    const keyCode = key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0;
    const eventInit = {
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        view: window,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
};

const doUploadFile = async (el, fileIdentifier) => {
    scrollToElement(el);
    glow(el);
    el.focus();

    const fileName = typeof fileIdentifier === 'string' && fileIdentifier ? fileIdentifier.split('/').pop() : 'document.pdf';
    try {
        const file = new File(['mock content'], fileName, { type: 'application/pdf' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        el.files = dataTransfer.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
};

const doWaitFor = async (value = 'settle') => {
    const val = String(value || 'settle').trim();
    if (val.startsWith('element:')) {
        const ref = val.slice('element:'.length).trim();
        const start = Date.now();
        while (Date.now() - start < 5000) {
            const found = window.AtlasSerializer?.getElementByAtlasId(ref) || document.querySelector(`[data-atlas-id="${CSS.escape(ref)}"]`);
            if (found) return { ok: true, message: `Element ${ref} appeared` };
            await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: false, message: `Timed out waiting for element ${ref}` };
    }
    if (val.startsWith('text:')) {
        const phrase = val.slice('text:'.length).trim().toLowerCase();
        const start = Date.now();
        while (Date.now() - start < 5000) {
            const bodyText = (document.body?.innerText || '').toLowerCase();
            if (bodyText.includes(phrase)) return { ok: true, message: `Text "${phrase}" appeared` };
            await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: false, message: `Timed out waiting for text "${phrase}"` };
    }
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, message: 'Settled' };
};

const isEffectivelyVisible = (el) => {
    if (!el || !el.isConnected) return false;
    try {
        if (typeof el.checkVisibility === 'function') {
            return Boolean(el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        }
        if (typeof el.getClientRects === 'function') {
            const rects = el.getClientRects();
            if (rects && rects.length > 0) {
                if (typeof window !== 'undefined' && window.getComputedStyle) {
                    return window.getComputedStyle(el).visibility !== 'hidden';
                }
                return true;
            }
            return false;
        }
        if (typeof window !== 'undefined' && window.getComputedStyle) {
            let curr = el;
            while (curr) {
                const s = window.getComputedStyle(curr);
                if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
                curr = curr.parentElement;
            }
            return true;
        }
    } catch (_) {}
    return false;
};

const doReveal = async (toggleEl, targetRefOrValue) => {
    if (!toggleEl) {
        return { ok: false, message: 'Toggle element not found' };
    }

    // Resolve target element if specified
    let targetEl = null;
    if (typeof targetRefOrValue === 'string' && targetRefOrValue) {
        targetEl = window.AtlasSerializer?.getElementByAtlasId(targetRefOrValue) ||
                   (typeof document !== 'undefined' ? document.querySelector(`[data-atlas-id="${CSS.escape(targetRefOrValue)}"]`) : null);
    }

    // Helper to check if target or controlled element is visible or expanded
    const isRevealed = () => {
        // When target is given, decide strictly by target's effective visibility
        if (targetEl) {
            return isEffectivelyVisible(targetEl);
        }
        if (toggleEl.getAttribute?.('aria-expanded') === 'true') return true;
        if (toggleEl.parentElement?.tagName === 'DETAILS' && toggleEl.parentElement.open) return true;
        const controlsId = toggleEl.getAttribute?.('aria-controls');
        if (controlsId && typeof document !== 'undefined') {
            const controlled = document.getElementById(controlsId);
            if (controlled) {
                return isEffectivelyVisible(controlled);
            }
        }
        return false;
    };

    // User Addition 1: If already expanded or target is already visible, do NOT toggle closed!
    if (isRevealed()) {
        return { ok: true, message: 'Already revealed' };
    }

    scrollToElement(toggleEl);
    glow(toggleEl);

    const rect = toggleEl.getBoundingClientRect ? toggleEl.getBoundingClientRect() : { left: 0, top: 0, width: 20, height: 20 };
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // User Addition 2 Step 1: Hover (pointerover, mouseover, pointerenter, mouseenter, mousemove)
    const hoverInit = { bubbles: true, cancelable: true, view: typeof window !== 'undefined' ? window : null, clientX, clientY };
    toggleEl.dispatchEvent(new PointerEvent('pointerover', hoverInit));
    toggleEl.dispatchEvent(new MouseEvent('mouseover', hoverInit));
    toggleEl.dispatchEvent(new PointerEvent('pointerenter', hoverInit));
    toggleEl.dispatchEvent(new MouseEvent('mouseenter', hoverInit));
    toggleEl.dispatchEvent(new MouseEvent('mousemove', hoverInit));

    await new Promise((r) => setTimeout(r, 40));
    if (isRevealed()) {
        return { ok: true, message: 'Revealed via hover' };
    }

    // User Addition 2 Step 2: Focus + keyboard trigger (ArrowDown, Enter) for keyboard menus
    if (typeof toggleEl.focus === 'function') toggleEl.focus();
    const arrowDownInit = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true, view: typeof window !== 'undefined' ? window : null };
    toggleEl.dispatchEvent(new KeyboardEvent('keydown', arrowDownInit));
    toggleEl.dispatchEvent(new KeyboardEvent('keyup', arrowDownInit));

    await new Promise((r) => setTimeout(r, 40));
    if (isRevealed()) {
        return { ok: true, message: 'Revealed via keyboard focus' };
    }

    const enterInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: typeof window !== 'undefined' ? window : null };
    toggleEl.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    toggleEl.dispatchEvent(new KeyboardEvent('keypress', enterInit));
    toggleEl.dispatchEvent(new KeyboardEvent('keyup', enterInit));

    await new Promise((r) => setTimeout(r, 40));
    if (isRevealed()) {
        return { ok: true, message: 'Revealed via keyboard enter' };
    }

    // User Addition 2 Step 3: Click ONLY if still hidden AND not an <a href> that navigates away
    const tag = (toggleEl.tagName || '').toUpperCase();
    const href = toggleEl.getAttribute?.('href') || toggleEl.href || '';
    const isNavigatingLink = tag === 'A' &&
        Boolean(href) &&
        !href.startsWith('#') &&
        !href.startsWith('javascript:');

    if (!isNavigatingLink) {
        const rect = toggleEl.getBoundingClientRect ? toggleEl.getBoundingClientRect() : { left: 0, top: 0, width: 20, height: 20 };
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, view: typeof window !== 'undefined' ? window : null, clientX, clientY, buttons: 1 };
        toggleEl.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        toggleEl.dispatchEvent(new MouseEvent('mousedown', eventInit));
        toggleEl.dispatchEvent(new PointerEvent('pointerup', eventInit));
        toggleEl.dispatchEvent(new MouseEvent('mouseup', eventInit));
        if (typeof toggleEl.click === 'function') {
            toggleEl.click();
        } else {
            toggleEl.dispatchEvent(new MouseEvent('click', eventInit));
        }
    }

    // Poll up to 2,000 ms for target or menu to become visible / expanded
    const start = Date.now();
    while (Date.now() - start < 2000) {
        if (isRevealed()) {
            return { ok: true, message: 'Revealed menu' };
        }
        await new Promise((r) => setTimeout(r, 50));
    }

    if (isRevealed()) {
        return { ok: true, message: 'Revealed menu' };
    }

    return { ok: false, message: 'Timed out waiting for menu to reveal' };
};

let navigationPendingState = false;
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        navigationPendingState = true;
    });
}

const navigationPending = async () => navigationPendingState;

const READ_ONLY_ACTIONS = new Set(['scroll', 'focus', 'wait_for', 'reveal'])
const MUTATE_ACTIONS = new Set([
    'click', 'open', 'double_click', 'dblclick', 'triple_click', 'tripleclick',
    'fill', 'select_option', 'set_checkbox', 'set_radio', 'press_key', 'upload_file'
])

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

        // Clean up any existing confirmation banner
        document.getElementById('atlas-confirm-banner')?.remove()

        const banner = document.createElement('div')
        banner.id = 'atlas-confirm-banner'
        banner.style.cssText = `
            position: fixed; bottom: 24px; left: 24px; z-index: 2147483647;
            background: #1b1d22; color: #f4f4f6; padding: 14px 20px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 14px; font-size: 14px;
        `
        const rawLabel = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || 'this element').trim().replace(/\s+/g, ' ').slice(0, 40)
        const actionVerb = (action === 'open' || action === 'double_click') ? 'open' : (action === 'fill' ? 'fill' : 'click')
        const label = action === 'fill'
            ? `Atlas wants to fill this field: “${value || 'value'}”.`
            : `Atlas wants to ${actionVerb} “${rawLabel}”.`

        const textSpan = document.createElement('span')
        const strongPrefix = document.createElement('strong')
        strongPrefix.textContent = 'Confirm action: '
        textSpan.appendChild(strongPrefix)
        textSpan.appendChild(document.createTextNode(label))

        const yesBtn = document.createElement('button')
        yesBtn.id = 'atlas-confirm-yes'
        yesBtn.style.cssText = 'background:#22c55e;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;'
        yesBtn.textContent = 'Confirm (Tap)'

        const noBtn = document.createElement('button')
        noBtn.id = 'atlas-confirm-no'
        noBtn.style.cssText = 'background:#ef4444;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;'
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
    if (action === 'wait_for') {
        return await doWaitFor(value);
    }

    const el = window.AtlasSerializer?.getElementByAtlasId(elementId) ||
               (typeof document !== 'undefined' ? document.querySelector(`[data-atlas-id="${CSS.escape(elementId)}"]`) : null)
    if (!el) {
        return { ok: false, message: `Couldn't find that element on the page anymore — try again.` }
    }

    // Self-healing: if target element is hidden and has a stored reveal_via, run reveal first!
    const INTERACT_ACTIONS = ['click', 'open', 'double_click', 'dblclick', 'triple_click', 'tripleclick', 'fill'];
    if (INTERACT_ACTIONS.includes(action)) {
        const revealVia = el.getAttribute?.('data-atlas-reveal-via');
        if (!isEffectivelyVisible(el) && revealVia) {
            const toggle = window.AtlasSerializer?.getElementByAtlasId(revealVia) ||
                           (typeof document !== 'undefined' ? document.querySelector(`[data-atlas-id="${CSS.escape(revealVia)}"]`) : null);
            if (toggle) {
                const revealRes = await doReveal(toggle, elementId);
                if (!revealRes.ok) {
                    return { ok: false, message: `Could not reveal menu: ${revealRes.message}` };
                }
            }
        }
    }
    
    // Scroll element into view before asking for confirmation
    if (action === 'click' || action === 'open' || action === 'double_click' || action === 'select_option') scrollToElement(el)
    if (action === 'fill' || action === 'set_checkbox' || action === 'set_radio' || action === 'upload_file') scrollToElement(el)

    // Handle credential autofill flow when targeting credential fields with null or placeholder value
    if (action === 'fill' && isCredentialField(el) && (!value || value === '[AUTOFILL]' || value === '[CREDENTIAL]')) {
        return await requestNativeCredentials(el)
    }

    // Destructive action guardrail: high-consequence operations ALWAYS require user confirmation
    const DESTRUCTIVE_PATTERN = /\b(delete|remove|pay|transfer|purchase|place order|checkout|empty trash|erase)\b/i;
    const elLabel = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '');
    const isDestructive = DESTRUCTIVE_PATTERN.test(elLabel);

    // Guardrails: credential/sensitive fields and destructive mutations ALWAYS require confirmation
    const requiresConfirmation = isCredentialField(el) || isDestructive;
    const shouldConfirm = requiresConfirmation || (MUTATE_ACTIONS.has(action) && !options.skipConfirmation);

    if (shouldConfirm) {
        window.AtlasSidebar?.setStatus("Confirm action on page...", "info");
        const confirmed = await requestConfirmation(el, action, value);
        if (!confirmed) {
            window.AtlasSidebar?.setStatus("Action cancelled", "error");
            return { ok: false, message: 'Action cancelled by user.' };
        }
    }

    const isInteractingAction = ['click', 'open', 'double_click', 'dblclick', 'triple_click', 'tripleclick', 'fill', 'select_option', 'set_checkbox', 'set_radio', 'press_key', 'upload_file', 'reveal'].includes(action);
    if (isInteractingAction && typeof window !== 'undefined') {
        window.AtlasSidebar?.setAutoHide?.(true);
    }

    try {
        let clickCount = actionResponse.click_count;
        if (!clickCount && action === 'click') {
            if (typeof actionResponse.value === 'number') {
                clickCount = actionResponse.value;
            } else if (typeof actionResponse.value === 'string' && /^\d+$/.test(actionResponse.value.trim())) {
                clickCount = parseInt(actionResponse.value.trim(), 10);
            }
        }
        clickCount = clickCount && clickCount > 0 ? clickCount : 1;

        switch (action) {
            case 'reveal': {
                const revealRes = await doReveal(el, value);
                if (!revealRes.ok) {
                    return revealRes;
                }
                break;
            }
            case 'click':
                if (clickCount > 1) {
                    await doMultiClick(el, clickCount);
                } else {
                    doClick(el);
                }
                break;
            case 'open':
            case 'double_click':
            case 'dblclick':
                await doOpen(el);
                break;
            case 'triple_click':
            case 'tripleclick':
                await doTripleClick(el);
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
            case 'select_option':
                doSelectOption(el, value);
                break;
            case 'set_checkbox':
                doSetCheckbox(el, value);
                break;
            case 'set_radio':
                doSetRadio(el);
                break;
            case 'press_key':
                doPressKey(el, value);
                break;
            case 'upload_file':
                await doUploadFile(el, value);
                break;
            case 'wait_for':
                await doWaitFor(value);
                break;
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
    } finally {
        if (isInteractingAction && typeof window !== 'undefined') {
            window.AtlasSidebar?.setAutoHide?.(false);
        }
    }
    return { ok: true, message: actionResponse.message };
};

const executeStep = async (step) => {
    return await execute({
        status: 'ok',
        action: step.action,
        element_id: step.element_id,
        value: step.value,
        click_count: step.click_count,
        message: step.description || `Performed ${step.action}`,
    }, { skipConfirmation: true });
};

const executeBatch = async (steps, options = {}) => {
    const onProgress = options.onProgress || (() => {});
    const report = { results: [], navigated: false, settle_timeout: false };

    for (const step of steps) {
        if (await navigationPending()) {
            report.navigated = true;
            break;
        }
        const r = await executeStep(step);
        report.results.push(r);
        onProgress(step, r);
        if (!r.ok && step.critical) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return report;
};

const installPopupBlockerHook = (targetWindow = typeof window !== 'undefined' ? window : null) => {
    if (!targetWindow || !targetWindow.open) return;
    if (targetWindow.open.__atlasWrapped) return targetWindow.open;

    const originalOpen = targetWindow.open;
    const wrappedOpen = function (url, target, features) {
        let win = null;
        let thrownErr = null;
        try {
            win = originalOpen.apply(this, arguments);
        } catch (err) {
            thrownErr = err;
        }

        const isBlocked = thrownErr !== null || !win || win.closed || typeof win.closed === 'undefined';
        if (isBlocked) {
            try {
                if (typeof targetWindow.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                    targetWindow.dispatchEvent(new CustomEvent('__atlas_popup_blocked__', {
                        detail: { url, target, features, error: thrownErr?.message, timestamp: Date.now() }
                    }));
                }
            } catch (_) {}
            if (thrownErr) throw thrownErr;
        }
        return win;
    };

    wrappedOpen.__atlasWrapped = true;
    wrappedOpen.__atlasOriginal = originalOpen;
    targetWindow.open = wrappedOpen;
    return wrappedOpen;
};

const installNativeAuthHook = (targetNavigator = typeof navigator !== 'undefined' ? navigator : null) => {
    if (!targetNavigator || !targetNavigator.credentials) return;
    if (targetNavigator.credentials.get?.__atlasWrapped) return;

    const originalGet = targetNavigator.credentials.get.bind(targetNavigator.credentials);
    const originalCreate = targetNavigator.credentials.create ? targetNavigator.credentials.create.bind(targetNavigator.credentials) : null;

    const wrappedGet = async function (options) {
        const isFedCM = Boolean(options?.identity?.providers);
        const isWebAuthn = Boolean(options?.publicKey);
        const kind = isFedCM ? 'FedCM (Federated ID)' : isWebAuthn ? 'Passkey / WebAuthn' : 'Browser Credential';

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent('__atlas_native_auth_start__', {
                    detail: { action: 'get', kind, timestamp: Date.now() }
                }));
            } catch (_) {}
        }

        try {
            const cred = await originalGet(options);
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                try {
                    window.dispatchEvent(new CustomEvent('__atlas_native_auth_end__', {
                        detail: { action: 'get', kind, success: true, timestamp: Date.now() }
                    }));
                } catch (_) {}
            }
            return cred;
        } catch (err) {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                try {
                    window.dispatchEvent(new CustomEvent('__atlas_native_auth_end__', {
                        detail: { action: 'get', kind, success: false, error: err?.name || err?.message, timestamp: Date.now() }
                    }));
                } catch (_) {}
            }
            throw err;
        }
    };

    wrappedGet.__atlasWrapped = true;
    targetNavigator.credentials.get = wrappedGet;

    if (originalCreate) {
        const wrappedCreate = async function (options) {
            const kind = options?.publicKey ? 'Passkey Registration' : 'Browser Credential Creation';
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                try {
                    window.dispatchEvent(new CustomEvent('__atlas_native_auth_start__', {
                        detail: { action: 'create', kind, timestamp: Date.now() }
                    }));
                } catch (_) {}
            }

            try {
                const cred = await originalCreate(options);
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                    try {
                        window.dispatchEvent(new CustomEvent('__atlas_native_auth_end__', {
                            detail: { action: 'create', kind, success: true, timestamp: Date.now() }
                        }));
                    } catch (_) {}
                }
                return cred;
            } catch (err) {
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                    try {
                        window.dispatchEvent(new CustomEvent('__atlas_native_auth_end__', {
                            detail: { action: 'create', kind, success: false, error: err?.name || err?.message, timestamp: Date.now() }
                        }));
                    } catch (_) {}
                }
                throw err;
            }
        };
        wrappedCreate.__atlasWrapped = true;
        targetNavigator.credentials.create = wrappedCreate;
    }
};

const executorApi = {
    execute,
    executeStep,
    executeBatch,
    navigationPending,
    doClick,
    doOpen,
    doTripleClick,
    doMultiClick,
    doSelectOption,
    doSetCheckbox,
    doSetRadio,
    doPressKey,
    doUploadFile,
    doWaitFor,
    doReveal,
    isEffectivelyVisible,
    isCredentialField,
    requestNativeCredentials,
    TOKEN_REGEX,
    checkAndArmTargetBlank,
    getLastActionElement,
    setLastActionElement,
    installPopupBlockerHook,
    installNativeAuthHook,
};
if (typeof window !== 'undefined') {
    window.AtlasExecutor = executorApi;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = executorApi;
}
})();
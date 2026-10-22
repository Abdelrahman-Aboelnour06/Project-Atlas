/**
 * client-script/test_m3_2_challenger_stress.js
 *
 * Empirical Challenger M3.2 Stress & Adversarial Attack Suite
 * 
 * Independently attacks and verifies Milestone 3 deliverables:
 * 1. Blocked popup interception on window.open & assisted click pulse-glow animation (H6)
 * 2. Dual-path target="_blank" anchor handling & causal window adoption (H7, ATLAS_ARM_CAUSAL_WINDOW, ATLAS_CREATE_TAB)
 * 3. Opener DOM semantic diffing & anti-blind-trust verification (H8)
 * 4. Yield to human agency on isTrusted hardware events (H21)
 * 5. Browser-native authentication guidance mode for FedCM / Passkeys (H17)
 * 6. Small-window compact UI (<700px), 56px draggable pill, auto-hide, & elementFromPoint hit-testing exclusion (H11)
 * 7. Regression resistance, verifier sacred rails (lines 281-388), and universal Prime Directive compliance.
 *
 * Run with: node client-script/test_m3_2_challenger_stress.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passedTests = 0;
let failedTests = 0;
const failureList = [];

function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failureList.push({ name, error: err.message });
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failureList.push({ name, error: err.message });
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ── Deterministic DOM & Event Mock Infrastructure ───────────────────────────

class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) {
    for (const n of names) this._classes.add(n);
  }
  remove(...names) {
    for (const n of names) this._classes.delete(n);
  }
  toggle(name, force) {
    if (typeof force === 'boolean') {
      if (force) this._classes.add(name);
      else this._classes.delete(name);
      return force;
    }
    if (this._classes.has(name)) {
      this._classes.delete(name);
      return false;
    }
    this._classes.add(name);
    return true;
  }
  contains(name) {
    return this._classes.has(name);
  }
  get length() {
    return this._classes.size;
  }
  toString() {
    return Array.from(this._classes).join(' ');
  }
}

class MockElement {
  constructor(tagName = 'div', attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = attrs.id || '';
    this.target = attrs.target || '';
    this.href = attrs.href || '';
    this.attributes = new Map();
    this.classList = new MockClassList();
    if (attrs.class) {
      attrs.class.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    for (const [k, v] of Object.entries(attrs)) {
      if (k !== 'id' && k !== 'class') this.attributes.set(k, String(v));
    }
    this.style = {
      _props: new Map(),
      setProperty(name, val, priority) { this._props.set(name, { val, priority }); this[name] = val; },
      removeProperty(name) { this._props.delete(name); delete this[name]; },
      getPropertyValue(name) { return this._props.get(name)?.val || this[name] || ''; },
      pointerEvents: '',
      display: '',
      left: '',
      top: '',
      width: '',
      height: '',
    };
    this.children = [];
    this.parentElement = null;
    this.innerText = '';
    this.textContent = '';
    this._listeners = new Map();
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.classList.toString() || null;
    if (name === 'target') return this.target || this.attributes.get('target') || null;
    if (name === 'href') return this.href || this.attributes.get('href') || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, val) {
    if (name === 'id') { this.id = String(val); return; }
    if (name === 'target') { this.target = String(val); }
    if (name === 'href') { this.href = String(val); }
    if (name === 'class') {
      this.classList = new MockClassList();
      String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      return;
    }
    this.attributes.set(name, String(val));
  }

  removeAttribute(name) {
    if (name === 'id') { this.id = ''; return; }
    if (name === 'target') { this.target = ''; }
    if (name === 'class') { this.classList = new MockClassList(); return; }
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name) || (name === 'id' && !!this.id);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  attachShadow(options) {
    this.shadowRoot = new MockElement('shadow-root');
    this.shadowRoot.host = this;
    return this.shadowRoot;
  }

  getBoundingClientRect() {
    return {
      left: parseFloat(this.style.left) || 100,
      top: parseFloat(this.style.top) || 100,
      width: parseFloat(this.style.width) || (this.classList.contains('atlas-compact-pill') ? 56 : 348),
      height: parseFloat(this.style.height) || (this.classList.contains('atlas-compact-pill') ? 56 : 520),
      right: (parseFloat(this.style.left) || 100) + 56,
      bottom: (parseFloat(this.style.top) || 100) + 56,
    };
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector === '#atlas-sidebar-host' && curr.id === 'atlas-sidebar-host') return curr;
      if (selector === '#atlas-sidebar-root' && curr.id === 'atlas-sidebar-root') return curr;
      if (selector.includes('#atlas-sidebar-root') && curr.id === 'atlas-sidebar-root') return curr;
      if (selector.includes('#atlas-sidebar-host') && curr.id === 'atlas-sidebar-host') return curr;
      if (selector === 'a[href]' && curr.tagName === 'A' && (curr.href || curr.getAttribute('href'))) return curr;
      if (selector.includes('a') && curr.tagName === 'A') return curr;
      if (selector.includes('button') && curr.tagName === 'BUTTON') return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === '.atlas-status' || selector === '#atlas-status') {
      return this.children.find(c => c.classList.contains('atlas-status')) || new MockElement('div', { class: 'atlas-status' });
    }
    if (selector === '#assisted-click-target') {
      return this.children.find(c => c.id === 'assisted-click-target') || null;
    }
    if (selector === '.atlas-header') {
      return new MockElement('div', { class: 'atlas-header' });
    }
    return new MockElement('div');
  }

  querySelectorAll() {
    return [new MockElement('div')];
  }

  addEventListener(type, fn, opts) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture: Boolean(opts?.capture || opts === true) });
  }

  removeEventListener(type, fn) {
    if (!this._listeners.has(type)) return;
    const list = this._listeners.get(type).filter(e => e.fn !== fn);
    this._listeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = this;
    const list = this._listeners.get(event.type) || [];
    for (const entry of list) {
      try { entry.fn.call(this, event); } catch (_) {}
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true, isTrusted: false }));
  }

  focus() {}
}

class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    this.isTrusted = Boolean(init.isTrusted);
    this.target = init.target || null;
    this.key = init.key || '';
    this.code = init.code || '';
    this.altKey = Boolean(init.altKey);
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
    this.shiftKey = Boolean(init.shiftKey);
    this.detail = init.detail || null;
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

global.CustomEvent = MockEvent;
global.Event = MockEvent;

let dispatchedRuntimeMessages = [];
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (obj, cb) => { if (cb) cb(); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    sendMessage: (msg, cb) => {
      dispatchedRuntimeMessages.push(msg);
      if (cb) cb({ ok: true, data: { status: 'ok' } });
    },
    onMessage: { addListener: () => {} },
    getURL: (p) => p,
    lastError: null,
  },
  tabs: {
    create: async (opts) => ({ id: 456, ...opts }),
    sendMessage: async () => ({ ok: true }),
    onRemoved: { addListener: () => {} },
  },
};

global.window = {
  innerWidth: 1024,
  innerHeight: 768,
  location: {
    href: 'https://universal-app.org/login',
    pathname: '/login',
    origin: 'https://universal-app.org',
  },
  _listeners: new Map(),
  addEventListener(type, fn, opts) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture: Boolean(opts?.capture || opts === true) });
  },
  removeEventListener(type, fn) {
    if (!this._listeners.has(type)) return;
    this._listeners.set(type, this._listeners.get(type).filter(e => e.fn !== fn));
  },
  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    for (const entry of list) {
      try { entry.fn.call(this, event); } catch (_) {}
    }
    return !event.defaultPrevented;
  },
  open(url, target, features) {
    return { closed: false, close() { this.closed = true; } };
  },
};
global.window.top = global.window;

const mockHost = new MockElement('div', { id: 'atlas-sidebar-host' });
const mockRoot = new MockElement('div', { id: 'atlas-sidebar-root' });
global.mockSidebarHost = mockHost;
global.mockSidebarRoot = mockRoot;

global.document = {
  head: new MockElement('head'),
  body: new MockElement('body'),
  createElement(tag) { return new MockElement(tag); },
  getElementById(id) {
    if (id === 'atlas-sidebar-root') return global.mockSidebarRoot;
    if (id === 'atlas-sidebar-host') return global.mockSidebarHost;
    return null;
  },
  querySelector(sel) {
    if (sel.includes('authenticated_marker') || sel.includes('data-authenticated="true"')) {
      return global.mockAuthMarker || null;
    }
    return null;
  },
  querySelectorAll() { return []; },
  elementsFromPoint(x, y) {
    return global.__mockElementsAtPoint || [];
  },
  elementFromPoint(x, y) {
    return (global.__mockElementsAtPoint && global.__mockElementsAtPoint[0]) || null;
  },
};

global.Document = function() {};
global.Document.prototype = global.document;

global.navigator = {
  credentials: {
    get: async () => ({ id: 'cred-mock', type: 'public-key' }),
    create: async () => ({ id: 'cred-create-mock', type: 'public-key' }),
  },
};

// Load production code modules
const sidebar = require('./sidebar.js');
const executor = require('./executor.js');
const content = require('./content.js');
const background = require('./background.js');

const sidebarJsCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
const sidebarCssCode = fs.readFileSync(path.join(__dirname, 'sidebar.css'), 'utf8');
const executorJsCode = fs.readFileSync(path.join(__dirname, 'executor.js'), 'utf8');
const contentJsCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const backgroundJsCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

// Mount sidebar so internal rootEl and hostEl are initialized
sidebar.mount();

console.log('\n========================================================================');
console.log('  CHALLENGER M3.2 EMPIRICAL ADVERSARIAL STRESS HARNESS (Gen 11)        ');
console.log('========================================================================\n');

(async () => {

  // ==========================================================================
  // SUITE 1: Attack Popup-Blocker Interception & Assisted Click (H6)
  // ==========================================================================
  console.log('[Suite 1: Attack Popup-Blocker Interception & Assisted Click (H6)]');

  test('ADV-M3-01: installPopupBlockerHook intercepts window.open returning null', () => {
    let capturedEvent = null;
    const testWin = {
      open: () => null,
      dispatchEvent: (e) => { if (e.type === '__atlas_popup_blocked__') capturedEvent = e; }
    };
    executor.installPopupBlockerHook(testWin);
    const win = testWin.open('https://idp.universal.org/auth', '_blank', 'width=500');
    assert.strictEqual(win, null);
    assert(capturedEvent !== null, 'Must dispatch __atlas_popup_blocked__');
    assert.strictEqual(capturedEvent.detail.url, 'https://idp.universal.org/auth');
    assert.strictEqual(capturedEvent.detail.target, '_blank');
  });

  test('ADV-M3-02: installPopupBlockerHook intercepts window.open throwing NotAllowedError and propagates error', () => {
    let capturedEvent = null;
    const testWin = {
      open: () => {
        const err = new Error('Popup blocked by browser permissions policy');
        err.name = 'NotAllowedError';
        throw err;
      },
      dispatchEvent: (e) => { if (e.type === '__atlas_popup_blocked__') capturedEvent = e; }
    };
    executor.installPopupBlockerHook(testWin);
    let threw = false;
    try {
      testWin.open('https://idp.universal.org/auth');
    } catch (err) {
      threw = true;
      assert.strictEqual(err.name, 'NotAllowedError');
    }
    assert.strictEqual(threw, true, 'Original exception must propagate to caller');
    assert(capturedEvent !== null, 'Event must fire on throw');
    assert(capturedEvent.detail.error.includes('Popup blocked'));
  });

  test('ADV-M3-03: installPopupBlockerHook handles window.open returning already-closed window object', () => {
    let capturedEvent = null;
    const testWin = {
      open: () => ({ closed: true }),
      dispatchEvent: (e) => { if (e.type === '__atlas_popup_blocked__') capturedEvent = e; }
    };
    executor.installPopupBlockerHook(testWin);
    const win = testWin.open('https://idp.universal.org/auth');
    assert.strictEqual(win.closed, true);
    assert(capturedEvent !== null, 'Must detect closed window as blocked');
  });

  test('ADV-M3-04: installPopupBlockerHook is strictly idempotent (no double-wrapping recursion)', () => {
    const testWin = {
      open: () => ({ closed: false }),
      dispatchEvent: () => {}
    };
    const wrap1 = executor.installPopupBlockerHook(testWin);
    const wrap2 = executor.installPopupBlockerHook(testWin);
    assert.strictEqual(wrap1, wrap2, 'Multiple calls must return the same wrapped function');
    assert.strictEqual(testWin.open.__atlasWrapped, true);
  });

  test('ADV-M3-05: installPopupBlockerHook survives zero arguments window.open() without throwing', () => {
    let capturedEvent = null;
    const testWin = {
      open: () => null,
      dispatchEvent: (e) => { if (e.type === '__atlas_popup_blocked__') capturedEvent = e; }
    };
    executor.installPopupBlockerHook(testWin);
    assert.doesNotThrow(() => testWin.open());
    assert(capturedEvent !== null);
    assert.strictEqual(capturedEvent.detail.url, undefined);
  });

  test('ADV-M3-06: Assisted click rejects synthetic click (isTrusted === false) and maintains glowing state', () => {
    const targetBtn = new MockElement('button', { id: 'assisted-btn-attack' });
    let userClicked = false;

    sidebar.showAssistedClickPrompt({
      message: 'Click glowing button',
      targetEl: targetBtn,
      onUserClick: () => { userClicked = true; },
    });

    assert.strictEqual(targetBtn.classList.contains('glowing-prompt-btn'), true);

    // Fire synthetic click
    const syntheticClick = new MockEvent('click', { isTrusted: false });
    targetBtn.dispatchEvent(syntheticClick);

    assert.strictEqual(userClicked, false, 'Synthetic click MUST NOT trigger onUserClick');
    assert.strictEqual(targetBtn.classList.contains('glowing-prompt-btn'), true, 'Glow class must remain');
  });

  test('ADV-M3-07: Assisted click activates on genuine hardware click (isTrusted === true) and removes glow', () => {
    const targetBtn = new MockElement('button', { id: 'assisted-btn-trusted' });
    let userClicked = false;

    sidebar.showAssistedClickPrompt({
      message: 'Click glowing button',
      targetEl: targetBtn,
      onUserClick: () => { userClicked = true; },
    });

    // Fire genuine hardware click
    const trustedClick = new MockEvent('click', { isTrusted: true });
    targetBtn.dispatchEvent(trustedClick);

    assert.strictEqual(userClicked, true, 'Genuine hardware click MUST trigger onUserClick');
    assert.strictEqual(targetBtn.classList.contains('glowing-prompt-btn'), false, 'Glow class must be cleaned up');
  });

  test('ADV-M3-08: showAssistedClickPrompt handles null targetEl defensively without crashing', () => {
    assert.doesNotThrow(() => {
      sidebar.showAssistedClickPrompt({ message: 'No target', targetEl: null });
      sidebar.hideAssistedClickPrompt(null);
    });
  });

  test('ADV-M3-09: @keyframes pulse-glow is defined with standard box-shadow in sidebar.css and executor.js', () => {
    assert(sidebarCssCode.includes('@keyframes pulse-glow'), 'sidebar.css must define @keyframes pulse-glow');
    assert(executorJsCode.includes('@keyframes pulse-glow'), 'executor.js must define @keyframes pulse-glow');
    assert(sidebarCssCode.includes('box-shadow: 0 0 0 0'), 'Must specify starting box-shadow');
    assert(sidebarCssCode.includes('.glowing-prompt-btn'), 'Must define .glowing-prompt-btn class');
  });

  // ==========================================================================
  // SUITE 2: Attack Dual-Path target="_blank" Routing & Causal Window
  // ==========================================================================
  console.log('\n[Suite 2: Attack Dual-Path target="_blank" Routing & Causal Window]');

  test('ADV-M3-10: checkAndArmTargetBlank arms causal window for target="_blank" and uppercase target="_BLANK"', () => {
    dispatchedRuntimeMessages = [];
    const linkUpper = new MockElement('a', { href: '/portal', target: '_BLANK' });
    executor.checkAndArmTargetBlank(linkUpper);

    assert(dispatchedRuntimeMessages.some(m => m.type === 'ATLAS_ARM_CAUSAL_WINDOW' && m.windowMs === 3000),
      'Must arm causal window for uppercase target="_BLANK"');

    dispatchedRuntimeMessages = [];
    const linkStandard = new MockElement('a', { href: '/oauth', target: '_blank' });
    executor.checkAndArmTargetBlank(linkStandard);

    assert(dispatchedRuntimeMessages.some(m => m.type === 'ATLAS_ARM_CAUSAL_WINDOW' && m.windowMs === 3000),
      'Must arm causal window for lowercase target="_blank"');
  });

  test('ADV-M3-11: checkAndArmTargetBlank handles target="_new"', () => {
    dispatchedRuntimeMessages = [];
    const link = new MockElement('a', { href: '/terms', target: '_new' });
    executor.checkAndArmTargetBlank(link);

    assert(dispatchedRuntimeMessages.some(m => m.type === 'ATLAS_ARM_CAUSAL_WINDOW'),
      'Must arm causal window for target="_new"');
  });

  test('ADV-M3-12: checkAndArmTargetBlank does NOT arm for target="_self" or target="_top"', () => {
    dispatchedRuntimeMessages = [];
    const linkSelf = new MockElement('a', { href: '/home', target: '_self' });
    executor.checkAndArmTargetBlank(linkSelf);
    const linkTop = new MockElement('a', { href: '/home', target: '_top' });
    executor.checkAndArmTargetBlank(linkTop);

    assert.strictEqual(dispatchedRuntimeMessages.length, 0, 'Must NOT arm causal window for same-frame targets');
  });

  test('ADV-M3-13: checkAndArmTargetBlank handles link without href without crashing', () => {
    dispatchedRuntimeMessages = [];
    const linkNoHref = new MockElement('a', { target: '_blank' });
    assert.doesNotThrow(() => executor.checkAndArmTargetBlank(linkNoHref));
    assert(dispatchedRuntimeMessages.some(m => m.type === 'ATLAS_ARM_CAUSAL_WINDOW'));
  });

  test('ADV-M3-14: ATLAS_CREATE_TAB message handler in background.js arms causal window and sets openerTabId', () => {
    assert(backgroundJsCode.includes('if (message.type === "ATLAS_CREATE_TAB")'),
      'background.js must implement ATLAS_CREATE_TAB');
    assert(backgroundJsCode.includes('createOptions.openerTabId = openerTabId'),
      'ATLAS_CREATE_TAB must set openerTabId for causal tracking');
    assert(backgroundJsCode.includes('chrome.tabs.create(createOptions)'),
      'ATLAS_CREATE_TAB must invoke chrome.tabs.create');
  });

  // ==========================================================================
  // SUITE 3: Attack Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)
  // ==========================================================================
  console.log('\n[Suite 3: Attack Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)]');

  test('ADV-M3-15: diffSemanticSnapshots with null baseline returns verified=false', () => {
    const diff = content.diffSemanticSnapshots(null, { pathname: '/login', authElements: [], userElements: [] });
    assert.strictEqual(diff.verified, false);
    assert.strictEqual(diff.reason, 'NO_BASELINE');
  });

  test('ADV-M3-16: diffSemanticSnapshots with unchanged DOM returns verified=false (Zero Blind Trust)', () => {
    const snapshot = {
      pathname: '/login',
      authElements: ['button::Sign in with SSO'],
      userElements: [],
    };
    const diff = content.diffSemanticSnapshots(snapshot, snapshot);
    assert.strictEqual(diff.verified, false, 'Unchanged DOM must never be verified');
    assert.strictEqual(diff.reason, 'NO_SEMANTIC_CHANGE');
    assert(diff.confidence <= 0.1);
  });

  test('ADV-M3-17: diffSemanticSnapshots rejects pathname transition to another login/auth subpath', () => {
    const baseline = {
      pathname: '/login',
      authElements: ['button::Login'],
      userElements: [],
    };
    const current = {
      pathname: '/auth/step2',
      authElements: ['button::Next'],
      userElements: [],
    };
    // Transitioning from /login to /auth/step2 does NOT count as PATHNAME_TRANSITION away from auth
    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.notStrictEqual(diff.reason, 'PATHNAME_TRANSITION', 'Must not treat transition to another auth URL as complete');
  });

  test('ADV-M3-18: diffSemanticSnapshots detects golden auth swap (/login -> /dashboard + avatar added)', () => {
    const baseline = {
      pathname: '/login',
      authElements: ['button::Sign In', 'a::Forgot Password'],
      userElements: [],
    };
    const current = {
      pathname: '/dashboard',
      authElements: [],
      userElements: ['div::Profile Menu', 'button::Log Out'],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, true);
    assert.strictEqual(diff.reason, 'PATHNAME_TRANSITION');
    assert(diff.confidence >= 0.9);
  });

  test('ADV-M3-19: diffSemanticSnapshots verifies auth controls removal in same page (AUTH_CONTROLS_REMOVED)', () => {
    const baseline = {
      pathname: '/app',
      authElements: ['form::Login Modal'],
      userElements: [],
    };
    const current = {
      pathname: '/app',
      authElements: [],
      userElements: [],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, true);
    assert.strictEqual(diff.reason, 'AUTH_CONTROLS_REMOVED');
  });

  test('ADV-M3-20: diffSemanticSnapshots verifies emerging user controls (USER_CONTROLS_EMERGED)', () => {
    const baseline = {
      pathname: '/workspace',
      authElements: [],
      userElements: [],
    };
    const current = {
      pathname: '/workspace',
      authElements: [],
      userElements: ['button::User Avatar', 'span::account-id'],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, true);
    assert.strictEqual(diff.reason, 'USER_CONTROLS_EMERGED');
  });

  // ==========================================================================
  // SUITE 4: Attack Yield to Human Agency (H21)
  // ==========================================================================
  console.log('\n[Suite 4: Attack Yield to Human Agency (H21)]');

  test('ADV-M3-21: Synthetic keyboard and pointer events (isTrusted === false) NEVER trigger human yield pause', () => {
    const syntheticKey = new MockEvent('keydown', { key: 'Enter', isTrusted: false });
    const syntheticClick = new MockEvent('pointerdown', { isTrusted: false });

    content.onHumanInteraction(syntheticKey);
    content.onHumanInteraction(syntheticClick);
    assert.strictEqual(content.isPausedForHuman(), false, 'Synthetic events must be completely ignored');
  });

  test('ADV-M3-22: Trusted events targeting Atlas sidebar root or host NEVER pause execution', () => {
    const insideSidebar = new MockElement('button', { class: 'atlas-send-btn' });
    mockRoot.appendChild(insideSidebar);

    const eventInRoot = new MockEvent('pointerdown', { isTrusted: true, target: insideSidebar });
    content.onHumanInteraction(eventInRoot);
    assert.strictEqual(content.isPausedForHuman(), false, 'Interactions inside sidebar must not trigger human yield pause');
  });

  test('ADV-M3-23: Modifier-only keystrokes (Alt, Shift, Ctrl, Meta, CapsLock, Tab) are filtered out', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']) {
      const modifierEvent = new MockEvent('keydown', { key, isTrusted: true });
      content.onHumanInteraction(modifierEvent);
      assert.strictEqual(content.isPausedForHuman(), false, `${key} must not cause pause`);
    }
  });

  test('ADV-M3-24: Atlas hotkeys Alt+A and Alt+V do not trigger human yield pause', () => {
    const altA = new MockEvent('keydown', { key: 'a', code: 'KeyA', altKey: true, isTrusted: true });
    const altV = new MockEvent('keydown', { key: 'v', code: 'KeyV', altKey: true, isTrusted: true });

    content.onHumanInteraction(altA);
    assert.strictEqual(content.isPausedForHuman(), false, 'Alt+A shortcut must not cause pause');
    content.onHumanInteraction(altV);
    assert.strictEqual(content.isPausedForHuman(), false, 'Alt+V shortcut must not cause pause');
  });

  await testAsync('ADV-M3-25: resumeAfterHumanAgency safely resumes execution and clears paused flag', async () => {
    await content.resumeAfterHumanAgency();
    assert.strictEqual(content.isPausedForHuman(), false);
  });

  // ==========================================================================
  // SUITE 5: Attack Browser-Native Auth Guidance Mode (H17)
  // ==========================================================================
  console.log('\n[Suite 5: Attack Browser-Native Auth Guidance Mode (H17)]');

  test('ADV-M3-26: installNativeAuthHook wraps navigator.credentials.get and create', () => {
    const testNav = {
      credentials: {
        get: async () => ({ id: 'passkey-ok' }),
        create: async () => ({ id: 'passkey-reg' }),
      }
    };
    executor.installNativeAuthHook(testNav);
    assert.strictEqual(testNav.credentials.get.__atlasWrapped, true);
    assert.strictEqual(testNav.credentials.create.__atlasWrapped, true);
  });

  await testAsync('ADV-M3-27: navigator.credentials.get dispatches start and end on failure, and rethrows', async () => {
    let startDispatched = false;
    let endDispatched = false;
    let endSuccess = null;

    const startListener = () => { startDispatched = true; };
    const endListener = (e) => { endDispatched = true; endSuccess = e.detail?.success; };

    window.addEventListener('__atlas_native_auth_start__', startListener);
    window.addEventListener('__atlas_native_auth_end__', endListener);

    const testNav = {
      credentials: {
        get: async () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          throw err;
        }
      }
    };
    executor.installNativeAuthHook(testNav);

    let caughtError = null;
    try {
      await testNav.credentials.get({ publicKey: {} });
    } catch (err) {
      caughtError = err;
    }

    window.removeEventListener('__atlas_native_auth_start__', startListener);
    window.removeEventListener('__atlas_native_auth_end__', endListener);

    assert(caughtError !== null, 'Original error must be rethrown');
    assert.strictEqual(caughtError.name, 'AbortError');
    assert.strictEqual(startDispatched, true, 'Start event must be dispatched');
    assert.strictEqual(endDispatched, true, 'End event must be dispatched');
    assert.strictEqual(endSuccess, false, 'End event must report success: false');
  });

  test('ADV-M3-28: setGuidedAuthMode toggles .atlas-guided-auth class and content.isGuidedAuthMode()', () => {
    sidebar.setGuidedAuthMode(true, { kind: 'Passkey / WebAuthn' });
    const liveRoot = sidebar.getRoot();
    if (liveRoot) {
      assert.strictEqual(liveRoot.classList.contains('atlas-guided-auth'), true);
    }
    content.handleNativeAuthStart({ detail: { kind: 'Passkey' } });
    assert.strictEqual(content.isGuidedAuthMode(), true);

    sidebar.setGuidedAuthMode(false, { success: true });
    if (liveRoot) {
      assert.strictEqual(liveRoot.classList.contains('atlas-guided-auth'), false);
    }
    content.handleNativeAuthEnd({ detail: { success: true } });
    assert.strictEqual(content.isGuidedAuthMode(), false);
  });

  // ==========================================================================
  // SUITE 6: Attack Small-Window Compact Mode & elementFromPoint Exclusion
  // ==========================================================================
  console.log('\n[Suite 6: Attack Small-Window Compact Mode & elementFromPoint Exclusion]');

  test('ADV-M3-29: Viewport resize below 700px enters compact mode and collapses sidebar', () => {
    window.innerWidth = 680;
    assert.strictEqual(sidebar.isCompactMode(), true);
    sidebar.checkViewportResponsive();
    const liveRoot = sidebar.getRoot();
    if (liveRoot) {
      assert(liveRoot.classList.contains('atlas-compact-mode') || liveRoot.classList.contains('atlas-compact-pill'));
    }
  });

  test('ADV-M3-30: Viewport resize back to 1024px auto-expands only if auto-collapsed by compact mode', () => {
    window.innerWidth = 1024;
    assert.strictEqual(sidebar.isCompactMode(), false);
    sidebar.checkViewportResponsive();
    const liveRoot = sidebar.getRoot();
    if (liveRoot) {
      assert(!liveRoot.classList.contains('atlas-compact-mode'));
    }
  });

  test('ADV-M3-31: setAutoHide(true) hides sidebar and sets pointer-events: none !important', () => {
    sidebar.setAutoHide(true);
    assert.strictEqual(sidebar.isAutoHidden(), true);
    const liveRoot = sidebar.getRoot();
    const liveHost = sidebar.getHost();
    if (liveRoot) {
      assert.strictEqual(liveRoot.classList.contains('atlas-auto-hidden'), true);
    }
    if (liveHost) {
      assert.strictEqual(liveHost.style.pointerEvents, 'none');
    }

    sidebar.setAutoHide(false);
    assert.strictEqual(sidebar.isAutoHidden(), false);
    if (liveRoot) {
      assert.strictEqual(liveRoot.classList.contains('atlas-auto-hidden'), false);
    }
    if (liveHost) {
      assert.strictEqual(liveHost.style.pointerEvents, '');
    }
  });

  test('ADV-M3-32: elementFromPoint excludes Atlas elements and hits underlying target', () => {
    const pageButton = new MockElement('button', { id: 'universal-submit-btn' });
    global.__mockElementsAtPoint = [mockHost, pageButton];

    const hit = sidebar.elementFromPoint(150, 150);
    assert.strictEqual(hit, pageButton, 'Must bypass Atlas host element and hit host page button');
  });

  test('ADV-M3-33: elementFromPoint returns null when only Atlas element is at coordinate', () => {
    global.__mockElementsAtPoint = [mockHost, mockRoot];
    const hit = sidebar.elementFromPoint(150, 150);
    assert.strictEqual(hit, null, 'Must return null when only Atlas elements are at point');
  });

  // ==========================================================================
  // SUITE 7: Universal Directives & Sacred Verifier Rails
  // ==========================================================================
  console.log('\n[Suite 7: Universal Directives & Sacred Verifier Rails]');

  test('ADV-M3-34: Verifier sacred rails in backend/app/agent/verifier.py have strictly 0 diff lines', () => {
    const diff = execSync('git diff backend/app/agent/verifier.py', { encoding: 'utf8' }).trim();
    assert.strictEqual(diff, '', `Sacred rails in verifier.py have been modified! Diff:\n${diff}`);
  });

  test('ADV-M3-35: Zero hardcoded website domains in Milestone 3 files (Universal Directive)', () => {
    const forbidden = [
      'google.com',
      'drive.google.com',
      'amazon.com',
      'github.com',
      'wikipedia.org',
      'youtube.com',
      'facebook.com',
      'twitter.com',
      'window.location.hostname',
    ];

    const productionFiles = [
      { name: 'sidebar.js', code: sidebarJsCode },
      { name: 'sidebar.css', code: sidebarCssCode },
      { name: 'executor.js', code: executorJsCode },
      { name: 'content.js', code: contentJsCode },
      { name: 'background.js', code: backgroundJsCode },
    ];

    for (const f of productionFiles) {
      for (const term of forbidden) {
        assert(!f.code.includes(term),
          `Universal Rule Violation: Discovered forbidden pattern "${term}" in ${f.name}`);
      }
    }
  });

  test('ADV-M3-36: ARIA accessibility attributes and role="dialog" strictly present in sidebar.js', () => {
    assert(sidebarJsCode.includes('"role", "dialog"') || sidebarJsCode.includes("role=\"dialog\""));
    assert(sidebarJsCode.includes('aria-expanded'));
    assert(sidebarJsCode.includes('aria-label'));
  });

  // ==========================================================================
  // Summary & Exit
  // ==========================================================================
  console.log('\n========================================================================');
  console.log(`Challenger M3.2 Stress Suite: ${passedTests} passed, ${failedTests} failed.`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();

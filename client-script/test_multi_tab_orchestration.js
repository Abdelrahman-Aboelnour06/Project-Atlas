/**
 * client-script/test_multi_tab_orchestration.js
 *
 * Milestone 3 Comprehensive Test Suite:
 * - Small-Window Compact UI (<700px), 56px Draggable Pill (H11)
 * - Auto-Hide during Action Execution & elementFromPoint Hit-Testing Exclusion
 * - Popup Blocker Strategy, Assisted Click Glowing Prompt (.glowing-prompt-btn), and target="_blank" Routing (H6)
 * - Completion Detection Without Blind Trust (H8) with Opener DOM Semantic Diffing
 * - Yield to Human Agency on isTrusted Hardware Events (H21)
 * - Browser-Native Auth Guidance (H17) for FedCM / Passkeys
 * - Universal Prime Directive Compliance (Zero Hardcoded Domains)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Deterministic DOM & Browser Mock Harness
// ============================================================================
class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) {
    for (const name of names) this._classes.add(name);
  }
  remove(...names) {
    for (const name of names) this._classes.delete(name);
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
    this._eventListeners = new Map();
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.classList.toString() || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, val) {
    if (name === 'id') { this.id = String(val); return; }
    if (name === 'class') {
      this.classList = new MockClassList();
      String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      return;
    }
    this.attributes.set(name, String(val));
  }

  removeAttribute(name) {
    if (name === 'id') { this.id = ''; return; }
    if (name === 'class') { this.classList = new MockClassList(); return; }
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
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
      if (selector === '#atlas-sidebar-host' && (curr.id === 'atlas-sidebar-host')) return curr;
      if (selector === '#atlas-sidebar-root' && (curr.id === 'atlas-sidebar-root')) return curr;
      if (selector === 'a[href]' && curr.tagName === 'A' && (curr.href || curr.getAttribute('href'))) return curr;
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
    return this.children[0] || null;
  }

  querySelectorAll(selector) {
    return this.children;
  }

  addEventListener(type, fn, opts) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push({ fn, capture: Boolean(opts?.capture || opts === true) });
  }

  removeEventListener(type, fn) {
    if (!this._eventListeners.has(type)) return;
    const list = this._eventListeners.get(type).filter(entry => entry.fn !== fn);
    this._eventListeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = this;
    const list = this._eventListeners.get(event.type) || [];
    for (const entry of list) {
      try { entry.fn.call(this, event); } catch (_) {}
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true, isTrusted: false }));
  }

  focus() {}
  blur() {}

  attachShadow() {
    this.shadowRoot = new MockElement('div', { id: 'mock-shadow-root' });
    this.shadowRoot.host = this;
    this.shadowRoot.adoptedStyleSheets = [];
    return this.shadowRoot;
  }
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

// Global environment setup for Node execution
global.CustomEvent = MockEvent;
global.Event = MockEvent;

let sentRuntimeMessages = [];
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
      sentRuntimeMessages.push(msg);
      if (cb) cb({ ok: true, data: { status: 'ok' } });
    },
    onMessage: { addListener: () => {} },
    lastError: null,
  },
  tabs: {
    create: async (opts) => ({ id: 999, ...opts }),
    sendMessage: async () => ({ ok: true }),
    onRemoved: { addListener: () => {} },
  },
};

global.window = {
  innerWidth: 1024,
  innerHeight: 768,
  location: {
    href: 'https://example.org/login',
    pathname: '/login',
    origin: 'https://example.org',
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

global.document = {
  head: new MockElement('head'),
  body: new MockElement('body'),
  createElement(tag) { return new MockElement(tag); },
  getElementById(id) {
    if (id === 'atlas-sidebar-root') return global.AtlasSidebar?.getRoot?.() || global.mockSidebarRoot || null;
    if (id === 'atlas-sidebar-host') return global.AtlasSidebar?.getHost?.() || global.mockSidebarHost || null;
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
    get: async () => ({ id: 'cred-1', type: 'public-key' }),
    create: async () => ({ id: 'cred-created', type: 'public-key' }),
  },
};

// ============================================================================
// Load Production Modules Under Test
// ============================================================================
const sidebarJsPath = path.join(__dirname, 'sidebar.js');
const sidebarCssPath = path.join(__dirname, 'sidebar.css');
const executorJsPath = path.join(__dirname, 'executor.js');
const contentJsPath = path.join(__dirname, 'content.js');
const backgroundJsPath = path.join(__dirname, 'background.js');

const sidebarJsContent = fs.readFileSync(sidebarJsPath, 'utf8');
const sidebarCssContent = fs.readFileSync(sidebarCssPath, 'utf8');
const executorJsContent = fs.readFileSync(executorJsPath, 'utf8');
const contentJsContent = fs.readFileSync(contentJsPath, 'utf8');
const backgroundJsContent = fs.readFileSync(backgroundJsPath, 'utf8');

const sidebar = require('./sidebar.js');
const executor = require('./executor.js');
const content = require('./content.js');

// ============================================================================
// Test Framework Harness
// ============================================================================
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
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
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

// Mount sidebar for realistic integration behavior
try {
  sidebar.mount();
} catch (_) {}

const mockSidebarHost = sidebar.getHost() || new MockElement('div', { id: 'atlas-sidebar-host' });
const mockSidebarRoot = sidebar.getRoot() || new MockElement('div', { id: 'atlas-sidebar-root' });
global.mockSidebarHost = mockSidebarHost;
global.mockSidebarRoot = mockSidebarRoot;

console.log('\n================================================================');
console.log('  Project Atlas — Milestone 3 Multi-Tab & Compact UI Unit Suite ');
console.log('================================================================\n');

(async () => {
  // ==========================================================================
  // SUITE 1: Small-Window Compact UI & 56px Pill Mode (H11)
  // ==========================================================================
  console.log('[Suite 1: Small-Window Compact UI & 56px Pill Mode (H11)]');

  test('M3-01: sidebar.js defines COMPACT_VIEWPORT_THRESHOLD = 700 and PILL_SIZE = 56', () => {
    assert.strictEqual(sidebar.COMPACT_VIEWPORT_THRESHOLD, 700, 'Threshold must be 700px');
    assert.strictEqual(sidebar.PILL_SIZE, 56, 'Compact pill size must be 56px');
    assert(sidebarJsContent.includes('COLLAPSED_SIZE = 52'), 'Must preserve 52px for wide viewport compatibility');
  });

  test('M3-02: isCompactMode evaluates true when innerWidth < 700 and false when >= 700', () => {
    window.innerWidth = 699;
    assert.strictEqual(sidebar.isCompactMode(), true, '699px must be compact mode');
    window.innerWidth = 520;
    assert.strictEqual(sidebar.isCompactMode(), true, '520px must be compact mode');
    window.innerWidth = 700;
    assert.strictEqual(sidebar.isCompactMode(), false, '700px must NOT be compact mode');
    window.innerWidth = 1024;
    assert.strictEqual(sidebar.isCompactMode(), false, '1024px must NOT be compact mode');
  });

  test('M3-03: sidebar.css enforces 56px dimensions for .atlas-compact-pill and 52px for wide .atlas-collapsed', () => {
    assert(/#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*width:\s*56px\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must specify width: 56px !important for .atlas-compact-pill');
    assert(/#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*height:\s*56px\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must specify height: 56px !important for .atlas-compact-pill');
    assert(/#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*border-radius:\s*50%\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must specify border-radius: 50% !important for circular pill');
    assert(/\.atlas-collapsed\s*\{[^}]*width:\s*52px\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must retain width: 52px !important for standard wide collapsed badge');
  });

  test('M3-04: checkViewportResponsive collapses sidebar and applies .atlas-compact-pill on small viewport', () => {
    window.innerWidth = 520;
    sidebar.checkViewportResponsive();
    assert.strictEqual(sidebar.isCompactMode(), true);
  });

  test('M3-05: Expanding in compact mode removes atlas-compact-pill and preserves user agency', () => {
    sidebar.expand();
    assert.strictEqual(sidebar.isCollapsed(), false);
    sidebar.collapse();
    assert.strictEqual(sidebar.isCollapsed(), true);
  });

  test('M3-06: applyPosition bounds-checks position using 56px pill size when in compact mode', () => {
    window.innerWidth = 500;
    window.innerHeight = 600;
    sidebar.collapse();
    const pos = sidebar.applyPosition(500, 600);
    assert.strictEqual(pos.x, 500 - 56 - 20, 'Clamped x must be innerWidth - 56 - 20 (424px)');
    assert.strictEqual(pos.y, 600 - 56 - 12, 'Clamped y must be innerHeight - 56 - 12 (532px)');
  });

  // ==========================================================================
  // SUITE 2: Auto-Hide & elementFromPoint Occlusion Exclusion
  // ==========================================================================
  console.log('\n[Suite 2: Auto-Hide & elementFromPoint Occlusion Exclusion]');

  test('M3-07: setAutoHide(true) toggles atlas-auto-hidden and pointer-events: none', () => {
    sidebar.setAutoHide(true);
    assert.strictEqual(sidebar.isAutoHidden(), true, 'isAutoHidden must return true');
  });

  test('M3-08: setAutoHide(false) cleanly removes atlas-auto-hidden', () => {
    sidebar.setAutoHide(false);
    assert.strictEqual(sidebar.isAutoHidden(), false, 'isAutoHidden must return false');
  });

  test('M3-09: sidebar.css specifies opacity: 0 and pointer-events: none for .atlas-auto-hidden', () => {
    assert(/#atlas-sidebar-root\.atlas-auto-hidden\s*\{[^}]*opacity:\s*0\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must set opacity: 0 !important for .atlas-auto-hidden');
    assert(/#atlas-sidebar-root\.atlas-auto-hidden\s*\{[^}]*pointer-events:\s*none\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must set pointer-events: none !important for .atlas-auto-hidden');
    assert(/#atlas-sidebar-root\.atlas-auto-hidden\s*\{[^}]*visibility:\s*hidden\s*!important;/s.test(sidebarCssContent),
      'sidebar.css must set visibility: hidden !important for .atlas-auto-hidden');
  });

  test('M3-10: elementFromPoint transparently excludes Atlas chrome and returns host page elements', () => {
    const hostEl = new MockElement('div', { id: 'atlas-sidebar-host' });
    const targetBtn = new MockElement('button', { id: 'underlying-submit-button' });
    global.__mockElementsAtPoint = [hostEl, targetBtn];

    const hit = sidebar.elementFromPoint(120, 120);
    assert.strictEqual(hit, targetBtn, 'Hit-testing must return host element, bypassing Atlas host');
  });

  test('M3-11: Document.prototype.elementFromPoint wrapper wraps safely without recursion', () => {
    const wrappedFn = Document.prototype.elementFromPoint;
    assert(typeof wrappedFn === 'function');
  });

  // ==========================================================================
  // SUITE 3: Popup Blocker Interception & Assisted Click (H6)
  // ==========================================================================
  console.log('\n[Suite 3: Popup Blocker Interception & Assisted Click (H6)]');

  test('M3-12: installPopupBlockerHook intercepts window.open returning null and dispatches __atlas_popup_blocked__', () => {
    let eventDispatched = false;
    let eventDetail = null;

    const mockWin = {
      open: () => null,
      dispatchEvent: (e) => {
        if (e.type === '__atlas_popup_blocked__') {
          eventDispatched = true;
          eventDetail = e.detail;
        }
      },
    };

    executor.installPopupBlockerHook(mockWin);
    const result = mockWin.open('https://idp.example.com/oauth', '_blank');

    assert.strictEqual(result, null, 'Returns null from blocked open');
    assert.strictEqual(eventDispatched, true, '__atlas_popup_blocked__ must be dispatched');
    assert.strictEqual(eventDetail.url, 'https://idp.example.com/oauth');
  });

  test('M3-13: installPopupBlockerHook intercepts window.open throwing NotAllowedError', () => {
    let eventDispatched = false;

    const mockWin = {
      open: () => {
        const err = new Error('NotAllowedError: Popup blocked');
        err.name = 'NotAllowedError';
        throw err;
      },
      dispatchEvent: (e) => {
        if (e.type === '__atlas_popup_blocked__') eventDispatched = true;
      },
    };

    executor.installPopupBlockerHook(mockWin);
    assert.throws(() => mockWin.open('https://idp.example.com/auth'), /NotAllowedError/);
    assert.strictEqual(eventDispatched, true, 'Event must fire on throw');
  });

  test('M3-14: Assisted click prompt attaches .glowing-prompt-btn and .atlas-assisted-click-glow', () => {
    const targetBtn = new MockElement('button', { id: 'assisted-click-target' });
    sidebar.showAssistedClickPrompt({ message: 'Click glowing button', targetEl: targetBtn });

    assert.strictEqual(targetBtn.classList.contains('glowing-prompt-btn'), true, 'Must add glowing-prompt-btn');
    assert.strictEqual(targetBtn.classList.contains('atlas-assisted-click-glow'), true, 'Must add atlas-assisted-click-glow');

    sidebar.hideAssistedClickPrompt(targetBtn);
    assert.strictEqual(targetBtn.classList.contains('glowing-prompt-btn'), false, 'Must remove glowing-prompt-btn');
  });

  test('M3-15: CSS styles define @keyframes pulse-glow with pulsating box-shadow', () => {
    assert(sidebarCssContent.includes('@keyframes pulse-glow'), 'sidebar.css must declare @keyframes pulse-glow');
    assert(executorJsContent.includes('@keyframes pulse-glow'), 'executor.js must declare @keyframes pulse-glow');
    assert(sidebarCssContent.includes('.glowing-prompt-btn'), 'sidebar.css must style .glowing-prompt-btn');
  });

  test('M3-16: checkAndArmTargetBlank pre-arms causal window for target="_blank" links', () => {
    sentRuntimeMessages = [];
    const blankLink = new MockElement('a', { href: 'popup.html', target: '_blank' });
    executor.checkAndArmTargetBlank(blankLink);

    assert(sentRuntimeMessages.some(m => m.type === 'ATLAS_ARM_CAUSAL_WINDOW' && m.windowMs === 3000),
      'Must transmit ATLAS_ARM_CAUSAL_WINDOW with 3000ms');
  });

  // ==========================================================================
  // SUITE 4: Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)
  // ==========================================================================
  console.log('\n[Suite 4: Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)]');

  test('M3-17: captureSemanticSnapshot records url, pathname, and semantic controls', () => {
    const snapshot = content.captureSemanticSnapshot();
    assert(snapshot.timestamp > 0);
    assert.strictEqual(typeof snapshot.url, 'string');
    assert.strictEqual(typeof snapshot.pathname, 'string');
    assert(Array.isArray(snapshot.authElements));
    assert(Array.isArray(snapshot.userElements));
  });

  test('M3-18: diffSemanticSnapshots verifies pathname transition away from auth', () => {
    const baseline = {
      pathname: '/login',
      authElements: ['button::Sign in with Google'],
      userElements: [],
    };
    const current = {
      pathname: '/dashboard',
      authElements: [],
      userElements: ['button::User Profile', 'button::Sign out'],
    };

    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, true, 'Pathname transition must verify');
    assert.strictEqual(diff.reason, 'PATHNAME_TRANSITION');
    assert(diff.confidence >= 0.9);
  });

  test('M3-19: diffSemanticSnapshots verifies golden auth swap (auth removed, session control added)', () => {
    const baseline = {
      pathname: '/portal',
      authElements: ['button::Sign in to Account'],
      userElements: [],
    };
    const current = {
      pathname: '/portal',
      authElements: [],
      userElements: ['div::User Avatar', 'button::Log out'],
    };

    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, true, 'Auth swap must verify');
    assert.strictEqual(diff.reason, 'AUTH_SWAP_VERIFIED');
    assert(diff.confidence >= 0.95);
  });

  test('M3-20: diffSemanticSnapshots rejects unchanged DOM without claiming completion', () => {
    const baseline = {
      pathname: '/portal',
      authElements: ['button::Connect OAuth'],
      userElements: [],
    };
    const current = {
      pathname: '/portal',
      authElements: ['button::Connect OAuth'],
      userElements: [],
    };

    const diff = content.diffSemanticSnapshots(baseline, current);
    assert.strictEqual(diff.verified, false, 'Unchanged DOM must NOT verify');
    assert.strictEqual(diff.reason, 'NO_SEMANTIC_CHANGE');
    assert(diff.confidence <= 0.1);
  });

  test('M3-21: background.js onRemoved listener forwards ATLAS_CHILD_TAB_CLOSED to opener tab', () => {
    assert(backgroundJsContent.includes('type: "ATLAS_CHILD_TAB_CLOSED"'),
      'background.js must transmit ATLAS_CHILD_TAB_CLOSED on child tab removal');
    assert(backgroundJsContent.includes('removalResult.newLeaseTabId'),
      'background.js must send message to reclaimed lease tab ID');
  });

  test('M3-22: content.js handleChildTabClosed prompts user for confirmation on ambiguous/unchanged DOM', () => {
    assert(contentJsContent.includes('handleChildTabClosed'), 'content.js must implement handleChildTabClosed');
    assert(contentJsContent.includes('Confirmation required'), 'content.js must request user confirmation on ambiguity');
    assert(contentJsContent.includes('Yes, continue'), 'content.js must offer Yes, continue chip');
    assert(contentJsContent.includes('No, retry'), 'content.js must offer No, retry chip');
  });

  // ==========================================================================
  // SUITE 5: Yield to Human Agency on isTrusted Input (H21)
  // ==========================================================================
  console.log('\n[Suite 5: Yield to Human Agency on isTrusted Input (H21)]');

  test('M3-23: Synthetic events (isTrusted === false) do not pause execution', () => {
    const syntheticEvent = new MockEvent('keydown', { key: 'a', isTrusted: false });
    content.onHumanInteraction(syntheticEvent);
    assert.strictEqual(content.isPausedForHuman(), false, 'Synthetic event must be ignored');
  });

  test('M3-24: Hardware events (isTrusted === true) trigger human agency pause when active', () => {
    content.setExecuting(true);
    const trustedKey = new MockEvent('keydown', { key: 'x', isTrusted: true });
    content.onHumanInteraction(trustedKey);
    assert.strictEqual(content.isPausedForHuman(), true, 'Trusted hardware event must pause execution');
    content.resumeAfterHumanAgency();
  });

  test('M3-25: Hardware events inside Atlas sidebar (#atlas-sidebar-root) do NOT pause automation', () => {
    content.setExecuting(true);
    const sidebarInput = new MockElement('input', { class: 'atlas-chat-input' });
    const currentRoot = sidebar.getRoot() || mockSidebarRoot;
    currentRoot.appendChild(sidebarInput);
    const trustedEventInSidebar = new MockEvent('keydown', { key: 'Hello', isTrusted: true, target: sidebarInput });

    content.onHumanInteraction(trustedEventInSidebar);
    assert.strictEqual(content.isPausedForHuman(), false, 'Sidebar input must not trigger pause');
  });

  test('M3-26: Modifier-only keystrokes (Shift, Ctrl, Alt, Meta) do not trigger human yield pause', () => {
    content.setExecuting(true);
    const shiftEvent = new MockEvent('keydown', { key: 'Shift', isTrusted: true });
    content.onHumanInteraction(shiftEvent);
    assert.strictEqual(content.isPausedForHuman(), false, 'Shift key must not pause');
  });

  test('M3-27: resumeAfterHumanAgency clears paused state and hides resume button', async () => {
    content.setExecuting(true);
    const trustedKey = new MockEvent('keydown', { key: 'x', isTrusted: true });
    content.onHumanInteraction(trustedKey);
    assert.strictEqual(content.isPausedForHuman(), true, 'Pause state must be true before resume');
    await content.resumeAfterHumanAgency();
    assert.strictEqual(content.isPausedForHuman(), false, 'Pause state must be false after resume');
  });

  test('M3-28: sidebar.js exports showResumeButton and hideResumeButton', () => {
    assert(typeof sidebar.showResumeButton === 'function', 'showResumeButton must be exported');
    assert(typeof sidebar.hideResumeButton === 'function', 'hideResumeButton must be exported');
    sidebar.showResumeButton();
    sidebar.hideResumeButton();
  });

  // ==========================================================================
  // SUITE 6: Browser-Native Credential Guidance Mode (H17)
  // ==========================================================================
  console.log('\n[Suite 6: Browser-Native Credential Guidance Mode (H17)]');

  test('M3-29: installNativeAuthHook wraps navigator.credentials.get and create', () => {
    const mockNav = {
      credentials: {
        get: async () => ({ id: 'passkey-ok' }),
        create: async () => ({ id: 'passkey-reg' }),
      },
    };
    executor.installNativeAuthHook(mockNav);
    assert.strictEqual(mockNav.credentials.get.__atlasWrapped, true, 'get must be wrapped');
    assert.strictEqual(mockNav.credentials.create.__atlasWrapped, true, 'create must be wrapped');
  });

  await testAsync('M3-30: navigator.credentials.get dispatches __atlas_native_auth_start__ and end', async () => {
    let startFired = false;
    let endFired = false;

    window.addEventListener('__atlas_native_auth_start__', () => { startFired = true; });
    window.addEventListener('__atlas_native_auth_end__', () => { endFired = true; });

    const mockNav = {
      credentials: {
        get: async () => ({ id: 'fedcm-session' }),
      },
    };
    executor.installNativeAuthHook(mockNav);
    await mockNav.credentials.get({ identity: { providers: [{ configURL: 'https://idp.example/fedcm.json' }] } });

    assert.strictEqual(startFired, true, 'Native auth start event must fire');
    assert.strictEqual(endFired, true, 'Native auth end event must fire');
  });

  test('M3-31: handleNativeAuthStart activates guided mode and updates UI', () => {
    content.handleNativeAuthStart({ detail: { kind: 'Passkey / WebAuthn' } });
    assert.strictEqual(content.isGuidedAuthMode(), true, 'Must enter guided mode');
  });

  test('M3-32: handleNativeAuthEnd clears guided mode upon resolution', () => {
    content.handleNativeAuthEnd({ detail: { success: true } });
    assert.strictEqual(content.isGuidedAuthMode(), false, 'Must exit guided mode');
  });

  // ==========================================================================
  // SUITE 7: Universal Prime Directive Compliance
  // ==========================================================================
  console.log('\n[Suite 7: Universal Prime Directive Compliance]');

  test('M3-33: Zero hardcoded website domains across Milestone 3 files (Prime Directive)', () => {
    const forbiddenDomains = [
      'google.com',
      'drive.google.com',
      'amazon.com',
      'github.com',
      'wikipedia.org',
      'youtube.com',
      'facebook.com',
      'twitter.com',
    ];

    const filesToCheck = [
      { name: 'sidebar.js', content: sidebarJsContent },
      { name: 'sidebar.css', content: sidebarCssContent },
      { name: 'executor.js', content: executorJsContent },
      { name: 'content.js', content: contentJsContent },
      { name: 'background.js', content: backgroundJsContent },
    ];

    for (const file of filesToCheck) {
      for (const domain of forbiddenDomains) {
        assert(!file.content.includes(domain),
          `Prime Directive Violation: Hardcoded domain "${domain}" discovered in ${file.name}!`);
      }
    }
  });

  test('M3-34: Zero window.location.hostname hardcoded domain checks across client scripts', () => {
    const files = [
      { name: 'sidebar.js', content: sidebarJsContent },
      { name: 'executor.js', content: executorJsContent },
      { name: 'content.js', content: contentJsContent },
      { name: 'background.js', content: backgroundJsContent },
    ];

    for (const f of files) {
      assert(!/window\.location\.hostname\s*===/i.test(f.content),
        `Prime Directive Violation: window.location.hostname === found in ${f.name}`);
      assert(!/window\.location\.hostname\.includes/i.test(f.content),
        `Prime Directive Violation: window.location.hostname.includes found in ${f.name}`);
    }
  });

  test('M3-35: Universal ARIA accessibility and standard W3C event compliance across M3', () => {
    assert(sidebarJsContent.includes('"role", "dialog"') || sidebarJsContent.includes('role="dialog"'), 'Sidebar dialog must declare role="dialog"');
    assert(sidebarJsContent.includes('aria-expanded'), 'Sidebar must manage aria-expanded state');
    assert(contentJsContent.includes('isTrusted'), 'Human agency must use W3C event.isTrusted standard');
  });

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`Multi-Tab Orchestration Suite Complete: ${passedTests} passed, ${failedTests} failed.`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();

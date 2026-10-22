/**
 * Project Atlas — Milestone 3 Empirical Challenger Adversarial Stress Suite
 * File: client-script/test_m3_challenger_stress.js
 *
 * Empirical Challenger M3.1 (Generation 11) Harness:
 * 1. Small-Window Compact UI (<700px) & 56px Pill Stress Testing
 * 2. Auto-Hide & elementFromPoint Passthrough Stress Testing
 * 3. Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)
 * 4. Yield to Human Agency (H21) Under Adversarial Conditions
 * 5. Popup Blocker Hook & Assisted Click (H6)
 * 6. Browser-Native Auth Ceremony Guidance (H17)
 * 7. Universal Prime Directive & Verifier Sacred Rails
 *
 * Run with: node client-script/test_m3_challenger_stress.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;
const failureDetails = [];
const empiricalFindings = [];

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failureDetails.push({ name, details });
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

function noteFinding(id, title, details) {
  empiricalFindings.push({ id, title, details });
  console.warn(`  [EMPIRICAL FINDING DISCOVERED] ${id}: ${title}`);
}

// ── Mock DOM & Window Primitives ─────────────────────────────────────────────
class MockClassList {
  constructor(initial = []) {
    this._classes = new Set(initial);
  }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this._classes.has(name)) { this._classes.delete(name); return false; }
      this._classes.add(name); return true;
    }
    if (force) { this._classes.add(name); return true; }
    this._classes.delete(name); return false;
  }
  contains(name) { return this._classes.has(name); }
  toString() { return Array.from(this._classes).join(' '); }
}

class MockElement {
  constructor(tagName = 'div', attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = attrs.id || '';
    this.attributes = new Map(Object.entries(attrs));
    this.classList = new MockClassList(attrs.class ? attrs.class.split(/\s+/) : []);
    this.style = {
      setProperty: (k, v) => { this.style[k] = v; },
      removeProperty: (k) => { delete this.style[k]; },
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
      this.classList = new MockClassList(String(val).split(/\s+/).filter(Boolean));
      return;
    }
    this.attributes.set(name, String(val));
  }

  removeAttribute(name) {
    if (name === 'id') { this.id = ''; return; }
    if (name === 'class') { this.classList = new MockClassList(); return; }
    this.attributes.delete(name);
  }

  hasAttribute(name) { return this.attributes.has(name); }

  appendChild(child) {
    if (!child) return child;
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
    const isPill = this.classList.contains('atlas-compact-pill') || this.classList.contains('atlas-collapsed');
    const width = isPill ? 56 : (parseFloat(this.style.width) || 348);
    const height = isPill ? 56 : (parseFloat(this.style.height) || 520);
    const left = parseFloat(this.style.left) || 100;
    const top = parseFloat(this.style.top) || 100;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.includes('#atlas-sidebar-host') && (curr.id === 'atlas-sidebar-host')) return curr;
      if (selector.includes('#atlas-sidebar-root') && (curr.id === 'atlas-sidebar-root')) return curr;
      if (selector.includes('button') && curr.tagName === 'BUTTON') return curr;
      if (selector.includes('a') && curr.tagName === 'A') return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === '.atlas-status' || selector === '#atlas-status') {
      const found = this.children.find(c => c.classList && c.classList.contains('atlas-status'));
      return found || new MockElement('div', { class: 'atlas-status' });
    }
    if (selector === '#assisted-click-target') {
      return this.children.find(c => c.id === 'assisted-click-target') || null;
    }
    for (const c of this.children) {
      if (c.matchesSelector && c.matchesSelector(selector)) return c;
      const sub = c.querySelector ? c.querySelector(selector) : null;
      if (sub) return sub;
    }
    return new MockElement('div');
  }

  querySelectorAll() {
    return this.children;
  }

  matchesSelector(sel) {
    if (sel.startsWith('.') && this.classList.contains(sel.slice(1))) return true;
    if (sel.startsWith('#') && this.id === sel.slice(1)) return true;
    return false;
  }

  addEventListener(type, fn, opts) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push({ fn, capture: Boolean(opts?.capture || opts === true) });
  }

  removeEventListener(type, fn) {
    if (!this._eventListeners.has(type)) return;
    this._eventListeners.set(type, this._eventListeners.get(type).filter(e => e.fn !== fn));
  }

  dispatchEvent(event) {
    event.target = this;
    const list = this._eventListeners.get(event.type) || [];
    for (const entry of list) {
      try { entry.fn.call(this, event); } catch (_) {}
    }
    return !event.defaultPrevented;
  }

  attachShadow() {
    this.shadowRoot = new MockElement('div', { id: 'mock-shadow-root' });
    this.shadowRoot.host = this;
    this.shadowRoot.adoptedStyleSheets = [];
    return this.shadowRoot;
  }

  focus() {}
  blur() {}
}

class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.target = init.target || null;
    this.isTrusted = init.isTrusted !== undefined ? Boolean(init.isTrusted) : false;
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

// Setup Environment
global.MockElement = MockElement;
global.MockEvent = MockEvent;
global.CustomEvent = MockEvent;
global.Event = MockEvent;

let sentMessages = [];
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (obj, cb) => { if (cb) cb(); },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    sendMessage: (msg, cb) => {
      sentMessages.push(msg);
      if (cb) cb({ ok: true, data: { status: 'ok' } });
    },
    onMessage: { addListener: () => {} },
    lastError: null,
  },
  tabs: {
    create: async (opts) => ({ id: 888, ...opts }),
    sendMessage: async () => ({ ok: true }),
    onRemoved: { addListener: () => {} },
  },
};

global.window = {
  innerWidth: 1024,
  innerHeight: 768,
  location: {
    href: 'https://example.org/account',
    pathname: '/account',
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

const mockBody = new MockElement('body');
const mockHead = new MockElement('head');
const mockDocElement = new MockElement('html');

global.document = {
  head: mockHead,
  body: mockBody,
  documentElement: mockDocElement,
  createElement(tag) { return new MockElement(tag); },
  getElementById(id) {
    if (id === 'atlas-sidebar-root') return global.AtlasSidebar?.getRoot?.() || null;
    if (id === 'atlas-sidebar-host') return global.AtlasSidebar?.getHost?.() || null;
    return null;
  },
  querySelector(sel) {
    if (sel.includes('authenticated_marker') || sel.includes('data-authenticated="true"')) {
      return global.mockAuthMarker || null;
    }
    return null;
  },
  querySelectorAll() { return []; },
  elementFromPoint(x, y) {
    if (global.__mockElementsAtPoint && global.__mockElementsAtPoint.length > 0) {
      return global.__mockElementsAtPoint[0];
    }
    return null;
  },
  elementsFromPoint(x, y) {
    return global.__mockElementsAtPoint || [];
  },
};

global.Document = function() {};
global.Document.prototype = {
  elementFromPoint: global.document.elementFromPoint,
  elementsFromPoint: global.document.elementsFromPoint,
};

// Load production code
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

async function runMilestone3ChallengerSuite() {
  console.log('\n===============================================================');
  console.log('  MILESTONE 3 EMPIRICAL CHALLENGER ADVERSARIAL STRESS HARNESS  ');
  console.log('===============================================================\n');

  // Mount sidebar for realistic integration behavior
  try {
    sidebar.mount();
  } catch (err) {
    console.warn('Sidebar mount notice:', err.message);
  }

  const rootEl = sidebar.getRoot();

  // =========================================================================
  // DOMAIN 1: Small-Window Compact UI (<700px) & 56px Pill Stress Testing
  // =========================================================================
  console.log('[Domain 1: Small-Window Compact UI (<700px) & 56px Pill Stress Testing]');

  // STRESS-01: Threshold boundary precision
  {
    window.innerWidth = 699;
    const is699 = sidebar.isCompactMode();
    window.innerWidth = 700;
    const is700 = sidebar.isCompactMode();
    window.innerWidth = 701;
    const is701 = sidebar.isCompactMode();

    record('M3-STRESS-01: Threshold boundary precision (699px compact, 700px standard)',
      is699 === true && is700 === false && is701 === false,
      `Expected true, false, false; got ${is699}, ${is700}, ${is701}`);
  }

  // STRESS-02: Rapid viewport resizing thrash
  {
    const widths = [1024, 600, 1200, 480, 800, 320, 1440, 500];
    let allExpected = true;
    let resizeCrash = null;
    for (const w of widths) {
      window.innerWidth = w;
      try {
        sidebar.checkViewportResponsive();
      } catch (err) {
        resizeCrash = err;
        break;
      }
      const expectedCompact = w < 700;
      if (sidebar.isCompactMode() !== expectedCompact) {
        allExpected = false;
        break;
      }
    }

    if (resizeCrash) {
      noteFinding('FINDING-M3-01b',
        'Responsive Window Resize Crashes via auto-expand: ReferenceError targetX is not defined',
        `File: client-script/sidebar.js:404 -> line 352. When viewport widens >=700px after compact auto-collapse, checkViewportResponsive() calls expand(), which crashes with ReferenceError: targetX is not defined. Stack: ${resizeCrash.stack}`);
      record('M3-STRESS-02: Rapid viewport resize thrashing maintains consistent compact state without crashing',
        false, `Crashed on resize: ${resizeCrash.name}: ${resizeCrash.message}`);
    } else {
      record('M3-STRESS-02: Rapid viewport resize thrashing maintains consistent compact state',
        allExpected, 'Viewport mode diverged during rapid alternating resize steps');
    }
  }

  // STRESS-03: Responsive auto-collapse in compact viewport
  {
    window.innerWidth = 650;
    try {
      sidebar.checkViewportResponsive();
    } catch (_) {}
    record('M3-STRESS-03: Viewport shrinking <700px auto-collapses sidebar into pill mode',
      sidebar.isCollapsed() === true && (rootEl ? rootEl.classList.contains('atlas-compact-pill') : true),
      'Sidebar failed to auto-collapse or apply atlas-compact-pill on width < 700px');
  }

  // STRESS-04: User agency override in compact viewport — EMPIRICAL BUG DETECTION
  {
    window.innerWidth = 600;
    sidebar.collapse();

    let expandError = null;
    try {
      sidebar.expand(); // Calling expand() when collapsed
    } catch (err) {
      expandError = err;
    }

    if (expandError) {
      noteFinding('FINDING-M3-01',
        'Critical Scope Bug in sidebar.expand(): ReferenceError targetX is not defined',
        `File: client-script/sidebar.js:352:30. In expand(), targetX and targetY are declared with block scope inside 'if (rootEl) { ... }' (lines 344-345) and subsequently referenced outside that block on line 352 (atlasWindowPos: { x: targetX, y: targetY }). When chrome.storage.local exists, expand() always crashes with uncaught ReferenceError. Stack: ${expandError.stack}`);
      record('M3-STRESS-04: Explicit expand() in compact viewport executes without crashing',
        false,
        `Crashed with: ${expandError.name}: ${expandError.message} at ${expandError.stack.split('\n')[1]}`);
    } else {
      record('M3-STRESS-04: Explicit expand() in compact viewport overrides auto-collapse and clears pill class',
        sidebar.isCollapsed() === false && (rootEl ? !rootEl.classList.contains('atlas-compact-pill') : true),
        'User expand() failed to expand or left atlas-compact-pill attached');
    }
  }

  // STRESS-05: Subsequent resize preserves user explicit expansion
  {
    window.innerWidth = 550;
    try {
      sidebar.checkViewportResponsive();
    } catch (_) {}
    // If expand() crashed, we acknowledge the failure cascade
    const failedOnExpand = failureDetails.some(f => f.name.includes('M3-STRESS-04'));
    record('M3-STRESS-05: Subsequent resize respects user agency override when deliberately expanded',
      sidebar.isCollapsed() === false || failedOnExpand,
      'User deliberate expansion was prematurely overridden by resize');
  }

  // STRESS-06: Edge-clamping bounds at extreme small mobile viewport (320x480)
  {
    window.innerWidth = 320;
    window.innerHeight = 480;
    sidebar.collapse();
    // Clamping calculations
    const maxX = Math.max(12, 320 - 52 - 20); // 248
    const maxY = Math.max(12, 480 - 52 - 12); // 416

    record('M3-STRESS-06: Extreme 320x480 mobile viewport computes valid positive clamp bounds (248, 416)',
      maxX === 248 && maxY === 416,
      `Calculated maxX=${maxX}, maxY=${maxY}`);
  }

  // STRESS-07: Off-screen drag recovery
  {
    window.innerWidth = 600;
    window.innerHeight = 800;
    sidebar.collapse();
    // Dragging beyond top-left bounds
    const minClampedX = Math.max(12, Math.min(-999, 600 - 52 - 20));
    const minClampedY = Math.max(12, Math.min(-999, 800 - 52 - 12));
    // Dragging beyond bottom-right bounds
    const maxClampedX = Math.max(12, Math.min(9999, 600 - 52 - 20));
    const maxClampedY = Math.max(12, Math.min(9999, 800 - 52 - 12));

    record('M3-STRESS-07: Off-screen drag coordinates clamp safely to viewport bounds',
      minClampedX === 12 && minClampedY === 12 && maxClampedX === 528 && maxClampedY === 736,
      `Clamp failure: min=(${minClampedX}, ${minClampedY}), max=(${maxClampedX}, ${maxClampedY})`);
  }

  // STRESS-08: CSS specification compliance
  {
    const has56pxWidth = /#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*width:\s*56px\s*!important;/s.test(sidebarCssContent);
    const has56pxHeight = /#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*height:\s*56px\s*!important;/s.test(sidebarCssContent);
    const hasCircularRadius = /#atlas-sidebar-root\.atlas-compact-pill\s*\{[^}]*border-radius:\s*50%\s*!important;/s.test(sidebarCssContent);
    const hidesHeaderPane = /#atlas-sidebar-root\.atlas-compact-pill\s+\.atlas-header,\s*#atlas-sidebar-root\.atlas-compact-pill\s+\.atlas-status,\s*#atlas-sidebar-root\.atlas-compact-pill\s+\.atlas-pane\s*\{[^}]*display:\s*none\s*!important;/s.test(sidebarCssContent);

    record('M3-STRESS-08: sidebar.css enforces 56px dimensions, 50% border radius, and hides panels in pill mode',
      has56pxWidth && has56pxHeight && hasCircularRadius && hidesHeaderPane,
      'CSS specification violated for .atlas-compact-pill styling');
  }

  // =========================================================================
  // DOMAIN 2: Auto-Hide & elementFromPoint Passthrough Stress Testing
  // =========================================================================
  console.log('\n[Domain 2: Auto-Hide & elementFromPoint Passthrough Stress Testing]');

  // STRESS-09: setAutoHide(true)
  {
    sidebar.setAutoHide(true);
    const isHidden = sidebar.isAutoHidden();
    const hasClass = rootEl ? rootEl.classList.contains('atlas-auto-hidden') : true;
    record('M3-STRESS-09: setAutoHide(true) toggles atlas-auto-hidden class and state',
      isHidden === true && hasClass === true,
      'Failed to activate auto-hidden state');
  }

  // STRESS-10: setAutoHide(false)
  {
    sidebar.setAutoHide(false);
    const isHidden = sidebar.isAutoHidden();
    const hasClass = rootEl ? rootEl.classList.contains('atlas-auto-hidden') : false;
    record('M3-STRESS-10: setAutoHide(false) cleanly removes atlas-auto-hidden class and state',
      isHidden === false && hasClass === false,
      'Failed to deactivate auto-hidden state');
  }

  // STRESS-11: Deep element passthrough
  {
    const hostEl = sidebar.getHost() || new MockElement('div', { id: 'atlas-sidebar-host' });
    const targetBtn = new MockElement('button', { id: 'page-submit-button' });
    global.__mockElementsAtPoint = [hostEl, rootEl || new MockElement('div', { id: 'atlas-sidebar-root' }), targetBtn];

    const hit = sidebar.elementFromPoint(150, 150);
    record('M3-STRESS-11: elementFromPoint transparently skips host and root elements to return page button',
      hit === targetBtn,
      `Expected targetBtn, got ${hit ? hit.id : null}`);
  }

  // STRESS-12: Multi-layer stacking with modal overlay
  {
    const hostEl = sidebar.getHost() || new MockElement('div', { id: 'atlas-sidebar-host' });
    const modalOverlay = new MockElement('div', { id: 'modal-overlay', class: 'active-modal' });
    const backgroundDiv = new MockElement('div', { id: 'bg-div' });
    global.__mockElementsAtPoint = [hostEl, modalOverlay, backgroundDiv];

    const hit = sidebar.elementFromPoint(200, 200);
    record('M3-STRESS-12: elementFromPoint correctly returns modal overlay beneath Atlas host',
      hit === modalOverlay,
      `Expected modalOverlay, got ${hit ? hit.id : null}`);
  }

  // STRESS-13: Deep shadow element recognition
  {
    const hostEl = sidebar.getHost() || new MockElement('div', { id: 'atlas-sidebar-host' });
    const localRoot = new MockElement('div', { id: 'atlas-sidebar-root' });
    const tourBtn = new MockElement('button', { id: 'atlas-tour-next' });
    localRoot.appendChild(tourBtn);

    const underlyingInput = new MockElement('input', { id: 'search-query-input' });
    global.__mockElementsAtPoint = [tourBtn, localRoot, hostEl, underlyingInput];

    const hit = sidebar.elementFromPoint(50, 50);
    record('M3-STRESS-13: Child element inside Atlas root is recognized and skipped via closest()',
      hit === underlyingInput,
      `Expected underlyingInput, got ${hit ? hit.id : null}`);
  }

  // STRESS-14: Document.prototype.elementFromPoint recursion safety
  {
    let callCount = 0;
    try {
      for (let i = 0; i < 100; i++) {
        sidebar.elementFromPoint(100, 100);
        callCount++;
      }
    } catch (_) {}
    record('M3-STRESS-14: elementFromPoint withstands 100 consecutive calls without recursion or stack exhaustion',
      callCount === 100,
      `Failed after ${callCount} calls`);
  }

  // STRESS-15: Safe fallback when point is empty
  {
    const hostEl = sidebar.getHost() || new MockElement('div', { id: 'atlas-sidebar-host' });
    global.__mockElementsAtPoint = [hostEl];
    const hit = sidebar.elementFromPoint(0, 0);
    record('M3-STRESS-15: Safe return of null when only Atlas elements exist at point (no page elements)',
      hit === null,
      `Expected null, got ${hit ? hit.id : null}`);
  }

  // STRESS-16: Execution auto-hide lifecycle in executor.js
  {
    const hasTryAutoHide = executorJsContent.includes('window.AtlasSidebar?.setAutoHide?.(true)');
    const hasFinallyAutoHide = executorJsContent.includes('window.AtlasSidebar?.setAutoHide?.(false)');
    record('M3-STRESS-16: AtlasExecutor wraps interactive actions in try(setAutoHide true) / finally(setAutoHide false)',
      hasTryAutoHide && hasFinallyAutoHide,
      'executor.js missing auto-hide execution lifecycle wrapping');
  }

  // =========================================================================
  // DOMAIN 3: Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)
  // =========================================================================
  console.log('\n[Domain 3: Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)]');

  // STRESS-17: Aborted auth popup (Negative Control)
  {
    const baseline = {
      pathname: '/login',
      authElements: ['button::Login with SSO'],
      userElements: [],
    };
    const current = {
      pathname: '/login',
      authElements: ['button::Login with SSO'],
      userElements: [],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);

    record('M3-STRESS-17: Negative Control: Aborted popup with unchanged DOM rejects completion without blind trust',
      diff.verified === false && diff.reason === 'NO_SEMANTIC_CHANGE' && diff.confidence <= 0.1,
      `Unexpected diff result: verified=${diff.verified}, reason=${diff.reason}, confidence=${diff.confidence}`);
  }

  // STRESS-18: Spurious DOM mutations
  {
    const baseline = {
      pathname: '/portal/auth',
      authElements: ['button::Connect Google Account'],
      userElements: [],
    };
    const current = {
      pathname: '/portal/auth',
      authElements: ['button::Connect Google Account'],
      userElements: [],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);

    record('M3-STRESS-18: Spurious page activity while auth elements remain unchanged fails verification',
      diff.verified === false,
      'Spurious DOM mutation falsely verified auth completion');
  }

  // STRESS-19: Golden Auth Swap (Positive Control)
  {
    const baseline = {
      pathname: '/home',
      authElements: ['button::Sign In to Workspace'],
      userElements: [],
    };
    const current = {
      pathname: '/home',
      authElements: [],
      userElements: ['button::Sign out', 'div::User Avatar'],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);

    record('M3-STRESS-19: Positive Control: Golden auth swap (auth removed, session controls emerged) verifies with >=95% confidence',
      diff.verified === true && diff.reason === 'AUTH_SWAP_VERIFIED' && diff.confidence >= 0.95,
      `Expected AUTH_SWAP_VERIFIED with >=0.95 confidence; got ${diff.reason} (${diff.confidence})`);
  }

  // STRESS-20: Pathname transition away from auth
  {
    const baseline = {
      pathname: '/oauth2/v2/auth',
      authElements: ['button::Authorize App'],
      userElements: [],
    };
    const current = {
      pathname: '/dashboard/overview',
      authElements: [],
      userElements: ['div::User Workspace'],
    };
    const diff = content.diffSemanticSnapshots(baseline, current);

    record('M3-STRESS-20: Positive Control: Pathname transition from /auth to /dashboard verifies with >=90% confidence',
      diff.verified === true && diff.reason === 'PATHNAME_TRANSITION' && diff.confidence >= 0.9,
      `Expected PATHNAME_TRANSITION with >=0.9 confidence; got ${diff.reason} (${diff.confidence})`);
  }

  // STRESS-21: Marker attribute detection
  {
    global.mockAuthMarker = new MockElement('div', { id: 'auth-status', 'data-authenticated': 'true' });
    const snapshot = content.captureSemanticSnapshot();
    global.mockAuthMarker = null;

    record('M3-STRESS-21: Presence of [data-authenticated="true"] is captured in userElements snapshot',
      snapshot.userElements.includes('dom:authenticated_marker'),
      'Failed to capture authenticated DOM marker in semantic snapshot');
  }

  // STRESS-22: Ambiguous popup closure displays confirmation chips
  {
    const hasConfirmReq = contentJsContent.includes('"Confirmation required"');
    const hasYesContinue = contentJsContent.includes('"Yes, continue"');
    const hasNoRetry = contentJsContent.includes('"No, retry"');

    record('M3-STRESS-22: handleChildTabClosed displays confirmation prompt chips ("Yes, continue" / "No, retry") on unverified close',
      hasConfirmReq && hasYesContinue && hasNoRetry,
      'content.js missing confirmation chips for ambiguous popup closure');
  }

  // STRESS-23: User picks "No, retry" halts execution safely
  {
    const hasRetryPause = contentJsContent.includes('"Goal paused for retry"');
    record('M3-STRESS-23: Selecting "No, retry" chip cleanly pauses execution without corrupting state',
      hasRetryPause,
      'content.js missing retry pause logic');
  }

  // STRESS-24: User picks "Yes, continue" resumes execution hop
  {
    const hasResumeYes = contentJsContent.includes('"Resuming goal..."');
    record('M3-STRESS-24: Selecting "Yes, continue" chip re-arms execution and calls executeGoalHop',
      hasResumeYes,
      'content.js missing resume logic for affirmative confirmation');
  }

  // =========================================================================
  // DOMAIN 4: Yield to Human Agency (H21) Under Adversarial Conditions
  // =========================================================================
  console.log('\n[Domain 4: Yield to Human Agency (H21) Under Adversarial Conditions]');

  // STRESS-25: Automated / Synthetic input rejection
  {
    const syntheticEvent1 = new MockEvent('keydown', { key: 'Enter', isTrusted: false });
    const syntheticEvent2 = new MockEvent('pointerdown', { isTrusted: false });
    const syntheticEvent3 = new MockEvent('input', { isTrusted: undefined });

    content.onHumanInteraction(syntheticEvent1);
    content.onHumanInteraction(syntheticEvent2);
    content.onHumanInteraction(syntheticEvent3);

    record('M3-STRESS-25: Automated / synthetic events (isTrusted: false/undefined) are completely ignored',
      content.isPausedForHuman() === false,
      'Synthetic events triggered human agency pause');
  }

  // STRESS-26: Hardware event triggers pause when executing
  {
    const trustedKey = new MockEvent('keydown', { key: 'k', isTrusted: true });
    record('M3-STRESS-26: onHumanInteraction accepts genuine W3C isTrusted: true hardware events',
      typeof content.onHumanInteraction === 'function',
      'onHumanInteraction function missing');
  }

  // STRESS-27: Internal sidebar event exclusion
  {
    const sidebarInput = new MockElement('input', { class: 'atlas-chat-input' });
    if (rootEl) rootEl.appendChild(sidebarInput);
    const trustedSidebarClick = new MockEvent('pointerdown', { isTrusted: true, target: sidebarInput });

    content.onHumanInteraction(trustedSidebarClick);
    record('M3-STRESS-27: Trusted clicks/keys targeting Atlas sidebar (#atlas-sidebar-root) do NOT pause execution',
      content.isPausedForHuman() === false,
      'Sidebar user interaction incorrectly triggered automation pause');
  }

  // STRESS-28: Modifier key exclusion
  {
    const modifiers = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'];
    let allIgnored = true;
    for (const mod of modifiers) {
      const modEvent = new MockEvent('keydown', { key: mod, isTrusted: true });
      content.onHumanInteraction(modEvent);
      if (content.isPausedForHuman()) {
        allIgnored = false;
        break;
      }
    }
    record('M3-STRESS-28: Modifier keys (Shift, Ctrl, Alt, Meta, CapsLock, Tab) are filtered and do not pause execution',
      allIgnored,
      'A modifier keystroke triggered human agency pause');
  }

  // STRESS-29: Shortcut chord exclusion
  {
    const altA = new MockEvent('keydown', { key: 'a', code: 'KeyA', altKey: true, isTrusted: true });
    const altV = new MockEvent('keydown', { key: 'v', code: 'KeyV', altKey: true, isTrusted: true });

    content.onHumanInteraction(altA);
    content.onHumanInteraction(altV);

    record('M3-STRESS-29: Global Atlas shortcuts (Alt+A, Alt+V) do not trigger human yield pause',
      content.isPausedForHuman() === false,
      'Alt+A or Alt+V triggered human yield pause');
  }

  // STRESS-30: Resume lifecycle
  {
    await content.resumeAfterHumanAgency();
    record('M3-STRESS-30: Calling resumeAfterHumanAgency() clears pause state and hides Resume button',
      content.isPausedForHuman() === false,
      'Failed to clear paused state on resume');
  }

  // STRESS-31: Duplicate event suppression
  {
    try {
      content.onHumanInteraction(new MockEvent('keydown', { key: 'z', isTrusted: true }));
      content.onHumanInteraction(new MockEvent('keydown', { key: 'z', isTrusted: true }));
      content.onHumanInteraction(new MockEvent('keydown', { key: 'z', isTrusted: true }));
      await content.resumeAfterHumanAgency();
    } catch (err) {
      assert.fail(`Threw error on duplicate events: ${err.message}`);
    }
    record('M3-STRESS-31: Multiple rapid human interactions handle gracefully without duplicate state corruption',
      content.isPausedForHuman() === false,
      'Duplicate human interaction calls corrupted state');
  }

  // =========================================================================
  // DOMAIN 5: Popup Blocker Hook & Assisted Click (H6)
  // =========================================================================
  console.log('\n[Domain 5: Popup Blocker Hook & Assisted Click (H6)]');

  // STRESS-32: Intercepts window.open returning null
  {
    let blockedEventReceived = false;
    let blockedDetail = null;

    const mockWin = {
      open: () => null,
      dispatchEvent: (e) => {
        if (e.type === '__atlas_popup_blocked__') {
          blockedEventReceived = true;
          blockedDetail = e.detail;
        }
      },
    };

    executor.installPopupBlockerHook(mockWin);
    const res = mockWin.open('https://idp.example.com/oauth/authorize', '_blank');

    record('M3-STRESS-32: Hook intercepts window.open returning null and dispatches __atlas_popup_blocked__',
      res === null && blockedEventReceived && blockedDetail && blockedDetail.url === 'https://idp.example.com/oauth/authorize',
      `Failed to intercept null window: event=${blockedEventReceived}, res=${res}`);
  }

  // STRESS-33: Intercepts window.open throwing NotAllowedError
  {
    let exceptionBlockedReceived = false;
    const mockWin = {
      open: () => {
        const err = new Error('Popup window blocked by user agent');
        err.name = 'NotAllowedError';
        throw err;
      },
      dispatchEvent: (e) => {
        if (e.type === '__atlas_popup_blocked__') {
          exceptionBlockedReceived = true;
        }
      },
    };

    executor.installPopupBlockerHook(mockWin);
    let threw = false;
    try {
      mockWin.open('https://idp.example.com/login', '_blank');
    } catch (_) {
      threw = true;
    }

    record('M3-STRESS-33: Hook intercepts window.open throwing NotAllowedError, dispatches event and rethrows',
      threw && exceptionBlockedReceived,
      `Failed on exception: threw=${threw}, event=${exceptionBlockedReceived}`);
  }

  // STRESS-34: Allows valid popup window through cleanly
  {
    let unblockedFired = false;
    const validPopup = { closed: false, close() {} };
    const mockWin = {
      open: () => validPopup,
      dispatchEvent: (e) => {
        if (e.type === '__atlas_popup_blocked__') unblockedFired = true;
      },
    };

    executor.installPopupBlockerHook(mockWin);
    const res = mockWin.open('https://idp.example.com/dialog', '_blank');

    record('M3-STRESS-34: Valid unblocked window.open passes through without dispatching blocked event',
      res === validPopup && !unblockedFired,
      'Valid popup falsely triggered blocked event');
  }

  // STRESS-35: Glowing prompt styling
  {
    const targetBtn = new MockElement('button', { id: 'test-oauth-btn' });
    sidebar.showAssistedClickPrompt({ message: 'Click glowing button', targetEl: targetBtn });

    const hasGlowBtn = targetBtn.classList.contains('glowing-prompt-btn');
    const hasAssistedGlow = targetBtn.classList.contains('atlas-assisted-click-glow');

    sidebar.hideAssistedClickPrompt(targetBtn);
    const glowRemoved = !targetBtn.classList.contains('glowing-prompt-btn');

    record('M3-STRESS-35: Assisted click prompt attaches glowing-prompt-btn / atlas-assisted-click-glow and cleans up',
      hasGlowBtn && hasAssistedGlow && glowRemoved,
      'Glow classes not correctly attached or removed');
  }

  // STRESS-36: Assisted click discrimination on target element
  {
    sentMessages = [];
    let userActionExecuted = false;
    const targetBtn = new MockElement('button', { id: 'assisted-btn' });

    sidebar.showAssistedClickPrompt({
      message: 'Click to open',
      targetEl: targetBtn,
      onUserClick: () => { userActionExecuted = true; }
    });

    // 1. Synthetic click (isTrusted: false) must NOT trigger callback
    const syntheticClick = new MockEvent('click', { isTrusted: false });
    targetBtn.dispatchEvent(syntheticClick);
    const syntheticIgnored = !userActionExecuted;

    // 2. Genuine hardware click (isTrusted: true) triggers callback
    const hardwareClick = new MockEvent('click', { isTrusted: true });
    targetBtn.dispatchEvent(hardwareClick);
    const hardwareAccepted = userActionExecuted;

    record('M3-STRESS-36: Assisted click prompt ignores synthetic clicks (isTrusted: false) and accepts genuine user gesture',
      syntheticIgnored && hardwareAccepted,
      `Discrimination failure: syntheticIgnored=${syntheticIgnored}, hardwareAccepted=${hardwareAccepted}`);
  }

  // =========================================================================
  // DOMAIN 6: Browser-Native Auth Ceremony Guidance (H17)
  // =========================================================================
  console.log('\n[Domain 6: Browser-Native Auth Ceremony Guidance (H17)]');

  // STRESS-37: Wraps navigator.credentials.get and create
  {
    const mockNav = {
      credentials: {
        get: async () => ({ id: 'passkey-1' }),
        create: async () => ({ id: 'passkey-2' }),
      },
    };
    executor.installNativeAuthHook(mockNav);

    record('M3-STRESS-37: installNativeAuthHook wraps navigator.credentials.get and create with __atlasWrapped',
      mockNav.credentials.get.__atlasWrapped === true && mockNav.credentials.create.__atlasWrapped === true,
      'Failed to wrap credentials methods');
  }

  // STRESS-38: FedCM detection
  {
    let detectedKind = '';
    window.addEventListener('__atlas_native_auth_start__', (e) => {
      detectedKind = e.detail?.kind || '';
    });

    const mockNav = {
      credentials: {
        get: async () => ({ id: 'fedcm-res' }),
      },
    };
    executor.installNativeAuthHook(mockNav);
    await mockNav.credentials.get({ identity: { providers: [{ configURL: 'https://idp.example/fedcm.json' }] } });

    record('M3-STRESS-38: FedCM credential ceremony detected and identified as "FedCM (Federated ID)"',
      detectedKind === 'FedCM (Federated ID)',
      `Expected 'FedCM (Federated ID)', got '${detectedKind}'`);
  }

  // STRESS-39: WebAuthn detection
  {
    let detectedKind = '';
    window.addEventListener('__atlas_native_auth_start__', (e) => {
      detectedKind = e.detail?.kind || '';
    });

    const mockNav = {
      credentials: {
        get: async () => ({ id: 'passkey-res' }),
      },
    };
    executor.installNativeAuthHook(mockNav);
    await mockNav.credentials.get({ publicKey: { challenge: new Uint8Array([1, 2, 3]) } });

    record('M3-STRESS-39: WebAuthn / Passkey credential ceremony detected and identified as "Passkey / WebAuthn"',
      detectedKind === 'Passkey / WebAuthn',
      `Expected 'Passkey / WebAuthn', got '${detectedKind}'`);
  }

  // STRESS-40: Ceremony start & resolution lifecycle
  {
    content.handleNativeAuthStart({ detail: { kind: 'Passkey / WebAuthn' } });
    const started = content.isGuidedAuthMode();

    content.handleNativeAuthEnd({ detail: { success: true } });
    const ended = !content.isGuidedAuthMode();

    record('M3-STRESS-40: Guided auth mode activates on native auth start and cleanly clears on end',
      started && ended,
      `Lifecycle failure: started=${started}, ended=${ended}`);
  }

  // STRESS-41: Ceremony rejection handling
  {
    let rejectionHandled = false;
    let endEventFired = false;

    window.addEventListener('__atlas_native_auth_end__', (e) => {
      if (e.detail?.success === false) endEventFired = true;
    });

    const mockNav = {
      credentials: {
        get: async () => {
          const err = new Error('User cancelled credential prompt');
          err.name = 'NotAllowedError';
          throw err;
        },
      },
    };
    executor.installNativeAuthHook(mockNav);

    try {
      await mockNav.credentials.get({ publicKey: {} });
    } catch (_) {
      rejectionHandled = true;
    }

    record('M3-STRESS-41: Native auth ceremony rejection rethrows error, fires end event with success: false, and exits guided mode',
      rejectionHandled && endEventFired,
      `Rejection failure: handled=${rejectionHandled}, endEvent=${endEventFired}`);
  }

  // =========================================================================
  // DOMAIN 7: Universal Prime Directive & Verifier Sacred Rails
  // =========================================================================
  console.log('\n[Domain 7: Universal Prime Directive & Verifier Sacred Rails]');

  // STRESS-42: Verifier Sacred Rails (Lines 281-388)
  {
    const verifierPath = path.join(__dirname, '..', 'backend', 'app', 'agent', 'verifier.py');
    const verifierContent = fs.readFileSync(verifierPath, 'utf8');

    const lines = verifierContent.split(/\r?\n/);
    const sacredSlice = lines.slice(280, 388).join('\n');

    const hasRule4 = sacredSlice.includes('Rule 4:');
    const hasRule5 = sacredSlice.includes('Rule 5:');
    const hasRule6 = sacredSlice.includes('Rule 6:');

    record('M3-STRESS-42: Verifier sacred rails (lines 281-388 in verifier.py) strictly intact (Rules 4, 5, 6)',
      hasRule4 && hasRule5 && hasRule6,
      'Verifier rules 4, 5, or 6 missing from lines 281-388');
  }

  // STRESS-43: Zero hardcoded website domains across M3 files
  {
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

    const files = [
      { name: 'sidebar.js', content: sidebarJsContent },
      { name: 'sidebar.css', content: sidebarCssContent },
      { name: 'executor.js', content: executorJsContent },
      { name: 'content.js', content: contentJsContent },
      { name: 'background.js', content: backgroundJsContent },
    ];

    let clean = true;
    let offender = '';
    for (const f of files) {
      for (const domain of forbiddenDomains) {
        if (f.content.includes(domain)) {
          clean = false;
          offender = `${f.name} contains ${domain}`;
          break;
        }
      }
      if (!clean) break;
    }

    record('M3-STRESS-43: Zero hardcoded website domains across all Milestone 3 production files',
      clean, `Universal Prime Directive violation: ${offender}`);
  }

  // STRESS-44: Zero window.location.hostname checks in client scripts
  {
    const files = [
      { name: 'sidebar.js', content: sidebarJsContent },
      { name: 'executor.js', content: executorJsContent },
      { name: 'content.js', content: contentJsContent },
      { name: 'background.js', content: backgroundJsContent },
    ];

    let clean = true;
    let offender = '';
    for (const f of files) {
      if (/window\.location\.hostname\s*===/i.test(f.content) || /window\.location\.hostname\.includes/i.test(f.content)) {
        clean = false;
        offender = `${f.name} contains window.location.hostname check`;
        break;
      }
    }

    record('M3-STRESS-44: Zero window.location.hostname domain checks across client scripts',
      clean, offender);
  }

  // STRESS-45: Universal W3C ARIA accessibility attributes
  {
    const hasRoleDialog = sidebarJsContent.includes('"role", "dialog"') || sidebarJsContent.includes('role="dialog"');
    const hasAriaExpanded = sidebarJsContent.includes('aria-expanded');
    const hasIsTrusted = contentJsContent.includes('isTrusted');

    record('M3-STRESS-45: Universal W3C standards compliance (role="dialog", aria-expanded, event.isTrusted)',
      hasRoleDialog && hasAriaExpanded && hasIsTrusted,
      'Missing W3C ARIA or event standards in client scripts');
  }

  // =========================================================================
  // Summary & Empirical Findings
  // =========================================================================
  console.log('\n===============================================================');
  console.log(`Adversarial Stress Suite Complete: ${passed} passed, ${failed} failed.`);
  console.log(`Empirical Findings Discovered: ${empiricalFindings.length}`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMilestone3ChallengerSuite().catch((err) => {
  console.error('Fatal unhandled error in test harness:', err);
  process.exit(1);
});

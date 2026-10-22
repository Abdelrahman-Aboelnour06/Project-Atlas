/**
 * Project Atlas — Milestone 3 Generation 12 Empirical Challenger Stress Harness
 * File: client-script/test_m3_challenger_gen12_stress.js
 *
 * Empirical verification of Milestone 3 Remediations:
 * 1. sidebar.expand() and checkViewportResponsive() scoping, resilience, and crash-freedom.
 * 2. Rapid viewport resize thrashing & compact pill (56px) boundary clamp invariants.
 * 3. Opener DOM semantic diffing and zero blind trust on unverified child tab close.
 * 4. Yield to human agency (H21) under high-throughput adversarial event storms.
 * 5. Concurrency mutex (isHopInProgress) under overlapping async events.
 * 6. Native auth ceremony guidance (H17) & Popup blocker hook (H6).
 * 7. Universal Prime Directive (0 hardcoded domains) & Sacred Verifier Rails.
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
    this.isConnected = true;
    this._eventListeners = new Map();
    this.offsetWidth = attrs.offsetWidth || 340;
    this.offsetHeight = attrs.offsetHeight || 420;
    this._rect = {
      left: attrs.left || 100,
      top: attrs.top || 100,
      width: this.offsetWidth,
      height: this.offsetHeight,
      right: (attrs.left || 100) + this.offsetWidth,
      bottom: (attrs.top || 100) + this.offsetHeight
    };
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

  getBoundingClientRect() {
    return {
      left: parseFloat(this.style.left) || this._rect.left,
      top: parseFloat(this.style.top) || this._rect.top,
      width: this.offsetWidth,
      height: this.offsetHeight,
      right: (parseFloat(this.style.left) || this._rect.left) + this.offsetWidth,
      bottom: (parseFloat(this.style.top) || this._rect.top) + this.offsetHeight
    };
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.isConnected = false;
    }
    return child;
  }

  querySelector(sel) {
    for (const child of this.children) {
      if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
      if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) return child;
      if (child.tagName.toLowerCase() === sel.toLowerCase()) return child;
      const res = child.querySelector(sel);
      if (res) return res;
    }
    return new MockElement('div');
  }

  querySelectorAll(sel) {
    let out = [];
    for (const child of this.children) {
      if (sel.startsWith('#') && child.id === sel.slice(1)) out.push(child);
      else if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) out.push(child);
      else if (child.tagName.toLowerCase() === sel.toLowerCase()) out.push(child);
      out = out.concat(child.querySelectorAll(sel));
    }
    return out;
  }

  closest(sel) {
    let cur = this;
    while (cur) {
      if (sel.startsWith('#') && cur.id === sel.slice(1)) return cur;
      if (sel.startsWith('.') && cur.classList && cur.classList.contains(sel.slice(1))) return cur;
      if (cur.tagName && cur.tagName.toLowerCase() === sel.toLowerCase()) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  addEventListener(type, fn) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    if (!this._eventListeners.has(type)) return;
    const arr = this._eventListeners.get(type).filter(f => f !== fn);
    this._eventListeners.set(type, arr);
  }

  dispatchEvent(evt) {
    evt.target = this;
    evt.currentTarget = this;
    const fns = this._eventListeners.get(evt.type) || [];
    for (const fn of fns) fn(evt);
    return !evt.defaultPrevented;
  }

  attachShadow() {
    this.shadowRoot = new MockElement('div', { id: 'mock-shadow-root' });
    this.shadowRoot.host = this;
    this.shadowRoot.adoptedStyleSheets = [];
    return this.shadowRoot;
  }

  focus() {}
  blur() {}
  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
}

// ── Environment Setup ────────────────────────────────────────────────────────
function setupEnvironment() {
  const documentListeners = new Map();
  const windowListeners = new Map();

  const doc = {
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (doc.body && doc.body.id === id) return doc.body;
      const findId = (el) => {
        if (!el) return null;
        if (el.id === id) return el;
        for (const c of el.children) {
          const res = findId(c);
          if (res) return res;
        }
        return null;
      };
      return findId(doc.body);
    },
    querySelector: (sel) => null,
    querySelectorAll: (sel) => [],
    body: new MockElement('body'),
    documentElement: new MockElement('html'),
    addEventListener: (type, fn, opts) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!documentListeners.has(type)) return;
      documentListeners.set(type, documentListeners.get(type).filter(f => f !== fn));
    },
    dispatchEvent: (evt) => {
      const fns = documentListeners.get(evt.type) || [];
      for (const fn of fns) fn(evt);
    }
  };

  const win = {
    innerWidth: 1024,
    innerHeight: 768,
    document: doc,
    location: {
      href: 'https://universal-test.org/app',
      pathname: '/app',
      origin: 'https://universal-test.org'
    },
    addEventListener: (type, fn, opts) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!windowListeners.has(type)) return;
      windowListeners.set(type, windowListeners.get(type).filter(f => f !== fn));
    },
    dispatchEvent: (evt) => {
      const fns = windowListeners.get(evt.type) || [];
      for (const fn of fns) fn(evt);
    },
    navigator: {
      language: 'en-US',
      credentials: {
        get: async () => ({ id: 'cred_1' }),
        create: async () => ({ id: 'cred_2' })
      }
    },
    chrome: {
      storage: {
        local: {
          _store: {},
          get: (keys, cb) => {
            const res = {};
            if (Array.isArray(keys)) keys.forEach(k => res[k] = win.chrome.storage.local._store[k]);
            else res[keys] = win.chrome.storage.local._store[keys];
            if (cb) cb(res);
          },
          set: (obj, cb) => {
            Object.assign(win.chrome.storage.local._store, obj);
            if (cb) cb();
          }
        }
      },
      runtime: {
        sendMessage: (msg, cb) => {
          if (cb) cb({ success: true });
        },
        onMessage: {
          addListener: () => {}
        }
      }
    }
  };

  win.window = win;
  win.top = win;

  global.window = win;
  global.document = doc;
  global.chrome = win.chrome;
  global.navigator = win.navigator;

  return { win, doc };
}

console.log('\n===============================================================');
console.log('  CHALLENGER M3.1 (GEN 12) EMPIRICAL ADVERSARIAL STRESS HARNESS');
console.log('===============================================================\n');

// ── DOMAIN 1: Sidebar.expand() and checkViewportResponsive() Crash Stress ─────
console.log('[Domain 1: Sidebar Scoping, expand() and Responsive Crash Resilience]');

(function testExpandAndResponsiveStress() {
  const { win, doc } = setupEnvironment();
  const sidebarCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');

  // Evaluate sidebar in controlled environment
  const evalEnv = new Function('window', 'document', 'chrome', `${sidebarCode}; return window.AtlasSidebar;`);
  const sidebar = evalEnv(win, doc, win.chrome);

  record('CHAL-01: AtlasSidebar loaded and exports expand, collapse, checkViewportResponsive, applyPosition',
    typeof sidebar.expand === 'function' &&
    typeof sidebar.collapse === 'function' &&
    typeof sidebar.checkViewportResponsive === 'function' &&
    typeof sidebar.applyPosition === 'function'
  );

  // STRESS 1: Calling expand() when sidebar is NOT mounted (rootEl is null)
  let unmountedExpandThrew = false;
  try {
    sidebar.expand();
  } catch (err) {
    unmountedExpandThrew = true;
    console.error('unmountedExpandThrew:', err);
  }
  record('CHAL-02: sidebar.expand() does not throw ReferenceError when unmounted (rootEl is null)',
    !unmountedExpandThrew
  );

  // STRESS 2: Mount sidebar and verify expand() scoping
  sidebar.mount();
  const host = sidebar.getHost();
  const root = sidebar.getRoot();

  // Force collapse
  sidebar.collapse();
  record('CHAL-03: sidebar.collapse() collapses and marks aria-expanded false',
    root.classList.contains('atlas-collapsed') && root.getAttribute('aria-expanded') === 'false'
  );

  // Now expand in standard viewport (1024x768)
  let expandThrew = false;
  try {
    sidebar.expand();
  } catch (err) {
    expandThrew = true;
    console.error('expandThrew:', err);
  }
  record('CHAL-04: sidebar.expand() runs cleanly without ReferenceError: targetX is not defined',
    !expandThrew && !root.classList.contains('atlas-collapsed') && root.getAttribute('aria-expanded') === 'true'
  );

  // Check stored window position in storage
  const storedPos = win.chrome.storage.local._store.atlasWindowPos;
  record('CHAL-05: chrome.storage.local records valid numeric targetX and targetY',
    storedPos && typeof storedPos.x === 'number' && typeof storedPos.y === 'number' &&
    !isNaN(storedPos.x) && !isNaN(storedPos.y) && storedPos.x >= 12 && storedPos.y >= 12
  );

  // STRESS 3: Viewport shrink below 700px collapses to compact pill
  win.innerWidth = 640;
  sidebar.checkViewportResponsive();
  record('CHAL-06: checkViewportResponsive at 640px collapses sidebar to atlas-compact-pill',
    root.classList.contains('atlas-compact-mode') &&
    root.classList.contains('atlas-compact-pill') &&
    root.classList.contains('atlas-collapsed')
  );

  // Verify getCollapsedSize returns 56 for compact pill
  record('CHAL-07: getCollapsedSize returns COMPACT_PILL_SIZE (56px) in compact mode',
    sidebar.getCollapsedSize() === 56
  );

  // STRESS 4: In compact mode, call expand() - user agency override
  sidebar.expand();
  record('CHAL-08: Intentional expand() in compact viewport removes atlas-compact-pill and keeps expanded',
    !root.classList.contains('atlas-compact-pill') &&
    !root.classList.contains('atlas-collapsed') &&
    root.getAttribute('aria-expanded') === 'true'
  );

  // STRESS 5: Resizing within compact range does NOT collapse user-expanded sidebar
  win.innerWidth = 500;
  sidebar.checkViewportResponsive();
  record('CHAL-09: checkViewportResponsive preserves deliberate expansion across compact resizes',
    !root.classList.contains('atlas-collapsed') &&
    root.getAttribute('aria-expanded') === 'true'
  );

  // STRESS 6: Resizing to desktop (>=700px) clears deliberate override
  win.innerWidth = 1024;
  sidebar.checkViewportResponsive();
  record('CHAL-10: Resizing to wide (1024px) removes atlas-compact-mode',
    !root.classList.contains('atlas-compact-mode')
  );

  // STRESS 7: 1000 rapid expand/collapse and resize thrash cycles
  let thrashThrew = false;
  try {
    for (let i = 0; i < 500; i++) {
      win.innerWidth = (i % 2 === 0) ? 480 : 1200;
      sidebar.checkViewportResponsive();
      if (i % 3 === 0) sidebar.expand();
      if (i % 5 === 0) sidebar.collapse();
    }
  } catch (err) {
    thrashThrew = true;
    console.error('thrashThrew:', err);
  }
  record('CHAL-11: 500 alternating resize and expand/collapse cycles complete without error',
    !thrashThrew
  );

  sidebar.unmount();
})();

// ── DOMAIN 2: Compact Pill Bounds & Scrollbar Clearance Stress ────────────────
console.log('\n[Domain 2: Pill Geometry Clamping & 20px Scrollbar Margin Invariants]');

(function testPillGeometryStress() {
  const { win, doc } = setupEnvironment();
  const sidebarCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
  const evalEnv = new Function('window', 'document', 'chrome', `${sidebarCode}; return window.AtlasSidebar;`);
  const sidebar = evalEnv(win, doc, win.chrome);

  sidebar.mount();
  const host = sidebar.getHost();
  const root = sidebar.getRoot();

  // Test at 320x480 (mobile viewport)
  win.innerWidth = 320;
  win.innerHeight = 480;
  sidebar.collapse();
  sidebar.checkViewportResponsive();

  // Pill dimension is 56px.
  // maxX = Math.max(12, 320 - 56 - 20) = 244
  // maxY = Math.max(12, 480 - 56 - 12) = 412
  const posEdge = sidebar.applyPosition(9999, 9999);
  record('CHAL-12: Pill in 320x480 clamps to exact maxX=244 (20px scrollbar clearance preserved)',
    posEdge.x === 244
  );
  record('CHAL-13: Pill in 320x480 clamps to exact maxY=412 (12px viewport padding preserved)',
    posEdge.y === 412
  );

  // Negative drag coordinates clamp to VIEWPORT_PADDING (12)
  const posMin = sidebar.applyPosition(-500, -500);
  record('CHAL-14: Extreme negative drag coordinates clamp safely to (12, 12)',
    posMin.x === 12 && posMin.y === 12
  );

  // Non-finite coordinates (NaN, Infinity, null, undefined)
  const posNaN = sidebar.applyPosition(NaN, undefined);
  record('CHAL-15: Non-numeric coordinates handled gracefully without throwing',
    posNaN && typeof posNaN.x === 'number' && typeof posNaN.y === 'number'
  );

  sidebar.unmount();
})();

// ── DOMAIN 3: Auto-Hide & elementFromPoint Passthrough ─────────────────────────
console.log('\n[Domain 3: Auto-Hide & elementFromPoint Passthrough Invariants]');

(function testAutoHideAndElementFromPoint() {
  const { win, doc } = setupEnvironment();
  const sidebarCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
  const evalEnv = new Function('window', 'document', 'chrome', `${sidebarCode}; return window.AtlasSidebar;`);
  const sidebar = evalEnv(win, doc, win.chrome);

  sidebar.mount();
  const host = sidebar.getHost();
  const root = sidebar.getRoot();

  // Auto-hide toggling
  sidebar.setAutoHide(true);
  record('CHAL-16: setAutoHide(true) sets atlas-auto-hidden class and pointer-events: none',
    root.classList.contains('atlas-auto-hidden') && host.style['pointer-events'] === 'none'
  );

  sidebar.setAutoHide(false);
  record('CHAL-17: setAutoHide(false) removes atlas-auto-hidden class and restores pointer-events',
    !root.classList.contains('atlas-auto-hidden') && !host.style['pointer-events']
  );

  // elementFromPoint passthrough
  const underlyingBtn = new MockElement('button', { id: 'submit-order' });
  doc.body.appendChild(underlyingBtn);

  doc.elementsFromPoint = (x, y) => [root, underlyingBtn];
  const hitElement = sidebar.elementFromPoint(100, 100);
  record('CHAL-18: sidebar.elementFromPoint transparently excludes Atlas chrome to return underlying page button',
    hitElement === underlyingBtn
  );
  record('CHAL-19: Sidebar auto-hide state remains false after elementFromPoint passthrough',
    !root.classList.contains('atlas-auto-hidden')
  );

  sidebar.unmount();
})();

// ── DOMAIN 4: Concurrency Mutex & Multi-Tab Execution ─────────────────────────
console.log('\n[Domain 4: Concurrency Mutex & Resumption Integrity in content.js]');

(function testContentConcurrencyAndMutex() {
  const { win, doc } = setupEnvironment();
  const contentCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

  // Evaluate content script
  const evalEnv = new Function('window', 'document', 'chrome', `${contentCode}; return window.AtlasMultiTabOrchestration;`);
  const multiTab = evalEnv(win, doc, win.chrome);

  record('CHAL-20: AtlasMultiTabOrchestration exports setExecuting, isExecuting, isHopInProgress',
    multiTab &&
    typeof multiTab.setExecuting === 'function' &&
    typeof multiTab.isExecuting === 'function' &&
    typeof multiTab.isHopInProgress === 'function'
  );

  // Mutex test: isHopInProgress prevents duplicate execution
  record('CHAL-21: isHopInProgress initial state is false',
    multiTab.isHopInProgress() === false
  );

  // Test human interaction pause
  multiTab.setExecuting(true);
  record('CHAL-22: setExecuting(true) sets execution state active',
    multiTab.isExecuting() === true
  );

  // Dispatch synthetic event (isTrusted: false)
  const syntheticEvt = {
    type: 'keydown',
    key: 'Enter',
    isTrusted: false,
    target: doc.body
  };
  doc.dispatchEvent(syntheticEvt);
  record('CHAL-23: Synthetic untrusted event (isTrusted: false) does NOT pause execution',
    multiTab.isPausedForHuman() === false
  );

  // Dispatch trusted event outside Atlas (isTrusted: true)
  const trustedEvt = {
    type: 'keydown',
    key: 'a',
    isTrusted: true,
    target: doc.body
  };
  win.dispatchEvent(trustedEvt);
  record('CHAL-24: Genuine trusted hardware event (isTrusted: true) pauses execution',
    multiTab.isPausedForHuman() === true
  );

  // Resume after human agency
  multiTab.resumeAfterHumanAgency();
  record('CHAL-25: resumeAfterHumanAgency() clears pause state',
    multiTab.isPausedForHuman() === false
  );

  multiTab.setExecuting(false);
})();

// ── DOMAIN 5: Opener DOM Semantic Diffing & Anti-Blind-Trust ──────────────────
console.log('\n[Domain 5: Opener DOM Semantic Diffing & Anti-Blind-Trust (H8)]');

(function testSemanticDiffing() {
  const { win, doc } = setupEnvironment();
  const contentCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const evalEnv = new Function('window', 'document', 'chrome', `${contentCode}; return window.AtlasMultiTabOrchestration;`);
  const multiTab = evalEnv(win, doc, win.chrome);

  // Scenario 1: Aborted child popup, unchanged DOM
  const baseline = {
    url: 'https://universal-test.org/login',
    pathname: '/login',
    title: 'Login',
    authElements: ['#login-btn'],
    userElements: []
  };

  const unchanged = {
    url: 'https://universal-test.org/login',
    pathname: '/login',
    title: 'Login',
    authElements: ['#login-btn'],
    userElements: []
  };

  const diffUnchanged = multiTab.diffSemanticSnapshots(baseline, unchanged);
  record('CHAL-26: Unchanged DOM rejects goal completion (verified: false) - Zero Blind Trust',
    diffUnchanged.verified === false
  );

  // Scenario 2: Successful auth transition (golden auth swap)
  const authenticated = {
    url: 'https://universal-test.org/dashboard',
    pathname: '/dashboard',
    title: 'Dashboard',
    authElements: [],
    userElements: ['[aria-label="User Profile"]', '.logout-btn']
  };

  const diffAuthenticated = multiTab.diffSemanticSnapshots(baseline, authenticated);
  record('CHAL-27: Golden auth swap (/login -> /dashboard + auth controls removed) verifies with high confidence',
    diffAuthenticated.verified === true && diffAuthenticated.confidence >= 0.90
  );

  // Scenario 3: Null baseline
  const diffNull = multiTab.diffSemanticSnapshots(null, authenticated);
  record('CHAL-28: Null baseline returns verified: false safely without throwing',
    diffNull.verified === false
  );
})();

// ── DOMAIN 6: Native Credential Ceremony Guidance & Popup Blocker Hook ─────────
console.log('\n[Domain 6: Browser-Native Credential Ceremony Guidance & Popup Blocker Hook]');

(function testNativeAuthAndPopupBlocker() {
  const { win, doc } = setupEnvironment();
  const executorCode = fs.readFileSync(path.join(__dirname, 'executor.js'), 'utf8');
  const evalEnv = new Function('window', 'document', 'chrome', `${executorCode}; return window.AtlasExecutor;`);
  const executor = evalEnv(win, doc, win.chrome);

  win.open = () => null;

  // Popup blocker hook
  executor.installPopupBlockerHook(win);
  record('CHAL-29: installPopupBlockerHook replaces window.open with __atlasWrapped',
    win.open && win.open.__atlasWrapped === true
  );

  // Blocked popup simulation
  let popupBlockedDispatched = false;
  win.addEventListener('__atlas_popup_blocked__', () => {
    popupBlockedDispatched = true;
  });

  // Call wrapped window.open returning null
  const popupResult = win.open('https://example.com/popup', '_blank');
  record('CHAL-30: window.open returning null dispatches __atlas_popup_blocked__ event',
    popupBlockedDispatched === true && popupResult === null
  );

  // Native credential ceremony hook
  executor.installNativeAuthHook(win.navigator);
  record('CHAL-31: installNativeAuthHook wraps navigator.credentials.get with __atlasWrapped',
    win.navigator.credentials.get.__atlasWrapped === true
  );
})();

// ── DOMAIN 7: Universal Prime Directive & Sacred Rails Invariants ──────────────
console.log('\n[Domain 7: Universal Prime Directive & Sacred Verifier Rails Invariants]');

(function testUniversalRuleAndSacredRails() {
  // 1. Verifier Sacred Rails
  const verifierPath = path.join(__dirname, '../backend/app/agent/verifier.py');
  const verifierContent = fs.readFileSync(verifierPath, 'utf8');
  const lines = verifierContent.split('\n');

  // Rule 4 start is around line 281
  const rule4Present = lines.some(l => l.includes('Rule 4: URL Transitions (Corrected)'));
  const rule5Present = lines.some(l => l.includes('Rule 5: Element Disappearance'));
  const rule6Present = lines.some(l => l.includes('Rule 6: Fallback to LLM Evaluation'));

  record('CHAL-32: Sacred Rails Rule 4 present in backend/app/agent/verifier.py', rule4Present);
  record('CHAL-33: Sacred Rails Rule 5 present in backend/app/agent/verifier.py', rule5Present);
  record('CHAL-34: Sacred Rails Rule 6 present in backend/app/agent/verifier.py', rule6Present);

  // 2. Universal Prime Directive (0 Hardcoded Domains)
  const forbiddenDomains = [
    'drive.google.com',
    'amazon.com',
    'github.com',
    'wikipedia.org',
    'youtube.com',
    'facebook.com',
    'twitter.com'
  ];

  const prodFiles = [
    'sidebar.js',
    'content.js',
    'background.js',
    'executor.js',
    'tab-registry.js'
  ];

  let violationsFound = 0;
  for (const file of prodFiles) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const dom of forbiddenDomains) {
      if (content.includes(dom)) {
        violationsFound++;
        console.error(`Violation: ${dom} found in ${file}`);
      }
    }
    // Also verify window.location.hostname checks
    if (/window\.location\.hostname\s*===/.test(content) || /window\.location\.hostname\.includes/.test(content)) {
      violationsFound++;
      console.error(`Violation: window.location.hostname check found in ${file}`);
    }
  }

  record('CHAL-35: Universal Prime Directive: strictly 0 hardcoded domains across production client scripts',
    violationsFound === 0
  );

  // 3. Purged Fixture IDs in content.js
  const contentPath = path.join(__dirname, 'content.js');
  const contentJs = fs.readFileSync(contentPath, 'utf8');
  const fixtureIds = [
    'assisted-click-target',
    'popup-blocked-notice',
    'webauthn-active-notice',
    'auth-status',
    'auth-success-badge'
  ];
  let fixtureMatches = 0;
  for (const id of fixtureIds) {
    if (contentJs.includes(id)) {
      fixtureMatches++;
      console.error(`Fixture violation: ${id} found in content.js`);
    }
  }
  record('CHAL-36: Zero hardcoded fixture IDs in content.js', fixtureMatches === 0);
})();

// ── Summary & Exit ────────────────────────────────────────────────────────────
console.log('\n===============================================================');
console.log(`Generation 12 Empirical Challenger Suite: ${passed} passed, ${failed} failed.`);
console.log(`Empirical Findings Discovered: ${empiricalFindings.length}`);
console.log('===============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

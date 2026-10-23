// client-script/test_latent_nodes.js
// Acceptance test suite for WS4: Latent nodes, menu metadata, and executor reveal

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  });
}

console.log('\n--- Running WS4 Perception & Latent Nodes Test Suite ---\n');

// ── In-Memory DOM Mock Engine ────────────────────────────────────────────────
const selectorCache = new Map();
function getParsedSelectors(sel) {
  let parsed = selectorCache.get(sel);
  if (!parsed) {
    parsed = sel.split(',').map((s) => s.trim().toLowerCase());
    selectorCache.set(sel, parsed);
  }
  return parsed;
}

class MockElement {
  constructor(tagName, attrs = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    this.style = {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      fontSize: '14px',
      position: 'static',
    };
    this.children = [];
    this.parentElement = null;
    this.textContent = text;
    this._listeners = new Map();
    this.open = false; // for <details>
    this.disabled = false;
    this.hidden = false;

    for (const [k, v] of Object.entries(attrs)) {
      this.setAttribute(k, v);
    }
  }

  get innerText() {
    let curr = this;
    while (curr) {
      if (curr.style.display === 'none' || curr.style.visibility === 'hidden' || curr.hidden) {
        return '';
      }
      if (curr.tagName === 'DETAILS' && !curr.open && this.tagName !== 'SUMMARY') {
        return '';
      }
      if (curr.tagName === 'DIALOG' && !curr.open) {
        return '';
      }
      curr = curr.parentElement;
    }
    return this.textContent;
  }
  set innerText(val) {
    this.textContent = val;
  }

  get id() {
    return this.attributes.get('id') || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }

  get type() {
    return this.attributes.get('type') || '';
  }
  get role() {
    return this.attributes.get('role') || '';
  }
  get href() {
    return this.attributes.get('href') || '';
  }
  get name() {
    return this.attributes.get('name') || '';
  }

  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'style') {
      const parts = String(v).split(';');
      for (const p of parts) {
        const [prop, val] = p.split(':').map((s) => s.trim());
        if (prop && val) {
          if (prop === 'display') this.style.display = val;
          if (prop === 'visibility') this.style.visibility = val;
          if (prop === 'opacity') this.style.opacity = val;
        }
      }
    }
    if (k === 'open') this.open = true;
    if (k === 'disabled') this.disabled = true;
    if (k === 'hidden') this.hidden = true;
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
    if (k === 'open') this.open = false;
    if (k === 'disabled') this.disabled = false;
    if (k === 'hidden') this.hidden = false;
  }

  appendChild(child) {
    child.parentElement = this;
    if (this.children.length > 0) {
      const prev = this.children[this.children.length - 1];
      child._prev = prev;
      prev._next = child;
    }
    this.children.push(child);
    return child;
  }

  get previousElementSibling() {
    return this._prev || null;
  }

  get nextElementSibling() {
    return this._next || null;
  }

  matches(selector) {
    const tag = this.tagName.toLowerCase();
    if (selector === '*') return true;
    if (!selector.includes('.') && !selector.includes('#') && !selector.includes('[') && !selector.includes(':') && !selector.includes(',')) {
      return tag === selector.toLowerCase();
    }
    const sList = getParsedSelectors(selector);
    const role = (this.getAttribute('role') || '').toLowerCase();
    const id = this.id.toLowerCase();
    const cls = (this.getAttribute('class') || '').toLowerCase();

    for (const sel of sList) {
      if (sel === '*') return true;
      if (sel === tag) return true;
      if (sel === `[role="${role}"]` && role) return true;
      if (sel === `[id="${id}"]` && id) return true;
      if (sel.startsWith('#') && id === sel.slice(1)) return true;
      if (sel.startsWith('.') && cls.split(/\s+/).includes(sel.slice(1))) return true;
      if (sel === 'a[href]' && tag === 'a' && this.hasAttribute('href')) return true;
      if (sel === 'button' && (tag === 'button' || role === 'button')) return true;
      if (sel === '[role="button"]' && role === 'button') return true;
      if (sel === '[role="menuitem"]' && role === 'menuitem') return true;
      if (sel === '[role="link"]' && role === 'link') return true;
      if (sel === '[role="menu"]' && role === 'menu') return true;
      if (sel === '[role="menubar"]' && role === 'menubar') return true;
      if (sel === '[role="navigation"]' && role === 'navigation') return true;
      if (sel === '[aria-hidden="true"]' && this.getAttribute('aria-hidden') === 'true') return true;
      if (sel === 'details:not([open])' && tag === 'details' && !this.open && !this.hasAttribute('open')) return true;
      if (sel === 'dialog:not([open])' && tag === 'dialog' && !this.open && !this.hasAttribute('open')) return true;
      if (sel === '[inert]' && this.hasAttribute('inert')) return true;
      if (sel === '[aria-controls]' && this.hasAttribute('aria-controls')) return true;
      if (sel.includes('[class*="drawer"') && cls.includes('drawer')) return true;
      if (sel.includes('[id*="drawer"') && id.includes('drawer')) return true;

      const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
      if (attrMatch) {
        const [, aName, aVal] = attrMatch;
        if (aVal !== undefined) {
          if (this.getAttribute(aName) === aVal) return true;
        } else if (this.hasAttribute(aName)) {
          return true;
        }
      }
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  contains(el) {
    let curr = el;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  querySelectorAll(selector) {
    const res = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.matches && c.matches(selector)) {
          res.push(c);
        }
        walk(c);
      }
    };
    walk(this);
    return res;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  scrollIntoView() {}

  focus() {
    if (global.document) global.document.activeElement = this;
  }
  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, cancelable: true });
  }

  getBoundingClientRect() {
    let curr = this;
    while (curr) {
      if (curr.style.display === 'none' || curr.style.visibility === 'hidden' || curr.hidden) {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      if (curr.tagName === 'DETAILS' && !curr.open && this.tagName !== 'SUMMARY') {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      if (curr.tagName === 'DIALOG' && !curr.open) {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      curr = curr.parentElement;
    }
    return { left: 10, top: 10, width: 100, height: 30 };
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(ev) {
    const list = this._listeners.get(ev.type) || [];
    for (const fn of list) fn(ev);
    return true;
  }

  get classList() {
    return {
      add: (c) => {
        const cls = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!cls.includes(c)) cls.push(c);
        this.setAttribute('class', cls.join(' '));
      },
      remove: (c) => {
        const cls = (this.getAttribute('class') || '').split(/\s+/).filter((s) => s !== c);
        this.setAttribute('class', cls.join(' '));
      },
      contains: (c) => {
        const cls = (this.getAttribute('class') || '').split(/\s+/);
        return cls.includes(c);
      },
    };
  }

  get offsetParent() {
    let curr = this;
    while (curr) {
      if (curr.style.display === 'none') return null;
      curr = curr.parentElement;
    }
    return this.parentElement || null;
  }
}

function setupMockDocument() {
  const docElement = new MockElement('html');
  const head = new MockElement('head');
  const body = new MockElement('body');
  docElement.appendChild(head);
  docElement.appendChild(body);

  const doc = {
    documentElement: docElement,
    head: head,
    body: body,
    activeElement: body,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      const all = docElement.querySelectorAll(`[id="${id}"]`);
      if (all.length > 0) return all[0];
      return docElement.id === id ? docElement : null;
    },
    querySelector: (sel) => docElement.querySelector(sel),
    querySelectorAll: (sel) => docElement.querySelectorAll(sel),
  };

  global.window = {
    document: doc,
    getComputedStyle: (el) => el.style,
    AtlasSerializer: (typeof AtlasSerializer !== 'undefined' ? AtlasSerializer : null),
  };
  global.document = doc;
  global.CSS = { escape: (s) => s };
  global.PointerEvent = function (t, init) { return Object.assign({ type: t }, init); };
  global.MouseEvent = function (t, init) { return Object.assign({ type: t }, init); };
  global.KeyboardEvent = function (t, init) { return Object.assign({ type: t }, init); };
  global.MutationObserver = function (cb) {
    return { observe: () => {}, disconnect: () => {} };
  };

  return { doc, body };
}

// ── Static Inspection Tests ──────────────────────────────────────────────────
const serializerSrc = fs.readFileSync(path.join(__dirname, 'dom-serializer.js'), 'utf8');
const executorSrc = fs.readFileSync(path.join(__dirname, 'executor.js'), 'utf8');

test('dom-serializer.js exports latent helpers and constants', () => {
  assert(serializerSrc.includes('detectLandmark'), 'Must implement detectLandmark');
  assert(serializerSrc.includes('detectMenu'), 'Must implement detectMenu');
  assert(serializerSrc.includes('detectBreadcrumb'), 'Must implement detectBreadcrumb');
  assert(serializerSrc.includes('findNearestToggle'), 'Must implement findNearestToggle');
  assert(serializerSrc.includes('data-atlas-reveal-via'), 'Must define data-atlas-reveal-via attribute');
});

test('executor.js exports doReveal and handles reveal action', () => {
  assert(/case\s+['"]reveal['"]/.test(executorSrc), 'executor.js must handle reveal action in switch');
  assert(/doReveal/.test(executorSrc), 'executor.js must implement doReveal');
  assert(/isInteractingAction.*['"]reveal['"]/.test(executorSrc), 'isInteractingAction must include reveal');
  assert(/READ_ONLY_ACTIONS.*reveal/.test(executorSrc), 'READ_ONLY_ACTIONS must include reveal');
});

// ── Functional DOM Serializer Tests ──────────────────────────────────────────
const AtlasSerializer = require('./dom-serializer.js');
const AtlasExecutor = require('./executor.js');

test('Hover Mega-Menu: hidden links inside nav are emitted as latent with reveal_via and nav landmark', () => {
  const { body } = setupMockDocument();

  // <nav><button id="btn-products" aria-haspopup="true">Products</button><ul id="prod-menu" style="display:none"><li><a href="/item1">Product 1</a></li></ul></nav>
  const nav = new MockElement('nav');
  const btn = new MockElement('button', { id: 'btn-products', 'aria-haspopup': 'true' }, 'Products');
  const ul = new MockElement('ul', { id: 'prod-menu', style: 'display:none' });
  const li = new MockElement('li');
  const a = new MockElement('a', { href: '/item1' }, 'Product 1');

  li.appendChild(a);
  ul.appendChild(li);
  nav.appendChild(btn);
  nav.appendChild(ul);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 2, 'Should emit 1 visible button and 1 latent link');

  const visibleBtn = nodes[0];
  assert.strictEqual(visibleBtn.tag, 'button');
  assert.strictEqual(visibleBtn.visible, true);
  assert.strictEqual(visibleBtn.landmark, 'nav');
  assert.deepStrictEqual(visibleBtn.menu, { haspopup: 'true', expanded: false, controls: 'prod-menu' });

  const latentLink = nodes[1];
  assert.strictEqual(latentLink.tag, 'a');
  assert.strictEqual(latentLink.visible, false);
  assert.strictEqual(latentLink.resolved_label, 'Product 1');
  assert.strictEqual(latentLink.href, '/item1');
  assert.strictEqual(latentLink.reveal_via, visibleBtn.id);
  assert.strictEqual(latentLink.landmark, 'nav');
  assert.deepStrictEqual(latentLink.breadcrumb, ['Products']);
  assert.strictEqual(a.getAttribute('data-atlas-reveal-via'), visibleBtn.id);
});

test('Click Dropdown with aria-controls: hidden items emitted with reveal_via pointing to toggle button', () => {
  const { body } = setupMockDocument();

  // <header><button id="btn-services" aria-controls="svc-list" aria-expanded="false">Services</button><div id="svc-list" style="display:none"><a href="/traffic">Traffic Violations</a></div></header>
  const header = new MockElement('header');
  const btn = new MockElement('button', { id: 'btn-services', 'aria-controls': 'svc-list', 'aria-expanded': 'false' }, 'Services');
  const div = new MockElement('div', { id: 'svc-list', style: 'display:none' });
  const link = new MockElement('a', { href: '/traffic' }, 'Traffic Violations');

  div.appendChild(link);
  header.appendChild(btn);
  header.appendChild(div);
  body.appendChild(header);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 2, 'Should emit visible button and latent service link');

  const btnNode = nodes[0];
  assert.strictEqual(btnNode.visible, true);
  assert.strictEqual(btnNode.landmark, 'header');
  assert.deepStrictEqual(btnNode.menu, { haspopup: 'true', expanded: false, controls: 'svc-list' });

  const latentNode = nodes[1];
  assert.strictEqual(latentNode.visible, false);
  assert.strictEqual(latentNode.resolved_label, 'Traffic Violations');
  assert.strictEqual(latentNode.reveal_via, btnNode.id);
  assert.strictEqual(latentNode.landmark, 'header');
  assert.deepStrictEqual(latentNode.breadcrumb, ['Services']);
});

test('Details / Summary: closed <details> emits <summary> toggle and latent children with reveal_via', () => {
  const { body } = setupMockDocument();

  // <nav><details id="det-faq"><summary id="sum-faq">Help Topics</summary><a href="/faq1">Getting Started</a></details></nav>
  const nav = new MockElement('nav');
  const details = new MockElement('details', { id: 'det-faq' });
  details.open = false;
  const summary = new MockElement('summary', { id: 'sum-faq' }, 'Help Topics');
  const a = new MockElement('a', { href: '/faq1' }, 'Getting Started');

  details.appendChild(summary);
  details.appendChild(a);
  nav.appendChild(details);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 2, 'Should emit summary and latent link');

  const sumNode = nodes[0];
  assert.strictEqual(sumNode.tag, 'summary');
  assert.strictEqual(sumNode.visible, true);
  assert.deepStrictEqual(sumNode.menu, { haspopup: 'true', expanded: false, controls: 'det-faq' });

  const latentChild = nodes[1];
  assert.strictEqual(latentChild.tag, 'a');
  assert.strictEqual(latentChild.visible, false);
  assert.strictEqual(latentChild.resolved_label, 'Getting Started');
  assert.strictEqual(latentChild.reveal_via, sumNode.id);
  assert.deepStrictEqual(latentChild.breadcrumb, ['Help Topics']);
});

test('Off-Canvas Drawer: <aside> hidden items emitted with aside landmark and drawer toggle reveal_via', () => {
  const { body } = setupMockDocument();

  // <header><button id="hamburger-btn" aria-controls="mobile-drawer">Menu</button></header><aside id="mobile-drawer" class="mobile-drawer" style="display:none"><a href="/dashboard">Dashboard</a><a href="/settings">Settings</a></aside>
  const header = new MockElement('header');
  const toggle = new MockElement('button', { id: 'hamburger-btn', 'aria-controls': 'mobile-drawer' }, 'Menu');
  const aside = new MockElement('aside', { id: 'mobile-drawer', class: 'mobile-drawer', style: 'display:none' });
  const a1 = new MockElement('a', { href: '/dashboard' }, 'Dashboard');
  const a2 = new MockElement('a', { href: '/settings' }, 'Settings');

  aside.appendChild(a1);
  aside.appendChild(a2);
  header.appendChild(toggle);
  body.appendChild(header);
  body.appendChild(aside);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 3, 'Should emit 1 visible button and 2 latent drawer links');

  const drawerToggle = nodes[0];
  assert.strictEqual(drawerToggle.visible, true);

  const latent1 = nodes[1];
  assert.strictEqual(latent1.resolved_label, 'Dashboard');
  assert.strictEqual(latent1.visible, false);
  assert.strictEqual(latent1.landmark, 'aside');
  assert.strictEqual(latent1.reveal_via, drawerToggle.id);

  const latent2 = nodes[2];
  assert.strictEqual(latent2.resolved_label, 'Settings');
  assert.strictEqual(latent2.visible, false);
  assert.strictEqual(latent2.landmark, 'aside');
  assert.strictEqual(latent2.reveal_via, drawerToggle.id);
});

test('Hidden password input NOT emitted: sensitive fields inside hidden menu strictly excluded', () => {
  const { body } = setupMockDocument();

  const nav = new MockElement('nav');
  const btn = new MockElement('button', { id: 'auth-menu' }, 'Login');
  const ul = new MockElement('ul', { style: 'display:none' });
  const pwInput = new MockElement('input', { type: 'password', name: 'user_password' });
  const textInput = new MockElement('input', { type: 'text', name: 'user_name' });
  const submitBtn = new MockElement('button', { type: 'submit' }, 'Log In Now');

  ul.appendChild(pwInput);
  ul.appendChild(textInput);
  ul.appendChild(submitBtn);
  nav.appendChild(btn);
  nav.appendChild(ul);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  // Only the visible toggle button and the latent submit button should be emitted, NEVER inputs
  assert.strictEqual(nodes.length, 2, 'Must not emit hidden input fields');
  assert(!nodes.some((n) => n.tag === 'input'), 'Zero input tags emitted in latent pass');
  assert(!nodes.some((n) => n.type === 'password'), 'Password input strictly excluded');
  assert.strictEqual(nodes[1].resolved_label, 'Log In Now');
});

test('Aria-hidden dialog NOT emitted: elements inside aria-hidden="true" strictly excluded', () => {
  const { body } = setupMockDocument();

  const nav = new MockElement('nav');
  const hiddenModal = new MockElement('div', { role: 'dialog', 'aria-hidden': 'true', style: 'display:none' });
  const linkInModal = new MockElement('a', { href: '/hidden-terms' }, 'Secret Terms');

  hiddenModal.appendChild(linkInModal);
  nav.appendChild(hiddenModal);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 0, 'Must NOT emit latent elements inside aria-hidden="true"');
});

test('Closed <dialog> NOT emitted: elements inside unopened dialog strictly excluded', () => {
  const { body } = setupMockDocument();

  const nav = new MockElement('nav');
  const closedDialog = new MockElement('dialog');
  closedDialog.open = false;
  const linkInDialog = new MockElement('a', { href: '/dialog-action' }, 'Dialog Action');

  closedDialog.appendChild(linkInDialog);
  nav.appendChild(closedDialog);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 0, 'Must NOT emit latent elements inside closed <dialog>');
});

test('Display:none on body or html: emits 0 latent nodes', () => {
  const { body } = setupMockDocument();
  body.style.display = 'none';

  const nav = new MockElement('nav');
  const btn = new MockElement('button', {}, 'Menu');
  const ul = new MockElement('ul', { style: 'display:none' });
  const a = new MockElement('a', { href: '/test' }, 'Sublink');
  ul.appendChild(a);
  nav.appendChild(btn);
  nav.appendChild(ul);
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 0, 'display:none on body must emit 0 nodes');
});

test('Visible-only page output identical to before: refs, ordinals, and fields remain stable', () => {
  const { body } = setupMockDocument();

  const form = new MockElement('form', { id: 'contact-form' });
  const btnSubmit = new MockElement('button', { id: 'submit-btn' }, 'Submit Form');
  const aHelp = new MockElement('a', { href: '/help' }, 'Get Help');
  form.appendChild(btnSubmit);
  form.appendChild(aHelp);
  body.appendChild(form);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 2, 'Should serialize both visible elements');
  assert.strictEqual(nodes[0].resolved_label, 'Submit Form');
  assert.strictEqual(nodes[0].visible, true);
  assert.strictEqual(nodes[0].reveal_via, null);
  assert.strictEqual(nodes[1].resolved_label, 'Get Help');
  assert.strictEqual(nodes[1].visible, true);
  assert.strictEqual(nodes[1].reveal_via, null);
});

test('data-atlas-reveal-via lifecycle: stamped on latent elements, removed once visible', () => {
  const { body } = setupMockDocument();

  const nav = new MockElement('nav');
  const toggle = new MockElement('button', { id: 'toggle-btn' }, 'Categories');
  const menu = new MockElement('ul', { id: 'cat-menu', style: 'display:none' });
  const catItem = new MockElement('a', { href: '/electronics' }, 'Electronics');

  menu.appendChild(catItem);
  nav.appendChild(toggle);
  nav.appendChild(menu);
  body.appendChild(nav);

  // Scan 1: Element is latent -> data-atlas-reveal-via stamped
  let nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes[1].visible, false);
  assert.strictEqual(catItem.getAttribute('data-atlas-reveal-via'), nodes[0].id);

  // Menu opens -> element becomes visible
  menu.style.display = 'block';

  // Scan 2: Element is now visible -> data-atlas-reveal-via removed!
  nodes = AtlasSerializer.serialize();
  const visibleItem = nodes.find((n) => n.resolved_label === 'Electronics');
  assert(visibleItem, 'Item must be serialized');
  assert.strictEqual(visibleItem.visible, true);
  assert.strictEqual(catItem.hasAttribute('data-atlas-reveal-via'), false, 'data-atlas-reveal-via must be removed when visible');
});

test('Latent nodes cap at 150 items', () => {
  const { body } = setupMockDocument();

  const nav = new MockElement('nav');
  const toggle = new MockElement('button', { id: 'massive-menu-btn' }, 'Massive Menu');
  const ul = new MockElement('ul', { style: 'display:none' });
  nav.appendChild(toggle);
  nav.appendChild(ul);

  for (let i = 1; i <= 200; i++) {
    const li = new MockElement('li');
    const a = new MockElement('a', { href: `/subitem-${i}` }, `Item ${i}`);
    li.appendChild(a);
    ul.appendChild(li);
  }
  body.appendChild(nav);

  const nodes = AtlasSerializer.serialize();
  const latentNodes = nodes.filter((n) => n.visible === false);
  assert.strictEqual(latentNodes.length, 150, 'Latent items must strictly be capped at 150');
});

test('Performance: latent pass on 2,000 synthetic DOM elements executes in < 20 ms', () => {
  const { body } = setupMockDocument();

  // Create 100 navigation menus, each containing 20 elements (total 2,000 elements)
  for (let m = 0; m < 100; m++) {
    const nav = new MockElement('nav');
    const btn = new MockElement('button', { id: `toggle-${m}`, 'aria-haspopup': 'true' }, `Menu ${m}`);
    const ul = new MockElement('ul', { style: 'display:none' });
    for (let i = 0; i < 19; i++) {
      const a = new MockElement('a', { href: `/m/${m}/i/${i}` }, `Menu ${m} Link ${i}`);
      ul.appendChild(a);
    }
    nav.appendChild(btn);
    nav.appendChild(ul);
    body.appendChild(nav);
  }

  const nodes = AtlasSerializer.serialize();
  const latentDuration = AtlasSerializer.getLastLatentDuration();

  assert(nodes.length > 0, 'Must serialize nodes');
  console.log(`     Latency benchmark: latent pass executed in ${latentDuration.toFixed(2)} ms (budget: < 20 ms)`);
  assert(latentDuration < 20, `Latent pass took ${latentDuration.toFixed(2)} ms, which exceeds the 20 ms budget!`);
});

// ── Functional Executor Reveal Tests ─────────────────────────────────────────

testAsync('Executor doReveal: Idempotency (already expanded or visible does nothing)', async () => {
  setupMockDocument();

  const toggle = new MockElement('button', { 'aria-expanded': 'true' }, 'Open Menu');
  const res = await AtlasExecutor.doReveal(toggle);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.message, 'Already revealed');
});

testAsync('Executor doReveal: Reveals via hover if hover reveals target', async () => {
  setupMockDocument();

  const toggle = new MockElement('button', { 'aria-expanded': 'false' }, 'Hover Menu');
  const menu = new MockElement('div', { id: 'hover-content', style: 'display:none' });
  toggle.setAttribute('aria-controls', 'hover-content');

  toggle.addEventListener('mouseenter', () => {
    menu.style.display = 'block';
    toggle.setAttribute('aria-expanded', 'true');
  });

  const res = await AtlasExecutor.doReveal(toggle);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
});

testAsync('Executor doReveal: Never clicks an <a href> that would navigate away', async () => {
  setupMockDocument();

  let linkClicked = false;
  const linkToggle = new MockElement('a', { href: 'https://example.com/dest', 'aria-expanded': 'false' }, 'Nav Link');
  linkToggle.addEventListener('click', () => {
    linkClicked = true;
  });

  const res = await AtlasExecutor.doReveal(linkToggle);
  assert.strictEqual(linkClicked, false, 'Must NEVER click a navigating <a href> for a reveal');
  assert.strictEqual(res.ok, false, 'Timed out cleanly without navigating');
});

testAsync('Executor execute self-healing: clicking latent node triggers reveal on toggle first', async () => {
  const { body } = setupMockDocument();

  let revealTriggered = false;
  let childClicked = false;

  const toggle = new MockElement('button', { id: 'toggle-acc', 'data-atlas-id': 'el_toggle' }, 'Accordion');
  const targetChild = new MockElement('button', {
    id: 'child-btn',
    'data-atlas-id': 'el_child',
    'data-atlas-reveal-via': 'el_toggle',
    style: 'display:none',
  }, 'Hidden Action');

  toggle.addEventListener('click', () => {
    revealTriggered = true;
    targetChild.style.display = 'block';
    toggle.setAttribute('aria-expanded', 'true');
  });

  targetChild.addEventListener('click', () => {
    childClicked = true;
  });

  body.appendChild(toggle);
  body.appendChild(targetChild);

  const res = await AtlasExecutor.execute({
    status: 'ok',
    action: 'click',
    element_id: 'el_child',
    message: 'Click hidden child',
  }, { skipConfirmation: true });

  assert.strictEqual(res.ok, true, 'Self-healing execute must succeed');
  assert.strictEqual(revealTriggered, true, 'Toggle must be revealed first');
  assert.strictEqual(childClicked, true, 'Target child must be clicked after reveal');
});

// ── Prime Directive Universal Audit ──────────────────────────────────────────
test('Universal Prime Directive: Zero hardcoded hostnames, domain names or site-specific selectors', () => {
  const DOMAIN_REGEX = /(?:google\.com|amazon\.com|github\.com|wikipedia\.org|ppo\.gov|egypt)/i;
  assert(!DOMAIN_REGEX.test(serializerSrc), 'dom-serializer.js contains zero site/domain references');
  assert(!DOMAIN_REGEX.test(executorSrc), 'executor.js contains zero site/domain references');
});

(async () => {
  for (const t of asyncTests) {
    await t();
  }
  console.log(`\nWS4 Perception Test Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
})();

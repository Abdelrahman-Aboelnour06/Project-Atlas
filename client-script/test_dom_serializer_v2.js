// client-script/test_dom_serializer_v2.js
// Acceptance test suite for Track 1f: dom-serializer.js v2

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

console.log('\n--- Running Track 1f DOM Serializer v2 Tests ---\n');

const serializerSrc = fs.readFileSync(path.join(__dirname, 'dom-serializer.js'), 'utf8');

// 1. Static Contract & AST Inspection
test('dom-serializer.js defines computeRef and uses fnv1a', () => {
  assert(/computeRef/i.test(serializerSrc), 'dom-serializer.js must implement computeRef');
  assert(/fnv1a/i.test(serializerSrc), 'dom-serializer.js must implement fnv1a');
  assert(!/Date\.now\(\)/.test(serializerSrc), 'dom-serializer.js must NOT use Date.now() for ID generation');
});

test('dom-serializer.js emits disabled elements instead of skipping them', () => {
  assert(!/if\s*\(\s*el\.disabled\s*\)\s*continue/.test(serializerSrc), 'Must not continue/skip when el.disabled is true');
  assert(/disabled:\s*/.test(serializerSrc), 'Output objects must contain disabled property');
});

test('dom-serializer.js extracts v2 fields: ref, form_id, options, error_text, section_label', () => {
  assert(/ref:\s*/.test(serializerSrc), 'Must emit ref field');
  assert(/form_id:\s*/.test(serializerSrc), 'Must emit form_id field');
  assert(/options:\s*/.test(serializerSrc), 'Must emit options field');
  assert(/error_text:\s*/.test(serializerSrc), 'Must emit error_text field');
  assert(/section_label:\s*/.test(serializerSrc), 'Must emit section_label field');
  assert(/required:\s*/.test(serializerSrc), 'Must emit required field');
  assert(/current_value:\s*/.test(serializerSrc), 'Must emit current_value field');
  assert(/invalid:\s*/.test(serializerSrc), 'Must emit invalid field');
  // WS11 Lane B additions
  assert(/opens_new_tab:\s*/.test(serializerSrc), 'Must emit opens_new_tab field');
  assert(/target_origin:\s*/.test(serializerSrc), 'Must emit target_origin field');
  assert(/in_modal:\s*/.test(serializerSrc), 'Must emit in_modal field');
  assert(/blocked_by_modal:\s*/.test(serializerSrc), 'Must emit blocked_by_modal field');
});

// 2. Functional Verification of computeRef
const AtlasSerializer = require('./dom-serializer.js');

test('computeRef is deterministic and stable across re-executions', () => {
  assert(typeof AtlasSerializer.computeRef === 'function', 'computeRef must be exposed');

  const mockEl = {
    tagName: 'INPUT',
    getAttribute: (attr) => (attr === 'role' ? 'textbox' : attr === 'type' ? 'text' : null),
  };

  const ref1 = AtlasSerializer.computeRef(mockEl, 'Address', 'hostile-form', 0);
  const ref2 = AtlasSerializer.computeRef(mockEl, 'Address', 'hostile-form', 0);
  assert.strictEqual(ref1, ref2, 'Identical inputs must yield identical ref');
  assert(/^el_[0-9a-f]{12,16}$/.test(ref1), `Ref must match el_<hex>, got ${ref1}`);

  // Disambiguation by ordinal
  const refOrdinal1 = AtlasSerializer.computeRef(mockEl, 'Address', 'hostile-form', 1);
  assert.notStrictEqual(ref1, refOrdinal1, 'Different ordinal must yield different ref');

  // Disambiguation by formId
  const refOtherForm = AtlasSerializer.computeRef(mockEl, 'Address', 'other-form', 0);
  assert.notStrictEqual(ref1, refOtherForm, 'Different formId must yield different ref');
});

test('fnv1a64 produces expected 64-bit integer', () => {
  assert(typeof AtlasSerializer.fnv1a64 === 'function', 'fnv1a64 must be exposed');
  const h1 = AtlasSerializer.fnv1a64('test');
  const h2 = AtlasSerializer.fnv1a64('test');
  assert.strictEqual(h1, h2, 'fnv1a64 must be deterministic');
  assert(typeof h1 === 'bigint', 'fnv1a64 must return a BigInt');
});

// 3. Fixture markup verification
test('Fixture markup compatibility for Track 1f requirements', () => {
  const hostilePath = path.join(__dirname, '..', 'demo-site', 'hostile-form.html');
  const signupPath = path.join(__dirname, '..', 'demo-site', 'signup.html');
  assert(fs.existsSync(hostilePath), 'hostile-form.html must exist');
  assert(fs.existsSync(signupPath), 'signup.html must exist');

  const hostileContent = fs.readFileSync(hostilePath, 'utf8');
  assert(hostileContent.includes('role="combobox"'), 'hostile-form includes combobox');
  assert(hostileContent.includes('role="listbox"'), 'hostile-form includes listbox');

  const signupContent = fs.readFileSync(signupPath, 'utf8');
  assert(signupContent.includes('disabled'), 'signup-form includes disabled submit button');
});

// 4. Functional Verification of WS11 Lane B (L3 & L7)
class MockElement {
  constructor(tagName, attrs = {}, text = '') {
    this.tagName = tagName.toUpperCase();
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
    this.open = false;
    this.disabled = false;
    this.hidden = false;
    this.value = '';

    for (const [k, v] of Object.entries(attrs)) {
      this.setAttribute(k, v);
    }
  }

  get innerText() {
    let curr = this;
    while (curr) {
      if (curr.style.display === 'none' || curr.style.visibility === 'hidden' || curr.hidden) return '';
      if (curr.tagName === 'DIALOG' && !curr.open) return '';
      curr = curr.parentElement;
    }
    return this.textContent;
  }
  set innerText(val) { this.textContent = val; }

  get id() { return this.attributes.get('id') || ''; }
  set id(v) { this.setAttribute('id', v); }

  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'open') this.open = true;
    if (k === 'disabled') this.disabled = true;
    if (k === 'hidden') this.hidden = true;
  }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) {
    this.attributes.delete(k);
    if (k === 'open') this.open = false;
    if (k === 'disabled') this.disabled = false;
    if (k === 'hidden') this.hidden = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matches(sel) {
    const s = sel.trim().toLowerCase();
    const tag = this.tagName.toLowerCase();
    if (s === '*' || s === tag) return true;
    if (s === `[${ATLAS_ID_ATTR}]` || s === '[data-atlas-id]') return this.hasAttribute('data-atlas-id');
    if (s.startsWith('[data-atlas-id="')) {
      const match = s.match(/\[data-atlas-id="([^"]+)"\]/);
      if (match && this.getAttribute('data-atlas-id') === match[1]) return true;
    }
    if (s.startsWith('[id="')) {
      const match = s.match(/\[id="([^"]+)"\]/);
      if (match && this.id === match[1]) return true;
    }
    if (s.startsWith('.')) {
      const cls = (this.getAttribute('class') || '').split(/\s+/);
      return cls.includes(s.slice(1));
    }
    if (s.startsWith('#')) return this.id === s.slice(1);
    if (s.startsWith('[role="')) {
      const match = s.match(/\[role="([^"]+)"\]/);
      if (match && this.getAttribute('role') === match[1]) return true;
    }
    if (s.includes('[role="dialog"][aria-modal="true"]')) {
      return this.getAttribute('role') === 'dialog' && this.getAttribute('aria-modal') === 'true';
    }
    if (s.includes('dialog[open]')) {
      return tag === 'dialog' && (this.open || this.hasAttribute('open'));
    }
    if (s === 'input:not([type="hidden"])') {
      return tag === 'input' && this.getAttribute('type') !== 'hidden';
    }
    if (s === 'a[href]') {
      return tag === 'a' && this.hasAttribute('href');
    }
    return false;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(sel)) return curr;
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

  querySelectorAll(sel) {
    const res = [];
    const parts = sel.split(',').map((s) => s.trim());
    const walk = (node) => {
      for (const c of node.children) {
        if (parts.some((p) => c.matches && c.matches(p))) {
          res.push(c);
        }
        walk(c);
      }
    };
    walk(this);
    return res;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  getBoundingClientRect() {
    let curr = this;
    while (curr) {
      if (curr.style.display === 'none' || curr.style.visibility === 'hidden' || curr.hidden) {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      if (curr.tagName === 'DIALOG' && !curr.open) {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      curr = curr.parentElement;
    }
    if (this.style.position === 'fixed' && this.style.width === '100%') {
      return { left: 0, top: 0, width: 1000, height: 800 };
    }
    return { left: 10, top: 10, width: 100, height: 30 };
  }

  get offsetParent() {
    if (this.style.position === 'fixed') return null;
    return this.parentElement || null;
  }
}

const ATLAS_ID_ATTR = 'data-atlas-id';

function setupMockDom() {
  const html = new MockElement('html');
  const body = new MockElement('body');
  html.appendChild(body);

  global.window = {
    location: { href: 'http://localhost:3000/portal', origin: 'http://localhost:3000' },
    innerWidth: 1024,
    innerHeight: 768,
    getComputedStyle: (el) => el.style || { display: 'block', visibility: 'visible', position: 'static' },
  };

  global.document = {
    documentElement: html,
    body: body,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    querySelector: (sel) => body.querySelector(sel),
    getElementById: (id) => {
      const all = body.querySelectorAll('*');
      return all.find((el) => el.id === id) || null;
    },
    elementFromPoint: (x, y) => null,
  };
  global.CSS = { escape: (s) => s };
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  return { html, body };
}

test('Rule 3: Node IDs remain 100% stable on page without modal', () => {
  const { body } = setupMockDom();

  const btn = new MockElement('button', {}, 'Submit Application');
  const inp = new MockElement('input', { type: 'text', name: 'user_field' }, '');
  const link = new MockElement('a', { href: '/services' }, 'All Services');

  body.appendChild(btn);
  body.appendChild(inp);
  body.appendChild(link);

  // Compute expected reference IDs using computeRef in order
  const expBtnRef = AtlasSerializer.computeRef(btn, 'Submit Application', null, 0);
  const expInpRef = AtlasSerializer.computeRef(inp, 'user field', null, 0);
  const expLinkRef = AtlasSerializer.computeRef(link, 'All Services', null, 0);

  const nodes = AtlasSerializer.serialize();
  assert.strictEqual(nodes.length, 3, 'Must serialize all 3 elements');
  assert.strictEqual(nodes[0].id, expBtnRef, 'Button ID matches computeRef ordinal 0');
  assert.strictEqual(nodes[1].id, expInpRef, 'Input ID matches computeRef ordinal 0');
  assert.strictEqual(nodes[2].id, expLinkRef, 'Link ID matches computeRef ordinal 0');
  assert.strictEqual(nodes[0].in_modal, false, 'in_modal must be false');
  assert.strictEqual(nodes[0].blocked_by_modal, false, 'blocked_by_modal must be false');
});

test('L3: dom-serializer exports opens_new_tab and target_origin for links', () => {
  const { body } = setupMockDom();

  const blankLink = new MockElement('a', { href: 'https://other.example.com/login', target: '_blank' }, 'External Portal');
  const normalLink = new MockElement('a', { href: '/local/page' }, 'Internal Page');
  const btn = new MockElement('button', {}, 'Regular Button');

  body.appendChild(blankLink);
  body.appendChild(normalLink);
  body.appendChild(btn);

  const nodes = AtlasSerializer.serialize();
  const blankNode = nodes.find((n) => n.inner_text === 'External Portal');
  const normalNode = nodes.find((n) => n.inner_text === 'Internal Page');
  const btnNode = nodes.find((n) => n.inner_text === 'Regular Button');

  assert(blankNode, 'Blank link serialized');
  assert.strictEqual(blankNode.opens_new_tab, true, 'target="_blank" must set opens_new_tab: true');
  assert.strictEqual(blankNode.target_origin, 'https://other.example.com', 'target_origin resolves external origin');

  assert(normalNode, 'Normal link serialized');
  assert.strictEqual(normalNode.opens_new_tab, false, 'Normal relative link has opens_new_tab: false');
  assert.strictEqual(normalNode.target_origin, 'http://localhost:3000', 'Resolves local base origin');

  assert(btnNode, 'Button serialized');
  assert.strictEqual(btnNode.opens_new_tab, false, 'Non-link button has opens_new_tab: false');
  assert.strictEqual(btnNode.target_origin, null, 'Non-link button has target_origin: null');
});

test('L7: Real modal dialog (<dialog open>) emits modal nodes first with in_modal: true', () => {
  const { body } = setupMockDom();

  const backgroundBtn = new MockElement('button', {}, 'Background Nav');
  body.appendChild(backgroundBtn);

  const dialog = new MockElement('dialog', { open: 'true', role: 'dialog', 'aria-modal': 'true' });
  dialog.open = true;
  const modalInput = new MockElement('input', { type: 'text', name: 'national_id' });
  const modalSubmit = new MockElement('button', {}, 'Confirm Modal');
  dialog.appendChild(modalInput);
  dialog.appendChild(modalSubmit);
  body.appendChild(dialog);

  const nodes = AtlasSerializer.serialize();
  assert(nodes.length >= 2, 'Must serialize modal nodes');
  assert.strictEqual(nodes[0].in_modal, true, 'Modal node must have in_modal: true');
  assert.strictEqual(nodes[0].blocked_by_modal, false, 'Modal node blocked_by_modal: false');
  assert.strictEqual(nodes[1].in_modal, true, 'Second modal node must have in_modal: true');
});

test('L7: Heuristic fixed overlay covering viewport with inputs is recognized with in_modal: true and emitted first', () => {
  const { body } = setupMockDom();

  const backgroundBtn = new MockElement('button', {}, 'Home Link');
  body.appendChild(backgroundBtn);

  const overlay = new MockElement('div', { id: 'custom-modal-overlay', class: 'overlay-card' });
  overlay.style.position = 'fixed';
  overlay.style.width = '100%';
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });

  const overlayInput = new MockElement('input', { type: 'text', name: 'service_query' });
  const overlayBtn = new MockElement('button', {}, 'Search In Modal');
  overlay.appendChild(overlayInput);
  overlay.appendChild(overlayBtn);
  body.appendChild(overlay);

  global.document.elementFromPoint = (x, y) => overlay;

  const nodes = AtlasSerializer.serialize();
  assert(nodes.length >= 3, 'Must serialize both overlay and background nodes (overlay does not hide page)');
  assert.strictEqual(nodes[0].in_modal, true, 'Overlay node emitted first with in_modal: true');
  assert.strictEqual(nodes[1].in_modal, true, 'Second overlay node emitted with in_modal: true');
  assert.strictEqual(nodes[2].in_modal, false, 'Background node in_modal: false');
  assert.strictEqual(nodes[2].blocked_by_modal, false, 'Background node not blocked by heuristic overlay');
});

console.log(`\nTrack 1f Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

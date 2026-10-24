/**
 * client-script/test_ws12_lane_e_r2.js
 * Acceptance & Unit Test Suite for WS12 Lane E Round 2:
 * R2-1: Verification that AtlasExecutor.executeStep preserves step.vault_login
 * and suppresses the on-page credential banner only for confirmed vault tokens.
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

// ── Mock DOM Environment ──────────────────────────────────────────────────────
class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}
global.PointerEvent = global.PointerEvent || MockEvent;
global.MouseEvent = global.MouseEvent || MockEvent;
global.KeyboardEvent = global.KeyboardEvent || MockEvent;
global.Event = global.Event || MockEvent;
global.InputEvent = global.InputEvent || MockEvent;

class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
      toggle: () => {},
    };
    this.children = [];
    this.parentNode = null;
    this.value = '';
    this.type = '';
    this.attributes = {};
  }
  getAttribute(name) {
    if (name === 'id') return this.id;
    if (name === 'type') return this.type;
    return this.attributes[name] || null;
  }
  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'type') this.type = String(val);
    if (name === 'data-atlas-id') this.dataset.atlasId = String(val);
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30 };
  }
  focus() {}
  scrollIntoView() {}
  dispatchEvent() { return true; }
}

const body = new MockElement('body', 'body');
global.window = {
  location: { href: 'http://localhost/login' },
  addEventListener: () => {},
  removeEventListener: () => {},
  AtlasSidebar: {
    setStatus: () => {},
    setAutoHide: () => {},
  },
  AtlasSecretVault: {
    resolve: async (origin, token) => {
      if (token === '{password}') return 'secret123';
      return null;
    },
  },
};

global.document = {
  body: body,
  head: new MockElement('head', 'head'),
  createElement(tag) {
    return new MockElement(tag);
  },
  createTextNode(text) {
    return { nodeType: 3, textContent: text, children: [] };
  },
  getElementById(id) {
    function find(node) {
      if (!node) return null;
      if (node.id === id) return node;
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          const res = find(child);
          if (res) return res;
        }
      }
      return null;
    }
    return find(body);
  },
  querySelector(sel) {
    const attrMatch = sel.match(/\[data-atlas-id="([^"]+)"\]/);
    if (attrMatch) {
      const atlasId = attrMatch[1];
      function findAtlas(node) {
        if (!node) return null;
        if (typeof node.getAttribute === 'function' && node.getAttribute('data-atlas-id') === atlasId) return node;
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            const res = findAtlas(child);
            if (res) return res;
          }
        }
        return null;
      }
      return findAtlas(body);
    }
    if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
    return null;
  },
};

const AtlasExecutor = require('./executor.js');

async function runTests() {
  console.log('\n--- Running WS12 Lane E Round 2 Client Tests (R2-1) ---\n');

  // Helper to reset DOM body with a password input
  function setupPasswordInput(id = 'pwd-input') {
    body.children = [];
    const input = new MockElement('input', id);
    input.type = 'password';
    input.setAttribute('name', 'password');
    input.setAttribute('data-atlas-id', id);
    body.appendChild(input);
    return input;
  }

  // 1. Password fill with vault_login: true and value: "{password}" -> shows NO banner
  {
    const input = setupPasswordInput('test-pwd-1');
    const step = {
      action: 'fill',
      element_id: 'test-pwd-1',
      value: '{password}',
      vault_login: true,
      description: 'Fill password from vault',
    };

    const execPromise = AtlasExecutor.executeStep(step);
    // Give async guardrail check time to run
    await new Promise((r) => setTimeout(r, 20));

    const banner = document.getElementById('atlas-confirm-banner');
    record(
      'R2-1 (1): Password fill with vault_login true and token "{password}" shows NO banner',
      banner === null,
      banner ? 'Banner unexpectedly present' : ''
    );

    const res = await execPromise;
    record(
      'R2-1 (1b): Execution succeeds without waiting for user confirmation',
      res && res.ok === true && input.value === 'secret123',
      `Result: ${JSON.stringify(res)}, input.value: ${input.value}`
    );
  }

  // 2. The same fill WITHOUT vault_login -> STILL shows banner
  {
    const input = setupPasswordInput('test-pwd-2');
    const step = {
      action: 'fill',
      element_id: 'test-pwd-2',
      value: '{password}',
      vault_login: false,
      description: 'Fill password without vault_login',
    };

    const execPromise = AtlasExecutor.executeStep(step);
    await new Promise((r) => setTimeout(r, 20));

    const banner = document.getElementById('atlas-confirm-banner');
    record(
      'R2-1 (2): Password fill without vault_login STILL shows confirmation banner',
      banner !== null,
      'Banner was missing'
    );

    // Click confirm to resolve the promise cleanly
    const yesBtn = document.getElementById('atlas-confirm-yes');
    if (yesBtn && typeof yesBtn.onclick === 'function') {
      yesBtn.onclick();
    }
    const res = await execPromise;
    record(
      'R2-1 (2b): Action succeeds after user confirmation',
      res && res.ok === true && input.value === 'secret123',
      `Result: ${JSON.stringify(res)}, input.value: ${input.value}`
    );
  }

  // 3. vault_login: true with a plain (non-token) value -> STILL shows banner
  {
    const input = setupPasswordInput('test-pwd-3');
    const step = {
      action: 'fill',
      element_id: 'test-pwd-3',
      value: 'plain_secret_password',
      vault_login: true,
      description: 'Fill raw password with vault_login',
    };

    const execPromise = AtlasExecutor.executeStep(step);
    await new Promise((r) => setTimeout(r, 20));

    const banner = document.getElementById('atlas-confirm-banner');
    record(
      'R2-1 (3): vault_login true with plain (non-token) value STILL shows confirmation banner',
      banner !== null,
      'Banner was missing for non-token value'
    );

    // Click confirm to resolve the promise cleanly
    const yesBtn = document.getElementById('atlas-confirm-yes');
    if (yesBtn && typeof yesBtn.onclick === 'function') {
      yesBtn.onclick();
    }
    const res = await execPromise;
    record(
      'R2-1 (3b): Action succeeds after user confirmation',
      res && res.ok === true && input.value === 'plain_secret_password'
    );
  }

  console.log('\n======================================================');
  console.log(`WS12 Lane E Round 2 Summary: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

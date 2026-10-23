// client-script/test_executor_v2.js
// Acceptance test suite for Track 1h: executor.js new actions and batch execution

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

console.log('\n--- Running Track 1h Executor v2 Tests ---\n');

const executorSrc = fs.readFileSync(path.join(__dirname, 'executor.js'), 'utf8');

// 1. Static AST & Contract Inspection
test('executor.js supports all six new v2 action verbs', () => {
  assert(/case\s+['"]select_option['"]/.test(executorSrc), 'Must handle select_option action');
  assert(/case\s+['"]set_checkbox['"]/.test(executorSrc), 'Must handle set_checkbox action');
  assert(/case\s+['"]set_radio['"]/.test(executorSrc), 'Must handle set_radio action');
  assert(/case\s+['"]press_key['"]/.test(executorSrc), 'Must handle press_key action');
  assert(/case\s+['"]upload_file['"]/.test(executorSrc), 'Must handle upload_file action');
  assert(/case\s+['"]wait_for['"]/.test(executorSrc), 'Must handle wait_for action');
});

test('executor.js implements executeBatch with navigation early-exit', () => {
  assert(/executeBatch\s*=\s*async|async function executeBatch/.test(executorSrc), 'Must implement executeBatch');
  assert(/navigationPending/.test(executorSrc), 'Must check navigationPending');
  assert(/navigated:\s*true/.test(executorSrc) || /report\.navigated\s*=\s*true/.test(executorSrc), 'Must set navigated = true on pending navigation');
});

// 2. Functional Verification
const AtlasExecutor = require('./executor.js');

test('executorApi exports all new actions and helpers', () => {
  assert(typeof AtlasExecutor.executeBatch === 'function', 'executeBatch must be exported');
  assert(typeof AtlasExecutor.navigationPending === 'function', 'navigationPending must be exported');
  assert(typeof AtlasExecutor.doSelectOption === 'function', 'doSelectOption must be exported');
  assert(typeof AtlasExecutor.doSetCheckbox === 'function', 'doSetCheckbox must be exported');
  assert(typeof AtlasExecutor.doSetRadio === 'function', 'doSetRadio must be exported');
  assert(typeof AtlasExecutor.doPressKey === 'function', 'doPressKey must be exported');
  assert(typeof AtlasExecutor.doUploadFile === 'function', 'doUploadFile must be exported');
  assert(typeof AtlasExecutor.doWaitFor === 'function', 'doWaitFor must be exported');
  assert(typeof AtlasExecutor.waitForDomSettle === 'function', 'waitForDomSettle must be exported');
  assert(typeof AtlasExecutor.getLastActionResult === 'function', 'getLastActionResult must be exported');
});

test('doSetCheckbox is idempotent and toggles checked state', () => {
  let changeDispatched = 0;
  const mockCheckbox = {
    tagName: 'INPUT',
    type: 'checkbox',
    checked: false,
    hasAttribute: () => false,
    setAttribute: () => {},
    getAttribute: () => null,
    focus: () => {},
    classList: { add: () => {}, remove: () => {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
    dispatchEvent: (ev) => {
      if (ev.type === 'change') changeDispatched++;
    }
  };

  // Setting to true changes state and fires change
  AtlasExecutor.doSetCheckbox(mockCheckbox, 'true');
  assert.strictEqual(mockCheckbox.checked, true, 'Checkbox must be checked');
  assert.strictEqual(changeDispatched, 1, 'Change event must fire on toggle');

  // Setting to true AGAIN is idempotent (no second change event)
  AtlasExecutor.doSetCheckbox(mockCheckbox, true);
  assert.strictEqual(mockCheckbox.checked, true, 'Checkbox remains checked');
  assert.strictEqual(changeDispatched, 1, 'Idempotent: change event must NOT fire if already in target state');
});

test('doSelectOption sets value on select element', () => {
  let changeFired = false;
  const mockSelect = {
    tagName: 'SELECT',
    value: '',
    options: [
      { value: 'US', text: 'United States', label: 'United States' },
      { value: 'CA', text: 'Canada', label: 'Canada' },
    ],
    focus: () => {},
    classList: { add: () => {}, remove: () => {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }),
    dispatchEvent: (ev) => {
      if (ev.type === 'change') changeFired = true;
    }
  };

  AtlasExecutor.doSelectOption(mockSelect, 'Canada');
  assert.strictEqual(mockSelect.value, 'CA', 'Selected value must match option value by text');
  assert.strictEqual(changeFired, true, 'Change event must be dispatched on select');
});

// 3. WS11 Lane B: L3 & L11 Executor Tests
if (typeof global.PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } };
}
if (typeof global.MouseEvent === 'undefined') {
  global.MouseEvent = class MouseEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } };
}
if (typeof global.CSS === 'undefined') {
  global.CSS = { escape: (s) => s };
}

const asyncQueue = [];
function testAsync(name, fn) {
  asyncQueue.push(async () => {
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

test('L3 & B5: doClick with sameTab: true overrides target to _self during dispatch and restores original target afterwards', () => {
  let clickedTarget = null;
  global.window = {
    location: {
      href: 'http://localhost/origin',
    }
  };

  const mockLink = {
    tagName: 'A',
    href: 'http://localhost/target-page',
    target: '_blank',
    attrs: new Map([['target', '_blank'], ['href', 'http://localhost/target-page']]),
    focus: () => {},
    click: function() {
      clickedTarget = this.target;
      if (this.target === '_self') {
        global.window.location.href = this.href;
      }
    },
    classList: { add: () => {}, remove: () => {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 20 }),
    dispatchEvent: () => {},
    hasAttribute: function(k) { return this.attrs.has(k); },
    getAttribute: function(k) { return this.attrs.get(k) || null; },
    setAttribute: function(k, v) { this.attrs.set(k, String(v)); this[k] = v; },
    removeAttribute: function(k) { this.attrs.delete(k); this.target = ''; },
  };

  AtlasExecutor.doClick(mockLink, { sameTab: true });
  assert.strictEqual(clickedTarget, '_self', 'Target attribute was _self during click dispatch');
  assert.strictEqual(global.window.location.href, 'http://localhost/target-page', 'Navigates in same tab via target=_self click');
  assert.strictEqual(mockLink.target, '_blank', 'Target property must be restored to _blank after click');
  assert.strictEqual(mockLink.getAttribute('target'), '_blank', 'Target attribute must be restored to _blank after click');

  // Also test anchor with NO original target attribute
  let clickedNoTarget = null;
  const noTargetLink = {
    tagName: 'A',
    href: 'http://localhost/other-page',
    target: '',
    attrs: new Map([['href', 'http://localhost/other-page']]),
    focus: () => {},
    click: function() {
      clickedNoTarget = this.target;
    },
    classList: { add: () => {}, remove: () => {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 20 }),
    dispatchEvent: () => {},
    hasAttribute: function(k) { return this.attrs.has(k); },
    getAttribute: function(k) { return this.attrs.get(k) || null; },
    setAttribute: function(k, v) { this.attrs.set(k, String(v)); this[k] = v; },
    removeAttribute: function(k) { this.attrs.delete(k); this.target = ''; },
  };

  AtlasExecutor.doClick(noTargetLink, { sameTab: true });
  assert.strictEqual(clickedNoTarget, '_self', 'Target was _self during dispatch for link without target');
  assert.strictEqual(noTargetLink.hasAttribute('target'), false, 'Target attribute removed if originally absent');
});

testAsync('L11: execute returns structured change summary in result and getLastActionResult', async () => {
  global.window = {
    location: { href: 'http://localhost/test' },
  };
  global.document = {
    body: { innerText: 'Welcome' },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  global.AtlasSerializer = {
    serialize: () => [
      { id: 'el_1', tag: 'button', resolved_label: 'Click Me', role: 'button', visible: true }
    ],
    getElementByAtlasId: () => ({
      tagName: 'BUTTON',
      getAttribute: () => null,
      focus: () => {},
      click: () => {},
      classList: { add: () => {}, remove: () => {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 20 }),
      dispatchEvent: () => {},
    }),
    getActiveModalDialog: () => null,
    fnv1a64: () => 12345n,
  };
  global.window.AtlasSerializer = global.AtlasSerializer;

  const result = await AtlasExecutor.execute({
    status: 'ok',
    action: 'click',
    element_id: 'el_1',
    message: 'Clicked element',
  }, { skipConfirmation: true });

  assert.strictEqual(result.ok, true, 'Result ok is true');
  assert.strictEqual(typeof result.added_visible_count, 'number', 'added_visible_count is number');
  assert.strictEqual(typeof result.removed_visible_count, 'number', 'removed_visible_count is number');
  assert.strictEqual(typeof result.text_changed, 'boolean', 'text_changed is boolean');
  assert.strictEqual(typeof result.url_changed, 'boolean', 'url_changed is boolean');
  assert.strictEqual(typeof result.expanded_changed, 'boolean', 'expanded_changed is boolean');
  assert.strictEqual(typeof result.modal_opened, 'boolean', 'modal_opened is boolean');

  const lastResult = AtlasExecutor.getLastActionResult();
  assert.strictEqual(lastResult, result, 'getLastActionResult matches returned result');
});

testAsync('L11: waitForDomSettle skips wait immediately when navigation is pending', async () => {
  const start = Date.now();
  // Simulate navigation pending
  await AtlasExecutor.waitForDomSettle('http://localhost/diff-url', 1000, 2000);
  const elapsed = Date.now() - start;
  assert(elapsed < 200, `Must skip settle wait when URL changed (elapsed: ${elapsed}ms)`);
});

(async () => {
  for (const t of asyncQueue) {
    await t();
  }
  console.log(`\nTrack 1h Test Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
})();

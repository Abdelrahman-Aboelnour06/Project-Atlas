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

console.log(`\nTrack 1h Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

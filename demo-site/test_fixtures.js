// demo-site/test_fixtures.js
// Acceptance test suite for Track 1j Fixture Site

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DEMO_DIR = path.resolve(__dirname);

const REQUIRED_FILES = [
  'signup.html',
  'verify.html',
  'account.html',
  'timetable.html',
  'hostile-form.html',
  'slow.html',
  'healthcare-intake.html',
  'finance-statement.html',
  'statement-2026.csv',
  'checkout.html',
  'portal-modal-form.html',
  'portal-tiles.html',
  'frames-host.html',
];

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

console.log('\n--- Running Track 1j & E1 Fixture Site Tests ---\n');

REQUIRED_FILES.forEach(filename => {
  test(`File ${filename} exists`, () => {
    const fullPath = path.join(DEMO_DIR, filename);
    assert(fs.existsSync(fullPath), `Expected ${filename} to exist`);
  });
});

test('signup.html contains required fields and disabled submit button', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'signup.html'), 'utf8');
  assert(/type=["']email["']/i.test(content), 'email input required');
  assert(/type=["']password["']/i.test(content), 'password input required');
  assert(/name=["']confirm_password["']|id=["']confirm_password["']|confirm/i.test(content), 'confirm password required');
  assert(/name=["']full_name["']|name=["']name["']|Full Name/i.test(content), 'full name required');
  assert(/type=["']tel["']|name=["']phone["']/i.test(content), 'phone required');
  assert(/<select/i.test(content), '<select> dropdown required');
  assert(/type=["']checkbox["']/i.test(content), 'terms checkbox required');
  assert(/<button[^>]*disabled/i.test(content) || /disabled/i.test(content), 'submit button initially disabled');
  assert(/<a\s+href=/i.test(content), 'real <a href="..."> navigation required');
});

test('verify.html contains OTP input with autocomplete="one-time-code"', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'verify.html'), 'utf8');
  assert(/autocomplete=["']one-time-code["']/i.test(content), 'autocomplete="one-time-code" required');
  assert(/<button|<input type=["']submit["']/i.test(content), 'submit button required');
});

test('account.html contains welcome/signed in success indicators', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'account.html'), 'utf8');
  assert(/welcome|signed in|account/i.test(content), 'welcome/signed in text required');
});

test('timetable.html contains download-triggering element', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'timetable.html'), 'utf8');
  assert(/download/i.test(content), 'download attribute or trigger required');
});

test('hostile-form.html contains adversarial markup requirements', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'hostile-form.html'), 'utf8');
  // Two fields with exact same label text "Address"
  const addressMatches = content.match(/<label[^>]*>\s*Address\s*<\/label>/gi) || [];
  assert(addressMatches.length >= 2, 'Must have at least two fields with identical visible label "Address"');

  // Custom combobox with role="combobox" and role="listbox", without native select
  assert(/role=["']combobox["']/i.test(content), 'Must have role="combobox"');
  assert(/role=["']listbox["']/i.test(content), 'Must have role="listbox"');

  // Radio group sharing same name with no fieldset/legend
  assert(/type=["']radio["'][^>]*name=["']([^"']+)["']/i.test(content), 'Must have radio inputs with name');
  assert(!/<fieldset[^>]*>[\s\S]*?<legend/i.test(content), 'Radio group must not be wrapped in fieldset > legend');

  // Honeypot field hidden via display:none or visibility:hidden
  assert(/style=["'][^"']*(display:\s*none|visibility:\s*hidden)[^"']*["']/i.test(content) ||
         /class=["'][^"']*honeypot[^"']*["']/i.test(content), 'Must have honeypot field hidden via CSS');

  // Inline validation appearing after failed submit
  assert(/addEventListener\(["']submit["']/i.test(content) || /onsubmit/i.test(content), 'Must handle submit for validation');
});

test('slow.html renders main content via setTimeout ~1500ms', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'slow.html'), 'utf8');
  assert(/setTimeout\s*\([^,]+,\s*1500\)/i.test(content), 'Must have setTimeout with ~1500ms delay');
});

test('healthcare-intake.html contains sensitive PII, HIPAA consent, and disabled submit button', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'healthcare-intake.html'), 'utf8');
  assert(/id=["']patient-ssn["']|name=["']ssn["']/i.test(content), 'SSN input required');
  assert(/autocomplete=["']bday["']/i.test(content), 'DOB input with autocomplete="bday" required');
  assert(/type=["']email["']/i.test(content), 'Email input required');
  assert(/type=["']tel["']/i.test(content), 'Phone input required');
  assert(/id=["']consent-hipaa["']|name=["']consent_hipaa["']|name=["']hipaa_consent["']/i.test(content), 'HIPAA consent checkbox required');
  assert(/id=["']submit-intake-btn["'][^>]*disabled|disabled[^>]*id=["']submit-intake-btn["']/i.test(content), 'Submit button initially disabled');
});

test('healthcare-intake.html contains clinical triage, demographics, and HIPAA consent', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'healthcare-intake.html'), 'utf8');
  assert(/name=["']patient_id["']/i.test(content), 'patient_id input required');
  assert(/name=["']insurance_carrier["']/i.test(content), 'insurance_carrier select required');
  assert(/name=["']urgency["']/i.test(content), 'urgency radio chips required');
  assert(/name=["']hipaa_consent["']|name=["']consent_hipaa["']/i.test(content), 'hipaa consent required');
  assert(/confirmation-panel|intake-confirmation/i.test(content), 'confirmation alert panel required');
});

test('financial-reconciliation.html contains multi-entity ledger, transactions table, and attestation', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'financial-reconciliation.html'), 'utf8');
  assert(/id=["']transactions-table["']/i.test(content), 'transactions table required');
  assert(/id=["']auditor-token["']/i.test(content), 'auditor token input required');
  assert(/id=["']btn-commit-reconciliation["']/i.test(content), 'commit reconciliation button required');
  assert(/reconciliation-success/i.test(content), 'reconciliation success alert required');
});

test('ecommerce-checkout.html contains procurement cart, address inputs, and human confirmation modal', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'ecommerce-checkout.html'), 'utf8');
  assert(/id=["']shipping-address["']/i.test(content), 'shipping address required');
  assert(/id=["']card-token["']/i.test(content), 'payment card token input required');
  assert(/id=["']confirm-modal["']/i.test(content), 'human confirmation modal required');
  assert(/id=["']order-success["']/i.test(content), 'order success alert required');
});

test('finance-statement.html contains tabular ledger, filter controls, and CSV export link', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'finance-statement.html'), 'utf8');
  assert(/<th[^>]*scope=["']col["']/i.test(content) || /<th/i.test(content), 'Table headers required');
  assert(/id=["']filter-date-range["']/i.test(content), 'Date range filter required');
  assert(/id=["']filter-tx-category["']/i.test(content), 'Category filter required');
  assert(/download=["']statement-2026\.csv["']/i.test(content), 'CSV download link with statement-2026.csv required');
  assert(/id=["']download-statement-csv["']/i.test(content), 'id="download-statement-csv" required');
});

test('statement-2026.csv contains valid CSV header row and transaction records', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'statement-2026.csv'), 'utf8');
  const lines = content.trim().split('\n');
  assert(lines.length >= 6, 'Must contain header and transaction records');
  assert(lines[0].includes('Date') && lines[0].includes('Transaction ID') && lines[0].includes('Amount'), 'CSV header row required');
});

test('checkout.html contains cart breakdown, sensitive payment fields, and consequential button', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'checkout.html'), 'utf8');
  assert(/Total\s*\$95\.56|95\.56/i.test(content), 'Order grand total of $95.56 required');
  assert(/autocomplete=["']cc-number["']/i.test(content), 'Credit card input with autocomplete="cc-number" required');
  assert(/autocomplete=["']cc-csc["']/i.test(content), 'CVV input with autocomplete="cc-csc" required');
  assert(/id=["']pay-now-btn["']/i.test(content), 'id="pay-now-btn" required');
  assert(/Complete Payment|Place Order/i.test(content), 'Consequential payment button text required');
});

// ── WS11 Lane B: Behavioral Tests for New Fixtures ──────────────────────────
const vm = require('vm');

test('portal-modal-form.html: service card opens modal, submit renders confirmation inside modal', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'portal-modal-form.html'), 'utf8');
  assert(content.includes('pattern="[0-9]{14}"'), 'National ID pattern [0-9]{14} required');

  // Behavioral test: execute page scripts in synthetic DOM environment
  const listeners = new Map();
  const elements = {};

  class MockElement {
    constructor(id, tagName = 'div', attrs = {}) {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.attrs = new Map(Object.entries(attrs));
      this.innerHTML = '';
      this.value = '';
    }
    getAttribute(k) { return this.attrs.get(k) || null; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    removeAttribute(k) { this.attrs.delete(k); }
    hasAttribute(k) { return this.attrs.has(k); }
    addEventListener(event, fn) {
      if (!listeners.has(this)) listeners.set(this, new Map());
      const elMap = listeners.get(this);
      if (!elMap.has(event)) elMap.set(event, []);
      elMap.get(event).push(fn);
    }
    click() {
      const elMap = listeners.get(this);
      if (elMap && elMap.has('click')) {
        for (const fn of elMap.get('click')) fn({ type: 'click', target: this, preventDefault: () => {} });
      }
    }
    showModal() { this.setAttribute('open', ''); }
    close() { this.removeAttribute('open'); }
  }

  elements['service-modal'] = new MockElement('service-modal', 'dialog', { role: 'dialog', 'aria-modal': 'true' });
  elements['card-service-inquiry'] = new MockElement('card-service-inquiry', 'button');
  elements['btn-cancel-modal'] = new MockElement('btn-cancel-modal', 'button');
  elements['modal-form'] = new MockElement('modal-form', 'form');
  elements['input-national-id'] = new MockElement('input-national-id', 'input', { type: 'text', pattern: '[0-9]{14}' });
  elements['input-applicant-name'] = new MockElement('input-applicant-name', 'input', { type: 'text' });
  elements['modal-result-container'] = new MockElement('modal-result-container', 'div');

  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null,
    },
    console,
  };

  const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'portal-modal-form.html must contain <script>');
  vm.runInNewContext(scriptMatch[1], sandbox);

  // 1. Initially closed
  assert(!elements['service-modal'].hasAttribute('open'), 'Modal initially closed');

  // 2. Click service card -> opens modal
  elements['card-service-inquiry'].click();
  assert(elements['service-modal'].hasAttribute('open'), 'Clicking service card opens modal');

  // 3. Fill and submit form -> renders result inside modal
  elements['input-national-id'].value = '00000000000000';
  elements['input-applicant-name'].value = 'Citizen One';
  const formListeners = listeners.get(elements['modal-form'])?.get('submit') || [];
  for (const fn of formListeners) {
    fn({ preventDefault: () => {} });
  }
  assert(elements['modal-result-container'].innerHTML.includes('Citizen One'), 'Submit renders confirmation message inside modal');

  // 4. Cancel closes modal
  elements['btn-cancel-modal'].click();
  assert(!elements['service-modal'].hasAttribute('open'), 'Clicking cancel closes modal');
});

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

testAsync('portal-tiles.html: category tile swaps main panel content asynchronously with no URL change', async () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'portal-tiles.html'), 'utf8');

  const listeners = new Map();
  const elements = {};

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.innerHTML = '';
    }
    addEventListener(event, fn) {
      if (!listeners.has(this)) listeners.set(this, new Map());
      const elMap = listeners.get(this);
      if (!elMap.has(event)) elMap.set(event, []);
      elMap.get(event).push(fn);
    }
    click() {
      const elMap = listeners.get(this);
      if (elMap && elMap.has('click')) {
        for (const fn of elMap.get('click')) fn({ type: 'click', target: this });
      }
    }
  }

  elements['main-panel'] = new MockElement('main-panel', 'main');
  elements['main-panel'].innerHTML = '<div id="initial-panel-content">Initial Content</div>';
  elements['tile-vehicles'] = new MockElement('tile-vehicles', 'button');
  elements['tile-licenses'] = new MockElement('tile-licenses', 'button');
  elements['tile-records'] = new MockElement('tile-records', 'button');

  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null,
    },
    setTimeout,
    console,
  };

  const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'portal-tiles.html must contain <script>');
  vm.runInNewContext(scriptMatch[1], sandbox);

  // 1. Initial content present
  assert(elements['main-panel'].innerHTML.includes('Initial Content'), 'Initial panel content present');

  // 2. Click tile-vehicles -> content not swapped immediately (async swap)
  elements['tile-vehicles'].click();
  assert(elements['main-panel'].innerHTML.includes('Initial Content'), 'Content must not swap synchronously (0 ms)');

  // 3. Wait 450 ms -> content swapped asynchronously
  await new Promise((r) => setTimeout(r, 450));
  assert(elements['main-panel'].innerHTML.includes('Vehicle Violations'), 'After 400ms delay, main panel content is swapped');
  assert(elements['main-panel'].innerHTML.includes('btn-inquire-violations'), 'New action buttons appeared in swapped panel');
});

test('frames-host.html contains 2 same-origin iframes with child frame link targets', () => {
  const content = fs.readFileSync(path.join(DEMO_DIR, 'frames-host.html'), 'utf8');
  assert((content.match(/<iframe/gi) || []).length >= 2, 'frames-host.html must embed at least 2 iframes');

  const f1Path = path.join(DEMO_DIR, 'frame-child-1.html');
  const f2Path = path.join(DEMO_DIR, 'frame-child-2.html');
  assert(fs.existsSync(f1Path), 'frame-child-1.html must exist');
  assert(fs.existsSync(f2Path), 'frame-child-2.html must exist');

  const f1 = fs.readFileSync(f1Path, 'utf8');
  const f2 = fs.readFileSync(f2Path, 'utf8');
  assert((f1.match(/<a\b[^>]*href/gi) || []).length >= 2, 'Frame 1 must contain links');
  assert((f2.match(/<a\b[^>]*href/gi) || []).length >= 2, 'Frame 2 must contain links');
});

(async () => {
  for (const t of asyncQueue) {
    await t();
  }
  console.log(`\nDemo Site Fixture & E1 Test Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
})();

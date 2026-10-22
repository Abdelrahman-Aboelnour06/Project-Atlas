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
  'checkout.html'
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
  assert(/id=["']consent-hipaa["']|name=["']consent_hipaa["']/i.test(content), 'HIPAA consent checkbox required');
  assert(/id=["']submit-intake-btn["'][^>]*disabled|disabled[^>]*id=["']submit-intake-btn["']/i.test(content), 'Submit button initially disabled');
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

console.log(`\nTrack 1j & E1 Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

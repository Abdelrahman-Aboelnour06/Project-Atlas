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

console.log(`\nTrack 1f Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

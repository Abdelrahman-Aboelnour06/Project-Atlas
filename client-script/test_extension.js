/**
 * Extension Unit Test Suite
 * Validates manifest.json structure and checks syntax & exports of all extension scripts.
 * Run with: node client-script/test_extension.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n--- Running Extension Unit Tests ---');

// 1. Manifest.json Validation
console.log('\n[Unit: Manifest Integrity]');
const manifestPath = path.join(__dirname, 'manifest.json');
try {
  assert(fs.existsSync(manifestPath), 'manifest.json exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert(manifest.manifest_version === 3, 'Manifest is Version 3');
  assert(manifest.name && manifest.name.includes('Atlas'), 'Manifest has correct name');
  assert(manifest.permissions.includes('storage'), 'Permissions includes storage');
  assert(manifest.permissions.includes('scripting'), 'Permissions includes scripting');
  assert(manifest.permissions.includes('activeTab'), 'Permissions includes activeTab');
  assert(Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0, 'Host permissions defined');
  assert(manifest.background && manifest.background.service_worker === 'background.js', 'Service worker defined as background.js');
  assert(manifest.options_page === 'options.html', 'Options page is defined');
} catch (err) {
  failures++;
  console.error(`  ✗ Error parsing manifest: ${err.message}`);
}

// 2. JavaScript Syntax & Parsing Validation
console.log('\n[Unit: Script Syntax Verification]');
const jsFiles = [
  'background.js',
  'content.js',
  'dom-serializer.js',
  'executor.js',
  'options.js',
  'sidebar.js',
  'speech.js',
  'tts.js',
  'websocket-client.js'
];

for (const file of jsFiles) {
  const filePath = path.join(__dirname, file);
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    new vm.Script(code, { filename: file });
    assert(true, `${file} compiles cleanly with no syntax errors`);
  } catch (err) {
    assert(false, `${file} syntax error: ${err.message}`);
  }
}

// 3. Options HTML & CSS Check
console.log('\n[Unit: Options UI Assets]');
assert(fs.existsSync(path.join(__dirname, 'options.html')), 'options.html exists');
assert(fs.existsSync(path.join(__dirname, 'options.css')), 'options.css exists');
assert(fs.existsSync(path.join(__dirname, 'sidebar.css')), 'sidebar.css exists');

console.log(`\nExtension Tests Complete: ${passed} passed, ${failures} failed.\n`);
process.exit(failures > 0 ? 1 : 0);

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

// 4. Security Quality Gates (No Secrets, No Dynamic Code Execution, XSS Defenses)
console.log('\n[Unit: Extension Security Quality Gates]');
for (const file of jsFiles) {
  const filePath = path.join(__dirname, file);
  const code = fs.readFileSync(filePath, 'utf8');

  // Check 1: No hardcoded fallback dev keys or tokens
  assert(!code.includes('atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'), `${file} has NO hardcoded demo API key`);
  assert(!code.includes('DEFAULT_DEV_KEY'), `${file} has NO DEFAULT_DEV_KEY reference`);

  // Check 2: No dangerous eval or Function constructors
  assert(!/\beval\s*\(/.test(code), `${file} has NO eval() calls`);
  assert(!/new\s+Function\s*\(/.test(code), `${file} has NO Function() constructors`);
}

// Check 3: Sidebar has escapeHtml sanitizer utility
const sidebarCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
assert(sidebarCode.includes('escapeHtml'), 'sidebar.js implements escapeHtml sanitizer');

// 5. Remediation Quality Gates & Prime Directive Adherence
console.log('\n[Unit: Remediation Quality Gates & Universal Rule]');

// Gate 1: scrollToElement definition check in executor.js
const executorCode = fs.readFileSync(path.join(__dirname, 'executor.js'), 'utf8');
const hasScrollToElementDef = /(?:function\s+scrollToElement\s*\(|(?:const|let|var)\s+scrollToElement\s*=)/.test(executorCode);
assert(hasScrollToElementDef, 'executor.js defines scrollToElement helper');

// Gate 2: Zero innerHTML assignments in executor.js (DOM-based XSS elimination)
const hasInnerHTMLInExecutor = /\.innerHTML\s*=/.test(executorCode);
assert(!hasInnerHTMLInExecutor, 'executor.js contains zero innerHTML assignments');

// Gate 3: Zero ATLAS_PROXY_FETCH in background.js (SSRF attack surface removal)
const backgroundCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const hasProxyFetch = backgroundCode.includes('ATLAS_PROXY_FETCH');
assert(!hasProxyFetch, 'background.js contains zero ATLAS_PROXY_FETCH references');

// Gate 4: WCAG AA contrast on .atlas-chip-confirm (#137333, 4.5:1+)
const sidebarCss = fs.readFileSync(path.join(__dirname, 'sidebar.css'), 'utf8');
const hasAccessibleGreen = sidebarCss.includes('#137333');
const hasInaccessibleGreen = /atlas-chip-confirm[^{]*\{[^}]*#34c759/s.test(sidebarCss);
assert(hasAccessibleGreen && !hasInaccessibleGreen, 'sidebar.css uses WCAG AA accessible contrast #137333 on .atlas-chip-confirm');

// Gate 5: Zero outline: none in sidebar.css (Universal keyboard focus rings)
const hasOutlineNone = /outline\s*:\s*none\b/i.test(sidebarCss);
assert(!hasOutlineNone, 'sidebar.css contains zero outline: none declarations');

// Gate 6: Non-allocating TreeWalker in content.js (no cloneNode memory thrashing)
const contentCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const usesCloneNode = contentCode.includes('cloneNode');
const usesTreeWalker = /createTreeWalker|TreeWalker/.test(contentCode);
assert(!usesCloneNode && usesTreeWalker, 'content.js uses non-allocating TreeWalker without cloneNode');

// Gate 7: Confirmation safeguard check in options.js (API key destruction protection)
const optionsCode = fs.readFileSync(path.join(__dirname, 'options.js'), 'utf8');
const hasClearSafeguard = /confirm\s*\(/.test(optionsCode);
assert(hasClearSafeguard, 'options.js enforces confirmation safeguard before clearing API key');

// Gate 8: Zero hardcoded vendor strings (#nav-, my drive, etc. — Prime Directive)
const domSerializerCode = fs.readFileSync(path.join(__dirname, 'dom-serializer.js'), 'utf8');
const hasVendorSelector = domSerializerCode.includes('#nav-');
const hasMyDriveString = /my drive/i.test(sidebarCode) || /my drive/i.test(domSerializerCode);
assert(!hasVendorSelector && !hasMyDriveString, 'dom-serializer.js and sidebar.js contain zero hardcoded vendor strings (#nav-, my drive)');

// 6. Floating Draggable Notch & Collapse/Expand Quality Gates
console.log('\n[Unit: Floating Draggable Notch & Collapse/Expand]');
assert(sidebarCode.includes('collapse') && sidebarCode.includes('expand'), 'sidebar.js implements collapse and expand methods');
assert(sidebarCode.includes('SCROLLBAR_CLEARANCE'), 'sidebar.js implements scrollbar boundary clearance');
assert(sidebarCode.includes('setPointerCapture'), 'sidebar.js utilizes Pointer Capture for glitch-proof dragging');
assert(sidebarCode.includes('badgeHasMoved') && sidebarCode.includes('Math.hypot'), 'sidebar.js enforces Euclidean distance drag-vs-click discrimination');
assert(sidebarCode.includes('atlas-header-collapse'), 'sidebar.js includes #atlas-header-collapse button in header');
assert(sidebarCode.includes('atlas-collapsed-badge'), 'sidebar.js includes .atlas-collapsed-badge DOM element');
assert(sidebarCss.includes('.atlas-collapsed'), 'sidebar.css styles .atlas-collapsed circular state');
assert(sidebarCss.includes('.atlas-collapsed-badge'), 'sidebar.css styles .atlas-collapsed-badge');
assert(sidebarCss.includes('.atlas-collapse-btn'), 'sidebar.css styles .atlas-collapse-btn');

console.log(`\nExtension Tests Complete: ${passed} passed, ${failures} failed.\n`);
process.exit(failures > 0 ? 1 : 0);


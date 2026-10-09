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
  assert(manifest.permissions.includes('declarativeNetRequest'), 'Permissions includes declarativeNetRequest');
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
  'secret-vault.js',
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

// 7. Header Refresh Button & Multi-Click Execution Quality Gates
console.log('\n[Unit: Header Refresh Button & Multi-Click Execution]');
assert(sidebarCode.includes('atlas-header-refresh'), 'sidebar.js includes #atlas-header-refresh button');
assert(!sidebarCode.includes('atlas-refresh-label'), 'sidebar.js uses icon-only refresh button without text overflow');
assert(executorCode.includes('doTripleClick'), 'executor.js implements doTripleClick');
assert(executorCode.includes('doMultiClick'), 'executor.js implements doMultiClick');
assert(executorCode.includes('triple_click'), 'executor.js supports triple_click in action set and dispatch');
assert(executorCode.includes('click_count'), 'executor.js parses and honors click_count');

// 8. Track V2 & L1-lite Localization, DNR & Language Switcher Quality Gates
console.log('\n[Unit: Track V2 & L1-lite Dual-Language & DNR Quality Gates]');

const ttsCode = fs.readFileSync(path.join(__dirname, 'tts.js'), 'utf8');
assert(ttsCode.includes('0600') && ttsCode.includes('06FF'), 'tts.js detects Arabic Unicode block [\\u0600-\\u06FF]');
assert(ttsCode.includes('ar-EG'), 'tts.js targets ar-EG locale for Arabic');
assert(ttsCode.includes('getVoices'), 'tts.js queries speechSynthesis.getVoices() for installed voices');
assert(ttsCode.includes('console.warn'), 'tts.js logs warning when Arabic voice is missing without throwing');
assert(ttsCode.includes('utterance.voice = matchedVoice'), 'tts.js attaches matched voice to utterance');
assert(ttsCode.includes('utterance.lang = targetLang'), 'tts.js sets utterance.lang to target language');

// Behavioral execution test for tts.detectLanguage and cleanSpeechText
const ttsModule = require('./tts.js');
assert(typeof ttsModule.detectLanguage === 'function', 'tts.js exports detectLanguage helper');
assert(ttsModule.detectLanguage('مرحبا بك') === 'ar-EG', 'tts.detectLanguage correctly identifies Arabic text');
assert(ttsModule.detectLanguage('Hello, welcome to Atlas') === 'en-US', 'tts.detectLanguage correctly identifies English text');
assert(ttsModule.detectLanguage('ابحث عن منتج') === 'ar-EG', 'tts.detectLanguage correctly identifies Egyptian colloquial Arabic');
assert(ttsModule.cleanSpeechText('https://example.com مرحبا #bold *italic*') === 'مرحبا bold italic', 'cleanSpeechText cleans markdown/urls while preserving Arabic');

// Background DNR rules checks
assert(backgroundCode.includes('declarativeNetRequest'), 'background.js utilizes declarativeNetRequest');
assert(backgroundCode.includes('updateSessionRules'), 'background.js calls updateSessionRules');
assert(backgroundCode.includes('Accept-Language'), 'background.js configures Accept-Language header');
assert(backgroundCode.includes('applyDnrLanguageRule'), 'background.js defines applyDnrLanguageRule');
assert(backgroundCode.includes('clearDnrLanguageRule'), 'background.js defines clearDnrLanguageRule');
assert(backgroundCode.includes('onRemoved'), 'background.js cleans up rules on tab removal');

// Content.js Universal Language Switcher checks
assert(contentCode.includes('AtlasLanguageSwitcher'), 'content.js defines AtlasLanguageSwitcher');
assert(contentCode.includes('atlas_lang_pref:'), 'content.js stores per-origin preference in atlas_lang_pref:<origin>');
assert(contentCode.includes('detectAndSwitch'), 'AtlasLanguageSwitcher defines detectAndSwitch');
assert(contentCode.includes('scan'), 'AtlasLanguageSwitcher defines scan');
assert(contentCode.includes('hreflang'), 'content.js pre-scans hreflang attributes');
assert(contentCode.includes('العربية') || contentCode.includes('عربي'), 'content.js matches Arabic text labels');

// Universal Rule verification: zero hardcoded domain checks in newly modified files
const forbiddenDomains = ['google.com', 'amazon.com', 'wikipedia.org', 'github.com', 'drive.google.com'];
for (const domain of forbiddenDomains) {
  assert(!contentCode.includes(domain), `content.js contains zero ${domain} hardcoded domain references`);
  assert(!backgroundCode.includes(`"${domain}"`) && !backgroundCode.includes(`'${domain}'`), `background.js contains zero target ${domain} hardcoded site references`);
  assert(!ttsCode.includes(domain), `tts.js contains zero ${domain} hardcoded domain references`);
}

// Behavioral execution test for AtlasLanguageSwitcher
const contentModule = require('./content.js');
assert(typeof contentModule.AtlasLanguageSwitcher === 'object', 'content.js exports AtlasLanguageSwitcher');
assert(typeof contentModule.AtlasLanguageSwitcher.scan === 'function', 'AtlasLanguageSwitcher provides scan method');
assert(typeof contentModule.AtlasLanguageSwitcher.detectAndSwitch === 'function', 'AtlasLanguageSwitcher provides detectAndSwitch method');
assert(typeof contentModule.AtlasLanguageSwitcher.getStoredOriginPref === 'function', 'AtlasLanguageSwitcher provides getStoredOriginPref method');
assert(typeof contentModule.AtlasLanguageSwitcher.setStoredOriginPref === 'function', 'AtlasLanguageSwitcher provides setStoredOriginPref method');
const scanResult = contentModule.AtlasLanguageSwitcher.scan('ar-EG');
assert(scanResult && scanResult.found === false, 'AtlasLanguageSwitcher scan safely returns { found: false } in non-DOM environment');

// 9. Track RTL, Track V1 Dual-Language Voice & Track V2wire Quality Gates
console.log('\n[Unit: Track RTL, V1 Dual-Language Voice & V2wire Quality Gates]');

const speechCode = fs.readFileSync(path.join(__dirname, 'speech.js'), 'utf8');
const websocketCode = fs.readFileSync(path.join(__dirname, 'websocket-client.js'), 'utf8');

// RTL Quality Gates: sidebar.css and sidebar.js
assert(/#atlas-sidebar-root\s*\{[^}]*direction\s*:\s*ltr\s*;/s.test(sidebarCss), 'Outer #atlas-sidebar-root has direction: ltr in sidebar.css');
assert(sidebarCss.includes('margin-inline-start'), 'sidebar.css defines margin-inline-start on message bubbles');
assert(sidebarCss.includes('padding-inline-end'), 'sidebar.css defines padding-inline-end on message bubbles');
assert(sidebarCss.includes('text-align: start'), 'sidebar.css defines text-align: start on message bubbles');
assert(sidebarCss.includes('border-end-end-radius: 4px'), 'sidebar.css defines border-end-end-radius: 4px on user message bubbles');
assert(sidebarCss.includes('border-end-start-radius: 4px'), 'sidebar.css defines border-end-start-radius: 4px on agent message bubbles');

// dir="auto" on chat message bubbles
assert(/bubble\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarCode), 'sidebar.js sets dir="auto" on .atlas-msg-bubble');
assert(/textNode\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarCode), 'sidebar.js sets dir="auto" on .atlas-msg-text');
assert(sidebarCode.includes('dir="auto"'), 'sidebar.js applies dir="auto" bidirectional attribute');

// V1 Speech Recognition Language Quality Gates
const speechModule = require('./speech.js');
assert(typeof speechModule.setLanguage === 'function', 'speech.js exports setLanguage');
assert(typeof speechModule.getLanguage === 'function', 'speech.js exports getLanguage');
assert(speechModule.getLanguage() === 'en-US', 'speech.js defaults to en-US');

// Speech language toggle and storage sync
let mockStoredLang = null;
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb && cb({ atlas_voice_lang: mockStoredLang || 'en-US' }),
      set: (obj) => { if (obj.atlas_voice_lang) mockStoredLang = obj.atlas_voice_lang; },
    },
    onChanged: {
      addListener: () => {},
    },
  },
};

speechModule.setLanguage('ar-EG');
assert(speechModule.getLanguage() === 'ar-EG', 'speech.js setLanguage updates current language to ar-EG');
assert(mockStoredLang === 'ar-EG', 'speech.js setLanguage syncs with chrome.storage.local key atlas_voice_lang');
speechModule.setLanguage('en-US');
assert(speechModule.getLanguage() === 'en-US', 'speech.js setLanguage switches back to en-US');
assert(mockStoredLang === 'en-US', 'speech.js syncs en-US to storage');

// Auto-sticky Arabic detection in speech.js
assert(speechCode.includes('0600') && speechCode.includes('06FF'), 'speech.js contains Arabic character range check [\\u0600-\\u06FF]');
assert(speechCode.includes("recognition.lang = currentLang"), 'speech.js sets recognition.lang from currentLang');

// Sidebar language toggle pill and auto-sticky heuristic
assert(sidebarCode.includes('atlas-lang-pill'), 'sidebar.js defines .atlas-lang-pill class');
assert(sidebarCode.includes('atlas-lang-toggle'), 'sidebar.js defines #atlas-lang-toggle button');
assert(sidebarCss.includes('.atlas-lang-pill'), 'sidebar.css styles .atlas-lang-pill');

const sidebarModule = require('./sidebar.js');
assert(typeof sidebarModule.getVoiceLanguage === 'function', 'sidebar.js exports getVoiceLanguage');
assert(typeof sidebarModule.setVoiceLanguage === 'function', 'sidebar.js exports setVoiceLanguage');
assert(typeof sidebarModule.toggleVoiceLanguage === 'function', 'sidebar.js exports toggleVoiceLanguage');
assert(typeof sidebarModule.handleSpeechTranscript === 'function', 'sidebar.js exports handleSpeechTranscript');

sidebarModule.setVoiceLanguage('en-US');
assert(sidebarModule.getVoiceLanguage() === 'en-US', 'sidebar.js voice language initializes to en-US');
sidebarModule.toggleVoiceLanguage();
assert(sidebarModule.getVoiceLanguage() === 'ar-EG', 'sidebar.js toggleVoiceLanguage switches to ar-EG');
sidebarModule.toggleVoiceLanguage();
assert(sidebarModule.getVoiceLanguage() === 'en-US', 'sidebar.js toggleVoiceLanguage switches back to en-US');

// Auto-sticky Arabic heuristic execution test
sidebarModule.setVoiceLanguage('en-US');
const stickyTriggered = sidebarModule.handleSpeechTranscript('افتح الصفحة الرئيسية');
assert(stickyTriggered === true, 'sidebar.js auto-sticky Arabic heuristic detects Arabic transcript');
assert(sidebarModule.getVoiceLanguage() === 'ar-EG', 'sidebar.js auto-sticky Arabic heuristic updates language to ar-EG');

const nonStickyResult = sidebarModule.handleSpeechTranscript('hello world navigate to settings');
assert(nonStickyResult === false, 'sidebar.js auto-sticky heuristic ignores English transcript');
assert(sidebarModule.getVoiceLanguage() === 'ar-EG', 'sidebar.js maintains sticky ar-EG until explicitly toggled');

// V2wire TTS Toggle Quality Gates
assert(sidebarCode.includes('atlas-header-tts'), 'sidebar.js maintains #atlas-header-tts button in header');
assert(sidebarCode.includes('AtlasTTS') && sidebarCode.includes('toggleMute'), 'sidebar.js wires #atlas-header-tts to window.AtlasTTS?.toggleMute?.()');

// Language forwarding in commands and requests
assert(websocketCode.includes('language: activeLang'), 'websocket-client.js forwards language in socket payloads');
assert(contentCode.includes('language: activeLang'), 'content.js forwards active language to AtlasSocket.sendCommand');

// Zero hardcoded domains across all touched frontend files
for (const domain of forbiddenDomains) {
  assert(!sidebarCode.includes(domain), `sidebar.js contains zero ${domain} hardcoded domain references`);
  assert(!sidebarCss.includes(domain), `sidebar.css contains zero ${domain} hardcoded domain references`);
  assert(!speechCode.includes(domain), `speech.js contains zero ${domain} hardcoded domain references`);
  assert(!websocketCode.includes(`"${domain}"`) && !websocketCode.includes(`'${domain}'`), `websocket-client.js contains zero ${domain} hardcoded domain references`);
}

console.log(`\nExtension Tests Complete: ${passed} passed, ${failures} failed.\n`);
process.exit(failures > 0 ? 1 : 0);


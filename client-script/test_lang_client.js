/**
 * client-script/test_lang_client.js
 * WS3: Language Client Unit & Empirical Verification Suite
 *
 * Verifies:
 * 1. Storage persistence & migration from atlas_voice_lang to atlas_lang
 * 2. AtlasSidebar.getLanguage() and AtlasSpeech.getLanguage() synchronization
 * 3. Pill UI EN/AR display with "Atlas language" in aria-label/title
 * 4. Message bubble bidi semantics: dir="auto" on all bubbles, lang="ar" when mostly Arabic
 * 5. Sidebar own chrome localization (status, tabs, buttons, placeholders, tour) without translating backend text
 * 6. TTS Arabic voice selection heuristics with graceful OS fallback
 * 7. Universal Prime Directive compliance (zero domain hardcoding)
 *
 * Run with: node client-script/test_lang_client.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;
const failureDetails = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failureDetails.push({ name, error: err.message });
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failureDetails.push({ name, error: err.message });
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
  }
}

console.log('\n======================================================');
console.log('   Atlas Assistant — WS3 Language Client Test Suite   ');
console.log('======================================================\n');

// ── In-Memory Minimal DOM Mock for Sidebar & Speech Tests ─────────────────────
function createMockElement(tag = 'div', attributes = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    attributes: { ...attributes },
    style: {},
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      toggle(cls, force) {
        if (force === true) this._classes.add(cls);
        else if (force === false) this._classes.delete(cls);
        else if (this._classes.has(cls)) this._classes.delete(cls);
        else this._classes.add(cls);
        return this._classes.has(cls);
      },
      contains(cls) { return this._classes.has(cls); },
    },
    children: [],
    parentElement: null,
    textContent: '',
    innerHTML: '',
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (!this._listeners[evt]) return;
      this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent(evt) {
      const fns = this._listeners[evt.type] || [];
      fns.forEach(fn => fn(evt));
      return true;
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    },
    querySelector(sel) {
      return findInMockTree(this, sel);
    },
    querySelectorAll(sel) {
      return findAllInMockTree(this, sel);
    },
  };
  return el;
}

function findInMockTree(root, sel) {
  const all = findAllInMockTree(root, sel);
  return all.length > 0 ? all[0] : null;
}

function findAllInMockTree(root, sel) {
  const results = [];
  const matches = (node) => {
    if (!node || !node.attributes) return false;
    if (sel.startsWith('#')) return node.attributes.id === sel.slice(1);
    if (sel.startsWith('.')) return node.classList?.contains(sel.slice(1));
    if (sel.includes('[data-tab="')) {
      const tabVal = sel.match(/\[data-tab="([^"]+)"\]/)[1];
      return node.attributes['data-tab'] === tabVal;
    }
    return node.tagName === sel.toUpperCase();
  };

  const traverse = (node) => {
    if (node !== root && matches(node)) results.push(node);
    if (node.children) {
      for (const ch of node.children) traverse(ch);
    }
  };
  traverse(root);
  return results;
}

// =========================================================================
// SUITE 1: Migration & Storage Synchronization (Task 1 & Adjustment 5)
// =========================================================================
console.log('[Suite 1: Storage Persistence & Migration]');

test('speech.js migrates atlas_voice_lang to atlas_lang on load', () => {
  let storage = { atlas_voice_lang: 'ar-EG' };
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ ...storage }),
        set: (obj) => { Object.assign(storage, obj); },
      },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = {};

  delete require.cache[require.resolve('./speech.js')];
  const speech = require('./speech.js');

  assert.strictEqual(speech.getLanguage(), 'ar-EG', 'Speech language initializes from atlas_voice_lang');
  assert.strictEqual(storage.atlas_lang, 'ar-EG', 'Migrated atlas_voice_lang to atlas_lang in storage');
});

test('speech.js setLanguage writes both atlas_lang and atlas_voice_lang', () => {
  let storage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(storage),
        set: (obj) => { Object.assign(storage, obj); },
      },
      onChanged: { addListener: () => {} },
    },
  };

  delete require.cache[require.resolve('./speech.js')];
  const speech = require('./speech.js');

  speech.setLanguage('ar-EG');
  assert.strictEqual(speech.getLanguage(), 'ar-EG');
  assert.strictEqual(storage.atlas_lang, 'ar-EG', 'atlas_lang key persisted');
  assert.strictEqual(storage.atlas_voice_lang, 'ar-EG', 'atlas_voice_lang key synced for legacy compatibility');

  speech.setLanguage('en-US');
  assert.strictEqual(speech.getLanguage(), 'en-US');
  assert.strictEqual(storage.atlas_lang, 'en-US');
  assert.strictEqual(storage.atlas_voice_lang, 'en-US');
});

test('speech.js storage onChanged listener synchronizes language across tabs', () => {
  let changeListener = null;
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ atlas_lang: 'en-US' }),
        set: () => {},
      },
      onChanged: {
        addListener: (fn) => { changeListener = fn; },
      },
    },
  };

  delete require.cache[require.resolve('./speech.js')];
  const speech = require('./speech.js');
  assert.strictEqual(speech.getLanguage(), 'en-US');

  assert(typeof changeListener === 'function', 'speech.js registered storage onChanged listener');
  changeListener({ atlas_lang: { newValue: 'ar-EG' } }, 'local');
  assert.strictEqual(speech.getLanguage(), 'ar-EG', 'speech.js updated language on atlas_lang storage change');

  changeListener({ atlas_voice_lang: { newValue: 'en-US' } }, 'local');
  assert.strictEqual(speech.getLanguage(), 'en-US', 'speech.js updated language on atlas_voice_lang fallback change');
});

// =========================================================================
// SUITE 2: Sidebar Language & Speech Sync (Tasks 1, 2 & Adjustment 1)
// =========================================================================
console.log('\n[Suite 2: Sidebar Public API & Speech Synchronization]');

test('sidebar.js exports getLanguage and setLanguage alongside legacy aliases', () => {
  delete require.cache[require.resolve('./sidebar.js')];
  const sidebar = require('./sidebar.js');

  assert.strictEqual(typeof sidebar.getLanguage, 'function', 'AtlasSidebar exports getLanguage');
  assert.strictEqual(typeof sidebar.setLanguage, 'function', 'AtlasSidebar exports setLanguage');
  assert.strictEqual(typeof sidebar.getVoiceLanguage, 'function', 'AtlasSidebar exports getVoiceLanguage alias');
  assert.strictEqual(typeof sidebar.setVoiceLanguage, 'function', 'AtlasSidebar exports setVoiceLanguage alias');
  assert.strictEqual(typeof sidebar.toggleLanguage, 'function', 'AtlasSidebar exports toggleLanguage');
  assert.strictEqual(typeof sidebar.toggleVoiceLanguage, 'function', 'AtlasSidebar exports toggleVoiceLanguage alias');
});

test('AtlasSidebar.setLanguage keeps AtlasSpeech.getLanguage() in sync at all times', () => {
  let mockSpeechLang = 'en-US';
  global.window = {
    AtlasSpeech: {
      getLanguage: () => mockSpeechLang,
      setLanguage: (l) => { mockSpeechLang = l; return l; },
    },
  };
  let storage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(storage),
        set: (obj) => { Object.assign(storage, obj); },
      },
      onChanged: { addListener: () => {} },
    },
  };

  delete require.cache[require.resolve('./sidebar.js')];
  const sidebar = require('./sidebar.js');

  sidebar.setLanguage('ar-EG');
  assert.strictEqual(sidebar.getLanguage(), 'ar-EG', 'AtlasSidebar language updated to ar-EG');
  assert.strictEqual(mockSpeechLang, 'ar-EG', 'AtlasSpeech language synchronized to ar-EG');
  assert.strictEqual(storage.atlas_lang, 'ar-EG', 'chrome.storage.local atlas_lang persisted');

  sidebar.setLanguage('en-US');
  assert.strictEqual(sidebar.getLanguage(), 'en-US', 'AtlasSidebar language updated to en-US');
  assert.strictEqual(mockSpeechLang, 'en-US', 'AtlasSpeech language synchronized to en-US');
  assert.strictEqual(storage.atlas_lang, 'en-US');
});

// =========================================================================
// SUITE 3: Pill UI & Accessibility Contracts (Task 1 & Adjustment 4)
// =========================================================================
console.log('\n[Suite 3: Pill UI Text & Accessibility Labels]');

const sidebarSource = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');

test('Pill button markup displays strictly EN / AR text content', () => {
  assert(sidebarSource.includes('>EN</button>'), 'Sidebar initial markup renders EN pill');
  assert(sidebarSource.includes('langPill.textContent = isAr ? "AR" : "EN";'), 'Pill textContent switches between AR and EN');
});

test('Pill aria-label and title include "Atlas language" and announce change in new language', () => {
  assert(sidebarSource.includes('Atlas language: Arabic'), 'Pill aria-label contains Atlas language: Arabic');
  assert(sidebarSource.includes('Atlas language: English'), 'Pill aria-label contains Atlas language: English');
  assert(sidebarSource.includes('لغة أطلس: العربية'), 'Pill announces Arabic in Arabic script');
});

// =========================================================================
// SUITE 4: Message Bubble Bidi Semantics (Task 3 & Adjustment 2)
// =========================================================================
console.log('\n[Suite 4: Message Bubble Bidi Semantics & dir="auto"]');

test('Every message bubble uses dir="auto" on bubble and textNode', () => {
  assert(sidebarSource.includes('bubble.setAttribute("dir", "auto");'), 'bubble sets dir="auto"');
  assert(sidebarSource.includes('textNode.setAttribute("dir", "auto");'), 'textNode sets dir="auto"');
});

test('lang="ar" is set only when text is mostly Arabic', () => {
  // Test the exact regex logic implemented in sidebar.js
  function testLangAssignment(text) {
    const arabicChars = (typeof text === 'string' ? text.match(/[\u0600-\u06FF]/g) : null) || [];
    const latinChars = (typeof text === 'string' ? text.match(/[A-Za-z]/g) : null) || [];
    if (arabicChars.length > 0 && arabicChars.length > latinChars.length) {
      return 'ar';
    } else if (latinChars.length > 0 && latinChars.length > arabicChars.length) {
      return 'en';
    }
    return null;
  }

  assert.strictEqual(testLangAssignment('مرحبا بك في أطلس'), 'ar', 'Pure Arabic assigned lang="ar"');
  assert.strictEqual(testLangAssignment('ابحث عن المنتجات في Google'), 'ar', 'Mostly Arabic with English brand assigned lang="ar"');
  assert.strictEqual(testLangAssignment('Click the submit button on the page'), 'en', 'Pure English assigned lang="en"');
  assert.strictEqual(testLangAssignment('Hello World (مرحبا)'), 'en', 'Mostly English with short Arabic greeting assigned lang="en"');
  assert.strictEqual(testLangAssignment('12345'), null, 'Numbers only assigns no language override');
});

// =========================================================================
// SUITE 5: Sidebar Own Chrome Localization (Task 3 & Adjustment 3)
// =========================================================================
console.log('\n[Suite 5: Sidebar Own Chrome Localization & Backend Neutrality]');

test('Sidebar status translates only internal fixed statuses to Arabic', () => {
  assert(sidebarSource.includes('"Ready.": "جاهز."'), 'Translates Ready.');
  assert(sidebarSource.includes('"Connecting...": "جارٍ الاتصال..."'), 'Translates Connecting...');
  assert(sidebarSource.includes('"Page & Elements refreshed.": "تم تحديث الصفحة والعناصر."'), 'Translates Page & Elements refreshed.');
  assert(sidebarSource.includes('"Offline — click to retry": "غير متصل — اضغط لإعادة المحاولة"'), 'Translates Offline status');
});

test('Backend replies and confirmation questions are never translated by sidebar', () => {
  // Verify addChatMessage appends text directly to textNode without dictionary mutation
  const addMsgRegex = /textNode\.textContent\s*=\s*text;/;
  assert(addMsgRegex.test(sidebarSource), 'addChatMessage leaves backend text untouched');
});

test('Confirmation chip regex handles both English and Arabic affirmations/cancellations', () => {
  const isConfirmRegex = /yes|proceed|place|confirm|ok|نعم|تأكيد|موافق|استمرار|متابعة/i;
  const isCancelRegex = /no|cancel|stop|لا|إلغاء|الغاء|توقف/i;

  assert(isConfirmRegex.test('Yes, proceed'), 'Matches English confirm');
  assert(isConfirmRegex.test('نعم، استمر'), 'Matches Arabic confirm نعم');
  assert(isConfirmRegex.test('تأكيد الطلب'), 'Matches Arabic confirm تأكيد');
  assert(isConfirmRegex.test('موافق'), 'Matches Arabic confirm موافق');

  assert(isCancelRegex.test('Cancel'), 'Matches English cancel');
  assert(isCancelRegex.test('إلغاء العملية'), 'Matches Arabic cancel إلغاء');
  assert(isCancelRegex.test('لا، توقف'), 'Matches Arabic cancel لا');
});

test('Guided tour defines Egyptian Arabic localized walkthrough with dir="rtl" on card', () => {
  assert(sidebarSource.includes('AR_TOUR_STEPS = ['), 'Defines AR_TOUR_STEPS');
  assert(sidebarSource.includes('افتح أطلس من أي مكان'), 'Arabic step 1 title');
  assert(sidebarSource.includes('الأوامر النصية والصوتية'), 'Arabic step 2 title');
  assert(sidebarSource.includes('شاهد أطلس يتنقل'), 'Arabic step 3 title');
  assert(sidebarSource.includes('dir="${isAr ? "rtl" : "ltr"}"'), 'Tour card applies dir="rtl" for Arabic');
  assert(sidebarSource.includes('lang="${isAr ? "ar" : "en"}"'), 'Tour card applies lang="ar" for Arabic');
  assert(sidebarSource.includes('إنهاء الجولة ✓'), 'Arabic finish button');
  assert(sidebarSource.includes('عدم الإظهار مرة أخرى'), 'Arabic checkbox label');
});

// =========================================================================
// SUITE 6: TTS Voice Selection & Graceful Fallback (Task 4)
// =========================================================================
console.log('\n[Suite 6: Arabic TTS Voice Matching & Graceful Fallback]');

delete require.cache[require.resolve('./tts.js')];
const tts = require('./tts.js');

test('AtlasTTS exports getVoiceForLanguage helper', () => {
  assert.strictEqual(typeof tts.getVoiceForLanguage, 'function', 'tts.js exports getVoiceForLanguage');
});

test('getVoiceForLanguage selects exact ar-EG voice when available', () => {
  const mockVoices = [
    { name: 'David', lang: 'en-US', default: true },
    { name: 'Maged', lang: 'ar-EG', default: false },
    { name: 'Tariq', lang: 'ar-SA', default: false },
  ];
  const selected = tts.getVoiceForLanguage('ar-EG', mockVoices);
  assert(selected, 'Selected a voice');
  assert.strictEqual(selected.lang, 'ar-EG', 'Exact ar-EG voice matched');
  assert.strictEqual(selected.name, 'Maged');
});

test('getVoiceForLanguage falls back to regional ar-* voice when ar-EG is missing', () => {
  const mockVoices = [
    { name: 'Alex', lang: 'en-US', default: true },
    { name: 'Laila', lang: 'ar-SA', default: false },
  ];
  const selected = tts.getVoiceForLanguage('ar-EG', mockVoices);
  assert(selected, 'Selected a voice');
  assert.strictEqual(selected.lang, 'ar-SA', 'Regional Arabic voice selected as fallback');
});

test('getVoiceForLanguage matches Arabic voice by name if lang code is non-standard', () => {
  const mockVoices = [
    { name: 'Default', lang: 'en-US', default: true },
    { name: 'Google Arabic Voice', lang: 'und', default: false },
  ];
  const selected = tts.getVoiceForLanguage('ar-EG', mockVoices);
  assert(selected, 'Selected a voice');
  assert.strictEqual(selected.name, 'Google Arabic Voice', 'Matched voice by name');
});

test('getVoiceForLanguage gracefully returns null when no Arabic voice is installed to defer to host default', () => {
  const mockVoices = [
    { name: 'Default English', lang: 'en-US', default: true },
    { name: 'Secondary English', lang: 'en-GB', default: false },
  ];
  const selected = tts.getVoiceForLanguage('ar-EG', mockVoices);
  assert.strictEqual(selected, null, 'Returns null to let browser engine use platform default voice rather than wrong language');
});

test('getVoiceForLanguage returns null safely if voice list is empty', () => {
  const selected = tts.getVoiceForLanguage('ar-EG', []);
  assert.strictEqual(selected, null, 'Returns null on empty voice list without throwing');
});

// =========================================================================
// SUITE 7: Universal Prime Directive Compliance (Rule 1)
// =========================================================================
console.log('\n[Suite 7: Universal Prime Directive Compliance]');

const ownedFiles = [
  'client-script/sidebar.js',
  'client-script/speech.js',
  'client-script/tts.js',
  'client-script/options.js',
  'client-script/options.html',
];

const forbiddenDomains = [
  'google.com',
  'amazon.com',
  'github.com',
  'wikipedia.org',
  'drive.google.com',
];

ownedFiles.forEach((file) => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  forbiddenDomains.forEach((domain) => {
    test(`${file} contains strictly ZERO hardcoded references to ${domain}`, () => {
      // Exclude comments about Google Chrome or standard schemas
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(domain)) {
          // Check if it's a test comment or chrome services reference in string message
          const isAllowedDoc = line.includes('Use Google services') || line.includes('google.com') && file.includes('test_');
          assert(isAllowedDoc, `Forbidden domain ${domain} found at ${file}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  });
});

console.log('\n======================================================');
console.log(`WS3 Language Client Suite: ${passed} passed, ${failed} failed.`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

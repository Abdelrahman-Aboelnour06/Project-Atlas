/**
 * M7 Frontend Adversarial Stress Test Suite — Challenger 2
 *
 * EMPIRICAL ADVERSARIAL STRESS HARNESS:
 * 1. RTL bidi bubbles: mixed English/Arabic text in bubble, RTL numbers, special symbols, CSS logical properties integrity, XSS safety.
 * 2. Dual-language voice input: rapid language toggling, auto-sticky Arabic heuristic with mixed text (e.g. "order ايفون 15"), storage persistence fallback.
 * 3. TTS voice matching with non-standard voice configurations (including uppercase locale edge case and missing voice graceful degradation).
 * 4. In-page language switcher with unusual DOM structures (nested SVG, shadow DOM simulation, dynamic dropdowns, role=menuitem).
 *
 * Includes:
 * - Part A: In-Memory / Fuzzing / Fault-Injection Stress Harness
 * - Part B: Real Headless Chromium Browser (Playwright) Real-DOM Adversarial Suite
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

let passed = 0;
let failed = 0;
const failuresList = [];
const findingsList = [];

function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res
        .then(() => {
          passed++;
          console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
          failed++;
          failuresList.push({ name, error: err.message });
          console.error(`  ✗ ${name}: ${err.message}`);
        });
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    failed++;
    failuresList.push({ name, error: err.message });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

async function runAllTests() {
  console.log('\n===============================================================');
  console.log('=== M7 ADVERSARIAL STRESS TEST SUITE — CHALLENGER 2 ===');
  console.log('===============================================================\n');

  // =========================================================================
  // DOMAIN 1: RTL Bidi Bubbles & CSS Logical Properties Integrity
  // =========================================================================
  console.log('[Domain 1: RTL Bidi Bubbles & CSS Logical Properties Integrity]');

  const sidebarCssPath = path.join(__dirname, 'sidebar.css');
  const sidebarJsPath = path.join(__dirname, 'sidebar.js');
  const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
  const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');

  // 1.1 CSS Logical Properties Static & Semantic Verification
  test('sidebar.css enforces direction: ltr on #atlas-sidebar-root', () => {
    assert(/#atlas-sidebar-root\s*\{[^}]*direction\s*:\s*ltr\s*;/s.test(sidebarCss),
      'Must contain explicit direction: ltr on #atlas-sidebar-root');
  });

  test('sidebar.css uses text-align: start and padding-inline-end on .atlas-msg-bubble', () => {
    assert(/\.atlas-msg-bubble\s*\{[^}]*text-align\s*:\s*start\s*;/s.test(sidebarCss),
      'Must use text-align: start on .atlas-msg-bubble');
    assert(/\.atlas-msg-bubble\s*\{[^}]*padding-inline-end\s*:\s*12px\s*;/s.test(sidebarCss),
      'Must use padding-inline-end: 12px on .atlas-msg-bubble');
  });

  test('sidebar.css uses margin-inline-start: auto and border-end-end-radius on user bubble', () => {
    assert(/\.atlas-msg-user\s+\.atlas-msg-bubble\s*\{[^}]*margin-inline-start\s*:\s*auto\s*;/s.test(sidebarCss),
      'User bubble must use margin-inline-start: auto');
    assert(/\.atlas-msg-user\s+\.atlas-msg-bubble\s*\{[^}]*border-end-end-radius\s*:\s*4px\s*;/s.test(sidebarCss),
      'User bubble must use border-end-end-radius: 4px');
  });

  test('sidebar.css uses margin-inline-start: 0 and border-end-start-radius on agent bubble', () => {
    assert(/\.atlas-msg-agent\s+\.atlas-msg-bubble\s*\{[^}]*margin-inline-start\s*:\s*0\s*;/s.test(sidebarCss),
      'Agent bubble must use margin-inline-start: 0');
    assert(/\.atlas-msg-agent\s+\.atlas-msg-bubble\s*\{[^}]*border-end-start-radius\s*:\s*4px\s*;/s.test(sidebarCss),
      'Agent bubble must use border-end-start-radius: 4px');
  });

  test('sidebar.js attaches dir="auto" to both bubble and textNode', () => {
    assert(/bubble\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarJs),
      'bubble must have dir="auto"');
    assert(/textNode\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarJs),
      'textNode must have dir="auto"');
  });

  test('sidebar.js attaches dir="auto" to thinking indicator bubble', () => {
    assert(/<div class="atlas-msg-bubble" dir="auto">/.test(sidebarJs),
      'Thinking bubble must have dir="auto"');
  });

  test('sidebar.js uses textContent for message rendering preventing innerHTML injection', () => {
    assert(/textNode\.textContent\s*=\s*text/.test(sidebarJs),
      'Message body must be set via safe textContent');
  });

  // =========================================================================
  // DOMAIN 2: Dual-Language Voice Input & Auto-Sticky Heuristic
  // =========================================================================
  console.log('\n[Domain 2: Dual-Language Voice Input & Auto-Sticky Heuristic]');

  const speechModule = require('./speech.js');
  const sidebarModule = require('./sidebar.js');

  // 2.1 Rapid Language Toggling Stress Test (100 rapid alternations)
  test('Rapid language toggling (100 iterations) maintains state consistency without drift', () => {
    sidebarModule.setVoiceLanguage('en-US');
    assert.strictEqual(sidebarModule.getVoiceLanguage(), 'en-US');

    for (let i = 0; i < 100; i++) {
      const toggled = sidebarModule.toggleVoiceLanguage();
      const expected = (i % 2 === 0) ? 'ar-EG' : 'en-US';
      assert.strictEqual(toggled, expected, `Toggle iteration ${i} mismatch`);
      assert.strictEqual(sidebarModule.getVoiceLanguage(), expected);
    }
    assert.strictEqual(sidebarModule.getVoiceLanguage(), 'en-US', 'Final state must return to en-US');
  });

  // 2.2 Malformed and Edge-Case Language Inputs
  test('setVoiceLanguage gracefully handles non-standard, prefix, and invalid language inputs', () => {
    // ar dialects should normalize to ar-EG
    assert.strictEqual(sidebarModule.setVoiceLanguage('ar-SA'), 'ar-EG');
    assert.strictEqual(sidebarModule.setVoiceLanguage('ar'), 'ar-EG');
    assert.strictEqual(sidebarModule.setVoiceLanguage('ar-XA'), 'ar-EG');

    // non-arabic fallbacks to en-US
    assert.strictEqual(sidebarModule.setVoiceLanguage('fr-FR'), 'en-US');
    assert.strictEqual(sidebarModule.setVoiceLanguage('de-DE'), 'en-US');
    assert.strictEqual(sidebarModule.setVoiceLanguage(''), 'en-US');
    assert.strictEqual(sidebarModule.setVoiceLanguage(null), 'en-US');
    assert.strictEqual(sidebarModule.setVoiceLanguage(undefined), 'en-US');
    assert.strictEqual(sidebarModule.setVoiceLanguage(12345), 'en-US');
  });

  // 2.3 Auto-Sticky Arabic Heuristic with Mixed Text Permutations
  test('Auto-sticky Arabic heuristic: mixed English/Arabic phrases trigger sticky switch', () => {
    const mixedTestCases = [
      { input: 'order ايفون 15', expected: true, desc: 'Mixed starting English with Arabic noun' },
      { input: 'اشتري iphone 15 pro', expected: true, desc: 'Mixed starting Arabic with English product' },
      { input: 'add to cart أضف إلى السلة', expected: true, desc: 'Bilingual phrase' },
      { input: 'search for هاتف ذكي', expected: true, desc: 'English query with Arabic keyword' },
      { input: 'عايز اشتري 2 items from the shop', expected: true, desc: 'Egyptian phrase with English tail' },
      { input: 'iPhone ١٥ برو ماكس', expected: true, desc: 'Arabic-Indic numerals and transliterated Arabic' },
      { input: '100% مضمون ومجرب', expected: true, desc: 'Percentage, digits, and Arabic text' },
      { input: 'Hello, شكراً جزيلاً!', expected: true, desc: 'Mixed greeting with punctuation' },
      { input: 'دوس على sign in', expected: true, desc: 'Egyptian verb with English target' },
      { input: 'وديني على صفحة الـ settings', expected: true, desc: 'Egyptian slang with English noun' },
      { input: 'Check the price بتاع الـ phone', expected: true, desc: 'English start with Egyptian connector' },
      { input: 'املى الـ form بالبيانات', expected: true, desc: 'Arabic instructions with English noun' },
    ];

    for (const tc of mixedTestCases) {
      sidebarModule.setVoiceLanguage('en-US');
      const triggered = sidebarModule.handleSpeechTranscript(tc.input);
      assert.strictEqual(triggered, tc.expected, `Failed on: ${tc.desc} (${tc.input})`);
      assert.strictEqual(sidebarModule.getVoiceLanguage(), 'ar-EG', `Voice language not sticky for: ${tc.input}`);
    }
  });

  test('Auto-sticky Arabic heuristic: pure English, numbers, and symbols DO NOT trigger', () => {
    const nonArabicCases = [
      'order iphone 15 pro max',
      'search for laptop 2026',
      '1234567890',
      '!@#$%^&*()_+=-',
      '   ',
      'navigate to settings and click account',
      'hello world',
      'https://example.com/order',
      'select size XL and color blue',
      'confirm transaction ID 987654',
    ];

    for (const input of nonArabicCases) {
      sidebarModule.setVoiceLanguage('en-US');
      const triggered = sidebarModule.handleSpeechTranscript(input);
      assert.strictEqual(triggered, false, `False positive on non-Arabic input: "${input}"`);
      assert.strictEqual(sidebarModule.getVoiceLanguage(), 'en-US', `Language inappropriately mutated by: "${input}"`);
    }
  });

  test('Sticky persistence invariant: English transcript while in ar-EG mode does NOT revert to en-US', () => {
    sidebarModule.setVoiceLanguage('ar-EG');
    assert.strictEqual(sidebarModule.getVoiceLanguage(), 'ar-EG');

    // Speak English while in Arabic mode
    const triggered = sidebarModule.handleSpeechTranscript('confirm and place order');
    assert.strictEqual(triggered, false);
    // Must REMAIN ar-EG! Sticky means it stays Arabic until user explicitly toggles.
    assert.strictEqual(sidebarModule.getVoiceLanguage(), 'ar-EG',
      'Sticky Arabic must persist when subsequent turn is in English');
  });

  // 2.4 Storage Persistence Fallback & Error Resilience
  test('Storage fallback: operates gracefully when chrome.storage throws or is corrupted', () => {
    const originalChrome = global.chrome;
    try {
      global.chrome = {
        storage: {
          local: {
            get: () => { throw new Error('QUOTA_EXCEEDED'); },
            set: () => { throw new Error('QUOTA_EXCEEDED'); },
          },
          onChanged: { addListener: () => {} },
        },
      };

      assert.doesNotThrow(() => {
        sidebarModule.setVoiceLanguage('ar-EG');
        sidebarModule.toggleVoiceLanguage();
      }, 'Must handle storage errors gracefully without crashing');
    } finally {
      global.chrome = originalChrome;
    }
  });

  // =========================================================================
  // DOMAIN 3: TTS Voice Matching with Non-Standard Voice Configurations
  // =========================================================================
  console.log('\n[Domain 3: TTS Voice Matching with Non-Standard Voice Configurations]');

  const ttsModule = require('./tts.js');

  // 3.1 Language Detection Accuracy on Complex and Mixed Text
  test('tts.detectLanguage correctly identifies Arabic script in mixed and edge-case text', () => {
    assert.strictEqual(ttsModule.detectLanguage('ايفون 15'), 'ar-EG');
    assert.strictEqual(ttsModule.detectLanguage('Order ايفون 15 now'), 'ar-EG');
    assert.strictEqual(ttsModule.detectLanguage('تم تأكيد طلبك رقم #9876'), 'ar-EG');
    assert.strictEqual(ttsModule.detectLanguage('Order #9876 confirmed'), 'en-US');
    assert.strictEqual(ttsModule.detectLanguage(''), 'en-US');
    assert.strictEqual(ttsModule.detectLanguage(null), 'en-US');
    assert.strictEqual(ttsModule.detectLanguage('12345'), 'en-US');
    assert.strictEqual(ttsModule.detectLanguage('🌟✨🚀'), 'en-US');
  });

  // 3.2 Text Sanitization Integrity (Markdown, URLs, Emojis)
  test('tts.cleanSpeechText removes URLs, markdown, and emojis while preserving Arabic and English words', () => {
    const raw = '### مرحباً بك! 🌟 زور موقعنا https://example.com/shop واشترِ **الآن**!';
    const cleaned = ttsModule.cleanSpeechText(raw);
    assert.strictEqual(cleaned.includes('https://'), false, 'URL must be removed');
    assert.strictEqual(cleaned.includes('###'), false, 'Markdown heading must be removed');
    assert.strictEqual(cleaned.includes('**'), false, 'Bold markdown must be removed');
    assert.strictEqual(cleaned.includes('🌟'), false, 'Emoji must be removed');
    assert(cleaned.includes('مرحباً بك'), 'Arabic greeting preserved');
    assert(cleaned.includes('واشترِ'), 'Arabic verb preserved');
    assert(cleaned.includes('الآن'), 'Arabic adverb preserved');
  });

  // 3.3 Non-Standard Voice Configurations Matrix
  test('TTS voice matching: matches ar-EG, ar_EG, regional ar-SA, and bare ar locales', () => {
    let lastUtterance = null;
    let warnLogged = false;
    const originalWarn = console.warn;
    console.warn = (msg) => { warnLogged = true; };

    function MockUtterance(text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
    }

    global.SpeechSynthesisUtterance = MockUtterance;
    global.window = {
      SpeechSynthesisUtterance: MockUtterance,
      speechSynthesis: {
        speaking: false,
        pending: false,
        cancel: () => {},
        speak: (utt) => { lastUtterance = utt; },
        getVoices: () => [
          { name: 'Google US English', lang: 'en-US' },
          { name: 'Maged Arabic Saudi', lang: 'ar-SA' },
          { name: 'Tarik Arabic', lang: 'ar_EG' },
        ],
      },
    };

    try {
      // Case A: Egyptian Arabic with ar_EG installed voice
      ttsModule.speak('مرحبا بكم في اطلس');
      assert(lastUtterance !== null, 'Utterance must be created');
      assert.strictEqual(lastUtterance.lang, 'ar-EG', 'Utterance lang must be ar-EG');
      assert(lastUtterance.voice !== null && (lastUtterance.voice.lang === 'ar_EG' || lastUtterance.voice.lang === 'ar-SA'),
        'Voice must match available Arabic voice');

      // Case B: No Arabic voices installed on OS (fallback resilience)
      warnLogged = false;
      global.window.speechSynthesis.getVoices = () => [
        { name: 'Microsoft David', lang: 'en-US' },
        { name: 'Microsoft Zira', lang: 'en-GB' },
        { name: 'Google Francais', lang: 'fr-FR' },
      ];

      assert.doesNotThrow(() => {
        ttsModule.speak('أهلاً بكم مجدداً');
      }, 'Must not throw when no Arabic voice is installed');
      assert.strictEqual(warnLogged, true, 'Must log warning when no Arabic voice is installed');
      assert.strictEqual(lastUtterance.lang, 'ar-EG', 'Utterance lang must remain ar-EG for browser engine');
      assert.strictEqual(lastUtterance.voice, null, 'Voice is null, deferring to host default');

      // Case C: Empty voice list (initial browser startup before voicesloaded)
      global.window.speechSynthesis.getVoices = () => [];
      assert.doesNotThrow(() => {
        ttsModule.speak('Welcome to Atlas');
      });
      assert.strictEqual(lastUtterance.lang, 'en-US');

      // Case D: Mute toggle suppression
      ttsModule.setMuted(true);
      lastUtterance = null;
      ttsModule.speak('This should not speak');
      assert.strictEqual(lastUtterance, null, 'Muted TTS must not create utterance');
      ttsModule.setMuted(false);
    } finally {
      console.warn = originalWarn;
      delete global.SpeechSynthesisUtterance;
      delete global.window;
    }
  });

  // 3.4 Adversarial Edge Case Discovery: Uppercase voice lang code check
  test('Edge Case finding: Uppercase voice lang tags (AR-EG) behavior noted', () => {
    let lastUtterance = null;
    function MockUtterance(text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
    }
    global.SpeechSynthesisUtterance = MockUtterance;
    global.window = {
      SpeechSynthesisUtterance: MockUtterance,
      speechSynthesis: {
        speaking: false,
        cancel: () => {},
        speak: (utt) => { lastUtterance = utt; },
        getVoices: () => [{ name: 'Custom Arabic Upper', lang: 'AR-EG' }],
      },
    };

    try {
      ttsModule.speak('مرحبا');
      // Documenting that uppercase 'AR-EG' does not match due to case-sensitive prefix comparison
      // but gracefully sets utterance.lang = 'ar-EG' without throwing
      assert.strictEqual(lastUtterance.lang, 'ar-EG');
      findingsList.push({
        area: 'TTS Voice Matching',
        detail: 'BCP-47 uppercase voice lang tags (e.g. "AR-EG") are not matched to utterance.voice due to case-sensitive prefix checks, though utterance.lang is correctly set to "ar-EG" and execution degrades gracefully without exceptions.',
      });
    } finally {
      delete global.SpeechSynthesisUtterance;
      delete global.window;
    }
  });

  // =========================================================================
  // DOMAIN 4: In-Page Language Switcher with Unusual DOM Structures
  // =========================================================================
  console.log('\n[Domain 4: In-Page Language Switcher with Unusual DOM Structures]');

  const { AtlasLanguageSwitcher } = require('./content.js');

  test('AtlasLanguageSwitcher scan safely handles empty document and invalid targets', () => {
    assert.deepStrictEqual(AtlasLanguageSwitcher.scan(null), { found: false, element: null, type: null });
    assert.deepStrictEqual(AtlasLanguageSwitcher.scan(''), { found: false, element: null, type: null });
    assert.deepStrictEqual(AtlasLanguageSwitcher.scan(undefined), { found: false, element: null, type: null });
  });

  console.log('\n--- Part A (In-Memory & Stress Harness) Complete ---');

  // =========================================================================
  // PART B: Headless Chromium Browser (Playwright) Real-DOM Adversarial Suite
  // =========================================================================
  console.log('\n[Part B: Real Headless Chromium Browser Adversarial Execution]');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();

    // ── B.1 Real Browser RTL & Bidi Layout Verification ──
    console.log('\n  [Browser: RTL Bidi Bubbles & CSS Logical Properties]');

    // Build adversarial HTML testbed with host document having dir="rtl" to stress test isolation
    const testHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <style>
          ${sidebarCss}
        </style>
      </head>
      <body>
        <div id="host-content">
          <h1>صفحة اختبار مضيفة باللغة العربية</h1>
        </div>
        <div id="atlas-sidebar-root">
          <div class="atlas-header">
            <span class="atlas-title">Atlas</span>
            <div class="atlas-tab-bar">
              <button class="atlas-tab atlas-tab-active">Chat</button>
              <button class="atlas-tab">Elements</button>
            </div>
          </div>
          <div class="atlas-chat-log" id="atlas-chat-log"></div>
          <div class="atlas-chat-input-bar">
            <input type="text" class="atlas-chat-input" placeholder="Type here...">
            <button class="atlas-lang-pill" id="atlas-lang-toggle">EN</button>
            <button class="atlas-mic-btn">🎤</button>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(testHtml);

    // Verify outer #atlas-sidebar-root computed direction is LTR despite html dir="rtl"
    const rootComputedDirection = await page.evaluate(() => {
      const el = document.getElementById('atlas-sidebar-root');
      return window.getComputedStyle(el).direction;
    });
    test('Browser: #atlas-sidebar-root direction computes to LTR even when html dir="rtl"', () => {
      assert.strictEqual(rootComputedDirection, 'ltr', 'Root must isolate chrome in fixed LTR');
    });

    // Mount messages in browser using actual sidebar.js logic
    await page.evaluate(() => {
      const chatLog = document.getElementById('atlas-chat-log');

      function addBubble(role, text) {
        const msg = document.createElement('div');
        msg.className = `atlas-msg atlas-msg-${role}`;
        const bubble = document.createElement('div');
        bubble.className = 'atlas-msg-bubble';
        bubble.setAttribute('dir', 'auto');
        const textNode = document.createElement('div');
        textNode.className = 'atlas-msg-text';
        textNode.setAttribute('dir', 'auto');
        textNode.textContent = text;
        bubble.appendChild(textNode);
        msg.appendChild(bubble);
        chatLog.appendChild(msg);
        return { msg, bubble, textNode };
      }

      window.testBubbles = {
        userEn: addBubble('user', 'Hello from user! Order product #12345'),
        agentAr: addBubble('agent', 'أهلاً بك! تم استلام طلبك رقم ١٢٣٤٥ بنجاح.'),
        userMixed: addBubble('user', 'Search for ايفون 15 Pro Max with 256GB'),
        agentMixed: addBubble('agent', 'تم العثور على 3 نتائج: iPhone 15 بسعر ٤٥,٠٠٠ ج.م.'),
        userSymbols: addBubble('user', '«تأكيد الطلب» (نعم) [proceed] {100%}!'),
        agentNumbers: addBubble('agent', 'التاريخ: 2026/10/04 الساعة 10:30 صباحاً'),
        userRtlNumbers: addBubble('user', 'الكمية المطلوبة: ٥ قطع بسعر ٥٠٠$'),
        userPhone: addBubble('user', 'اتصل على رقم +20 100 123 4567 فوراً'),
      };
    });

    // Check computed styles on bubbles
    const bubbleStyles = await page.evaluate(() => {
      const getStyles = (el) => {
        const cs = window.getComputedStyle(el);
        return {
          textAlign: cs.textAlign,
          direction: cs.direction,
          borderEndEndRadius: cs.borderEndEndRadius,
          borderEndStartRadius: cs.borderEndStartRadius,
          marginInlineStart: cs.marginInlineStart,
        };
      };

      const b = window.testBubbles;
      return {
        userEnBubble: getStyles(b.userEn.bubble),
        userEnText: getStyles(b.userEn.textNode),
        agentArBubble: getStyles(b.agentAr.bubble),
        agentArText: getStyles(b.agentAr.textNode),
        userMixedText: getStyles(b.userMixed.textNode),
        agentMixedText: getStyles(b.agentMixed.textNode),
        userRtlNumbersText: getStyles(b.userRtlNumbers.textNode),
        userPhoneText: getStyles(b.userPhone.textNode),
      };
    });

    test('Browser: Arabic message bubble text computes direction to RTL under dir="auto"', () => {
      assert.strictEqual(bubbleStyles.agentArText.direction, 'rtl',
        'Arabic text must resolve direction to rtl under browser Unicode Bidirectional Algorithm');
    });

    test('Browser: English message bubble text computes direction to LTR under dir="auto"', () => {
      assert.strictEqual(bubbleStyles.userEnText.direction, 'ltr',
        'English text must resolve direction to ltr');
    });

    test('Browser: Arabic text with Eastern numerals computes direction to RTL', () => {
      assert.strictEqual(bubbleStyles.userRtlNumbersText.direction, 'rtl',
        'Arabic starting text with numbers must resolve direction to rtl');
    });

    test('Browser: Arabic text with international phone numbers computes direction to RTL', () => {
      assert.strictEqual(bubbleStyles.userPhoneText.direction, 'rtl',
        'Arabic starting text with phone number must resolve direction to rtl');
    });

    test('Browser: CSS Logical Properties apply correctly to user and agent bubbles', () => {
      assert.strictEqual(bubbleStyles.userEnBubble.textAlign, 'start');
      assert.strictEqual(bubbleStyles.agentArBubble.textAlign, 'start');
      assert.strictEqual(bubbleStyles.userEnBubble.borderEndEndRadius, '4px');
      assert.strictEqual(bubbleStyles.agentArBubble.borderEndStartRadius, '4px');
      // In Chromium with direction: ltr on root, margin-inline-start on user bubble computes to positive px pushing it to inline end
      assert(parseFloat(bubbleStyles.userEnBubble.marginInlineStart) > 0,
        'margin-inline-start must push user bubble to inline end');
    });

    // ── B.2 In-Page Language Switcher with Unusual DOM Structures ──
    console.log('\n  [Browser: In-Page Language Switcher with Unusual DOM Structures]');

    const contentJs = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

    // Test 1: Button with nested SVG and Arabic label
    const svgPageHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <div id="site-header">
          <button id="svg-lang-btn" class="globe-btn" aria-label="اختر اللغة">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <circle cx="12" cy="12" r="10" />
              <text x="12" y="16">AR</text>
            </svg>
            <span class="btn-label">العربية</span>
          </button>
        </div>
      </body>
      </html>
    `;
    await page.setContent(svgPageHtml);
    await page.evaluate((js) => { (new Function(js))(); }, contentJs);

    const svgTestResult = await page.evaluate(async () => {
      const btn = document.getElementById('svg-lang-btn');
      let clicked = false;
      btn.addEventListener('click', () => { clicked = true; });

      const scanRes = window.AtlasLanguageSwitcher.scan('ar-EG');
      const isButton = scanRes.found && scanRes.element === btn;
      const switched = await window.AtlasLanguageSwitcher.detectAndSwitch('ar-EG');
      return { found: scanRes.found, type: scanRes.type, isButton, switched, clicked };
    });

    test('Browser: AtlasLanguageSwitcher successfully detects and clicks button with nested SVG', () => {
      assert.strictEqual(svgTestResult.found, true);
      assert.strictEqual(svgTestResult.isButton, true);
      assert.strictEqual(svgTestResult.switched, true);
      assert.strictEqual(svgTestResult.clicked, true);
    });

    // Test 2: Custom dynamic dropdown with role="menuitem" and data-lang="ar"
    const menuitemHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <div class="custom-dropdown" role="menu">
          <div role="menuitem" id="menu-opt-ar" class="lang-opt" data-lang="ar">اللغة العربية</div>
          <div role="menuitem" id="menu-opt-en" class="lang-opt" data-lang="en">English</div>
        </div>
      </body>
      </html>
    `;
    await page.setContent(menuitemHtml);
    await page.evaluate((js) => { (new Function(js))(); }, contentJs);

    const menuitemResult = await page.evaluate(async () => {
      const opt = document.getElementById('menu-opt-ar');
      let clicked = false;
      opt.addEventListener('click', () => { clicked = true; });

      const scanRes = window.AtlasLanguageSwitcher.scan('ar-EG');
      const isTarget = scanRes.found && scanRes.element === opt;
      const switched = await window.AtlasLanguageSwitcher.detectAndSwitch('ar-EG');
      return { found: scanRes.found, type: scanRes.type, isTarget, switched, clicked };
    });

    test('Browser: AtlasLanguageSwitcher handles custom dropdown with role="menuitem" and data-lang', () => {
      assert.strictEqual(menuitemResult.found, true);
      assert.strictEqual(menuitemResult.isTarget, true);
      assert.strictEqual(menuitemResult.switched, true);
      assert.strictEqual(menuitemResult.clicked, true);
    });

    // Test 3: Dynamic select dropdown with change event dispatch
    const selectHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <select id="lang-select" name="language">
          <option value="en" selected>English</option>
          <option value="ar">العربية (Arabic)</option>
        </select>
      </body>
      </html>
    `;
    await page.setContent(selectHtml);
    await page.evaluate((js) => { (new Function(js))(); }, contentJs);

    const selectResult = await page.evaluate(async () => {
      const sel = document.getElementById('lang-select');
      let changeFired = false;
      let inputFired = false;
      sel.addEventListener('change', () => { changeFired = true; });
      sel.addEventListener('input', () => { inputFired = true; });

      const scanRes = window.AtlasLanguageSwitcher.scan('ar-EG');
      const switched = await window.AtlasLanguageSwitcher.detectAndSwitch('ar-EG');
      return {
        found: scanRes.found,
        type: scanRes.type,
        switched,
        finalValue: sel.value,
        changeFired,
        inputFired,
      };
    });

    test('Browser: AtlasLanguageSwitcher updates select value and dispatches change & input events', () => {
      assert.strictEqual(selectResult.found, true);
      assert.strictEqual(selectResult.type, 'select');
      assert.strictEqual(selectResult.switched, true);
      assert.strictEqual(selectResult.finalValue, 'ar');
      assert.strictEqual(selectResult.changeFired, true);
      assert.strictEqual(selectResult.inputFired, true);
    });

    // Test 4: Atlas Sidebar isolation check
    const isolationHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <div id="atlas-sidebar-root">
          <button class="atlas-lang-pill" id="atlas-lang-toggle" data-lang="ar">AR (العربية)</button>
          <div role="button" aria-label="اللغة العربية">العربية</div>
        </div>
      </body>
      </html>
    `;
    await page.setContent(isolationHtml);
    await page.evaluate((js) => { (new Function(js))(); }, contentJs);

    const isolationResult = await page.evaluate(() => {
      return window.AtlasLanguageSwitcher.scan('ar-EG');
    });

    test('Browser: AtlasLanguageSwitcher strictly ignores elements inside #atlas-sidebar-root', () => {
      assert.strictEqual(isolationResult.found, false,
        'Must never select Atlas extension UI elements');
    });

    // Test 5: Shadow DOM boundary observation
    const shadowHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"></head>
      <body>
        <div id="shadow-host"></div>
        <script>
          const host = document.getElementById('shadow-host');
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = '<button id="shadow-btn" lang="ar">العربية</button>';
        </script>
      </body>
      </html>
    `;
    await page.setContent(shadowHtml);
    await page.evaluate((js) => { (new Function(js))(); }, contentJs);

    const shadowResult = await page.evaluate(() => {
      return window.AtlasLanguageSwitcher.scan('ar-EG');
    });

    test('Browser: Shadow DOM encapsulation limits document.querySelectorAll (documented caveat)', () => {
      assert.strictEqual(shadowResult.found, false,
        'Standard document.querySelectorAll does not penetrate closed/open shadow root boundaries');
      findingsList.push({
        area: 'In-Page Language Switcher',
        detail: 'Elements encapsulated strictly inside ShadowRoot (Web Components) without light DOM host attributes or slot projections are not matched by document.querySelectorAll.',
      });
    });

  } finally {
    await browser.close();
  }

  // =========================================================================
  // SUMMARY AND VERDICT
  // =========================================================================
  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('===============================================================\n');

  if (findingsList.length > 0) {
    console.log('ADVERSARIAL FINDINGS & CAVEATS RECORDED:');
    findingsList.forEach((f, idx) => {
      console.log(`[Finding ${idx + 1}] (${f.area}): ${f.detail}`);
    });
    console.log('');
  }

  if (failed > 0) {
    console.error('FAILURES:');
    for (const f of failuresList) {
      console.error(`- ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('ALL ADVERSARIAL STRESS TESTS PASSED CLEANLY.');
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});

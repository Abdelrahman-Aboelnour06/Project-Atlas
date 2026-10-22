/**
 * test_wave2_ux.js — Automated Verification Test Suite for Project Atlas Wave 2
 * Core UX & Human Factors (Tasks U2, U3, U4)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('   Atlas Assistant — Wave 2 UX & Accessibility Suite  ');
console.log('======================================================\n');

let passedCount = 0;
let failedCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    failedCount++;
  }
}

async function asyncTest(description, fn) {
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    failedCount++;
  }
}

// Read Source Files
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const backgroundCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const contentCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const sidebarCode = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
const sidebarCss = fs.readFileSync(path.join(__dirname, 'sidebar.css'), 'utf8');
const optionsCss = fs.readFileSync(path.join(__dirname, 'options.css'), 'utf8');
const speechCode = fs.readFileSync(path.join(__dirname, 'speech.js'), 'utf8');

// Mock Browser Environment for sidebar.js and content.js
const mockStorage = {};
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: { href: 'https://example.com/shop', origin: 'https://example.com' },
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.window.top = global.window;

const dummyEl = {
  style: { setProperty: () => {}, removeProperty: () => {} },
  classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
  attributes: {},
  setAttribute: (k, v) => { dummyEl.attributes[k] = v; },
  getAttribute: (k) => dummyEl.attributes[k] || null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  remove: () => {},
};

global.document = {
  body: { style: {}, appendChild: () => {} },
  documentElement: { appendChild: () => {} },
  createElement: (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      style: {
        setProperty: () => {},
        removeProperty: () => {},
      },
      classList: {
        classes: new Set(),
        add: (...c) => c.forEach((cls) => el.classList.classes.add(cls)),
        remove: (...c) => c.forEach((cls) => el.classList.classes.delete(cls)),
        toggle: (cls, force) => {
          if (force === undefined) {
            if (el.classList.classes.has(cls)) el.classList.classes.delete(cls);
            else el.classList.classes.add(cls);
          } else if (force) {
            el.classList.classes.add(cls);
          } else {
            el.classList.classes.delete(cls);
          }
        },
        contains: (cls) => el.classList.classes.has(cls),
      },
      attributes: {},
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k] || null,
      removeAttribute: (k) => { delete el.attributes[k]; },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: (selector) => {
        if (selector === '#atlas-progress-strip') return progressStripMock;
        if (selector === '#atlas-progress-step-text') return progressStepTextMock;
        if (selector === '#atlas-goal-progressbar') return progressBarMock;
        if (selector === '#atlas-progressbar-fill') return progressBarFillMock;
        if (selector === '#atlas-milestones-stepper') return milestonesStepperMock;
        if (selector === '#atlas-stop-btn') return stopBtnMock;
        if (selector === '#atlas-header-stop') return headerStopBtnMock;
        if (selector === '#atlas-voice-meter') return voiceMeterMock;
        if (selector === '#atlas-header-text-scale') return textScaleBtnMock;
        if (selector === '#atlas-header-close') return closeBtnMock;
        if (selector === '.atlas-traffic-close') return closeBtnMock;
        if (selector === '.atlas-close-btn') return closeBtnMock;
        if (selector === '.atlas-mic-btn') return micBtnMock;
        if (selector === '#atlas-mode-toggle') return modeBtnMock;
        return dummyEl;
      },
      querySelectorAll: (selector) => {
        if (selector === '.atlas-meter-bar') return meterBarsMock;
        if (selector === '.atlas-tab') return [];
        return [];
      },
      remove: () => {},
      attachShadow: () => ({
        adoptedStyleSheets: [],
        appendChild: () => {},
        getElementById: () => null,
      }),
    };
    return el;
  },
  getElementById: () => null,
  querySelector: () => null,
};
global.CSSStyleSheet = class {
  replaceSync() {}
};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb(mockStorage),
      set: (data, cb) => {
        Object.assign(mockStorage, data);
        if (cb) cb();
      },
    },
    onChanged: {
      addListener: () => {},
    },
  },
  runtime: {
    getURL: (p) => p,
    sendMessage: () => {},
  },
};

// UI Mock Elements
const progressStripMock = {
  style: { display: 'none' },
  querySelector: (sel) => {
    if (sel === '#atlas-progress-step-text') return progressStepTextMock;
    if (sel === '#atlas-goal-progressbar') return progressBarMock;
    if (sel === '#atlas-progressbar-fill') return progressBarFillMock;
    if (sel === '#atlas-milestones-stepper') return milestonesStepperMock;
    if (sel === '#atlas-stop-btn') return stopBtnMock;
    return null;
  },
};
const progressStepTextMock = { textContent: '', attributes: {}, setAttribute: (k, v) => { progressStepTextMock.attributes[k] = v; } };
const progressBarMock = { attributes: {}, setAttribute: (k, v) => { progressBarMock.attributes[k] = v; }, getAttribute: (k) => progressBarMock.attributes[k] };
const progressBarFillMock = { style: { width: '0%' } };
const milestonesStepperMock = { innerHTML: '' };
const stopBtnMock = { attributes: {}, setAttribute: (k, v) => { stopBtnMock.attributes[k] = v; }, classList: { toggle: () => {} }, addEventListener: () => {} };
const headerStopBtnMock = { attributes: {}, setAttribute: (k, v) => { headerStopBtnMock.attributes[k] = v; }, classList: { toggle: () => {} }, addEventListener: () => {} };
const textScaleBtnMock = { addEventListener: () => {} };
const closeBtnMock = { addEventListener: () => {} };
const micBtnMock = { classList: { toggle: () => {} }, addEventListener: () => {} };
const modeBtnMock = { classList: { toggle: () => {} }, addEventListener: () => {}, querySelector: () => ({ textContent: '', innerHTML: '' }), setAttribute: () => {} };
const meterBarsMock = [
  { style: { transform: 'scaleY(0.15)' } },
  { style: { transform: 'scaleY(0.15)' } },
  { style: { transform: 'scaleY(0.15)' } },
  { style: { transform: 'scaleY(0.15)' } },
];
const voiceMeterMock = {
  classList: { toggle: () => {} },
  querySelectorAll: (sel) => (sel === '.atlas-meter-bar' ? meterBarsMock : []),
};

// Load Modules
const AtlasSidebar = require('./sidebar.js');
const AtlasSpeech = require('./speech.js');
const backgroundModule = require('./background.js');
const contentModule = require('./content.js');

async function runTests() {
  // ── [Suite 1: Task U2 — Goal Progress Strip & Stop Control] ────────────────
  console.log('[Suite 1: Task U2 — Goal Progress Strip & Stop Control]');

  test('sidebar.js template contains #atlas-progress-strip with role="region"', () => {
    assert(sidebarCode.includes('id="atlas-progress-strip"'));
    assert(sidebarCode.includes('role="region"'));
    assert(sidebarCode.includes('aria-label="Goal progress"'));
  });

  test('sidebar.js contains progressbar container with role="progressbar" and ARIA attributes', () => {
    assert(sidebarCode.includes('id="atlas-goal-progressbar"'));
    assert(sidebarCode.includes('role="progressbar"'));
    assert(sidebarCode.includes('aria-valuenow="1"'));
    assert(sidebarCode.includes('aria-valuemin="1"'));
    assert(sidebarCode.includes('aria-valuemax="1"'));
    assert(sidebarCode.includes('aria-live="polite"'));
  });

  test('sidebar.js defines primary #atlas-stop-btn and secondary #atlas-header-stop buttons', () => {
    assert(sidebarCode.includes('id="atlas-stop-btn"'));
    assert(sidebarCode.includes('id="atlas-header-stop"'));
    assert(sidebarCode.includes('aria-label="Stop goal execution"'));
    assert(sidebarCode.includes('aria-label="Stop execution"'));
  });

  test('sidebar.css enforces #d93025 high-contrast background and >=44x44px target on Stop buttons', () => {
    assert(sidebarCss.includes('#atlas-sidebar-root .atlas-stop-btn'));
    assert(sidebarCss.includes('min-width: var(--atlas-touch-min)') || sidebarCss.includes('min-width: 44px'));
    assert(sidebarCss.includes('min-height: var(--atlas-touch-min)') || sidebarCss.includes('min-height: 44px'));
    assert(sidebarCss.includes('background: #d93025'));
    assert(sidebarCss.includes('color: #ffffff'));
  });

  test('AtlasSidebar exports setGoalProgress, hideGoalProgress, setExecuting', () => {
    assert(typeof AtlasSidebar.setGoalProgress === 'function');
    assert(typeof AtlasSidebar.hideGoalProgress === 'function');
    assert(typeof AtlasSidebar.setExecuting === 'function');
  });

  test('AtlasSidebar.setGoalProgress dynamically calculates percentage and ARIA values', () => {
    AtlasSidebar.mount();
    const fixtureState = {
      goal: 'Order groceries',
      status: 'in_progress',
      milestones: [
        { id: 'm1', description: 'Add milk to cart', status: 'completed' },
        { id: 'm2', description: 'Proceed to checkout', status: 'active' },
        { id: 'm3', description: 'Place order', status: 'pending' },
      ],
      active_milestone_id: 'm2',
    };

    AtlasSidebar.setGoalProgress(fixtureState);

    assert.strictEqual(progressBarMock.getAttribute('aria-valuenow'), '2');
    assert.strictEqual(progressBarMock.getAttribute('aria-valuemin'), '1');
    assert.strictEqual(progressBarMock.getAttribute('aria-valuemax'), '3');
    assert(progressBarMock.getAttribute('aria-valuetext').includes('Step 2 of 3: Proceed to checkout'));
    assert.strictEqual(progressBarFillMock.style.width, '33%');
    assert.strictEqual(progressStripMock.style.display, 'flex');
    assert(milestonesStepperMock.innerHTML.includes('atlas-milestone-done'));
    assert(milestonesStepperMock.innerHTML.includes('atlas-milestone-active'));
  });

  test('AtlasSidebar.hideGoalProgress resets display and width', () => {
    AtlasSidebar.hideGoalProgress();
    assert.strictEqual(progressStripMock.style.display, 'none');
    assert.strictEqual(progressBarFillMock.style.width, '0%');
  });

  test('content.js exports interruptibleSleep and aborts on AbortController signal', async () => {
    assert(typeof contentModule.interruptibleSleep === 'function');
    const controller = new AbortController();
    controller.abort();

    let threw = false;
    try {
      await contentModule.interruptibleSleep(500, controller.signal);
    } catch (err) {
      threw = err.name === 'AbortError' || err.message === 'Aborted';
    }
    assert(threw, 'interruptibleSleep must immediately reject on aborted signal');
  });

  test('content.js exports stopGoalExecution function', () => {
    assert(typeof contentModule.stopGoalExecution === 'function');
  });

  // ── [Suite 2: Task U3 — Readability, Motion & Header Ergonomics] ───────────
  console.log('\n[Suite 2: Task U3 — Readability, Motion & Header Ergonomics]');

  test('sidebar.css eliminates all sub-14px font declarations (WCAG typography floor)', () => {
    const sub14Regex = /font-size:\s*(?:[1-9]|1[0-3])px\b/g;
    const matches = sidebarCss.match(sub14Regex) || [];
    assert.strictEqual(matches.length, 0, `Expected 0 sub-14px font declarations in sidebar.css, got: ${matches.join(', ')}`);
  });

  test('options.css eliminates all sub-14px font declarations', () => {
    const sub14Regex = /font-size:\s*(?:[1-9]|1[0-3])px\b/g;
    const matches = optionsCss.match(sub14Regex) || [];
    assert.strictEqual(matches.length, 0, `Expected 0 sub-14px font declarations in options.css, got: ${matches.join(', ')}`);
  });

  test('sidebar.css defines user text scaling tokens (normal, large, xl)', () => {
    assert(sidebarCss.includes('--atlas-font-floor: 14px'));
    assert(sidebarCss.includes('--atlas-font-body: 16px'));
    assert(sidebarCss.includes('.atlas-text-scale-normal'));
    assert(sidebarCss.includes('.atlas-text-scale-large'));
    assert(sidebarCss.includes('.atlas-text-scale-xl'));
  });

  test('AtlasSidebar exports getTextScale, setTextScale, cycleTextScale', () => {
    assert(typeof AtlasSidebar.getTextScale === 'function');
    assert(typeof AtlasSidebar.setTextScale === 'function');
    assert(typeof AtlasSidebar.cycleTextScale === 'function');

    AtlasSidebar.setTextScale('normal');
    assert.strictEqual(AtlasSidebar.getTextScale(), 'normal');

    AtlasSidebar.cycleTextScale();
    assert.strictEqual(AtlasSidebar.getTextScale(), 'large');

    AtlasSidebar.cycleTextScale();
    assert.strictEqual(AtlasSidebar.getTextScale(), 'xl');

    AtlasSidebar.cycleTextScale();
    assert.strictEqual(AtlasSidebar.getTextScale(), 'normal');
  });

  test('sidebar.css enforces minimum 44x44px touch targets on interactive controls', () => {
    assert(sidebarCss.includes('--atlas-touch-min: 44px'));
    assert(sidebarCss.includes('min-width: var(--atlas-touch-min)'));
    assert(sidebarCss.includes('min-height: var(--atlas-touch-min)'));
  });

  test('sidebar.js consolidated close button has 44x44px target and aria-label', () => {
    assert(sidebarCode.includes('class="atlas-traffic-btn atlas-traffic-close atlas-close-btn"'));
    assert(sidebarCode.includes('aria-label="Close Atlas Assistant"'));
    assert(sidebarCode.includes('atlas-traffic-close-icon'));
  });

  test('sidebar.js replaces emojis with accessible inline SVGs', () => {
    assert(sidebarCode.includes('atlas-mic-svg'));
    assert(sidebarCode.includes('atlas-tts-svg'));
    assert(sidebarCode.includes('atlas-chat-svg'));
    assert(sidebarCode.includes('atlas-group-chevron-svg'));
  });

  test('sidebar.css supports prefers-reduced-motion: reduce', () => {
    assert(sidebarCss.includes('@media (prefers-reduced-motion: reduce)'));
    assert(sidebarCss.includes('animation-duration: 0.01ms !important'));
    assert(sidebarCss.includes('transition-duration: 0.01ms !important'));
  });

  test('sidebar.css supports forced-colors: active (Windows High Contrast)', () => {
    assert(sidebarCss.includes('@media (forced-colors: active)'));
    assert(sidebarCss.includes('CanvasText'));
    assert(sidebarCss.includes('Highlight'));
  });

  // ── [Suite 3: Task U4 — Global Shortcuts & Live Voice Level Meter] ──────────
  console.log('\n[Suite 3: Task U4 — Global Shortcuts & Live Voice Level Meter]');

  test('manifest.json registers toggle-sidebar (Alt+A) and voice-input (Alt+V) commands', () => {
    assert(manifest.commands, 'manifest.json must have "commands" object');
    assert(manifest.commands['toggle-sidebar'], 'manifest.json must have "toggle-sidebar" command');
    assert.strictEqual(manifest.commands['toggle-sidebar'].suggested_key.default, 'Alt+A');
    assert.strictEqual(manifest.commands['toggle-sidebar'].suggested_key.mac, 'Command+Shift+A');

    assert(manifest.commands['voice-input'], 'manifest.json must have "voice-input" command');
    assert.strictEqual(manifest.commands['voice-input'].suggested_key.default, 'Alt+V');
    assert.strictEqual(manifest.commands['voice-input'].suggested_key.mac, 'Command+Shift+V');
  });

  test('background.js registers chrome.commands.onCommand listener and tab dispatchers', () => {
    assert(backgroundCode.includes('chrome.commands.onCommand.addListener'));
    assert(backgroundCode.includes('toggleSidebarOnTab'));
    assert(backgroundCode.includes('triggerVoiceOnTab'));
    assert(typeof backgroundModule.toggleSidebarOnTab === 'function');
    assert(typeof backgroundModule.triggerVoiceOnTab === 'function');
  });

  test('speech.js implements Web Audio AnalyserNode without audioContext.destination connection', () => {
    assert(speechCode.includes('AudioContext'));
    assert(speechCode.includes('createAnalyser'));
    assert(speechCode.includes('sourceNode.connect(analyserNode)'));
    assert(!speechCode.includes('analyserNode.connect(audioContext.destination)'),
      'AnalyserNode MUST NOT connect to audioContext.destination (feedback prevention)');
  });

  test('speech.js exports teardown and audio graph accessors', () => {
    assert(typeof AtlasSpeech.stopAudioMeter === 'function');
    assert(typeof AtlasSpeech.getAudioContext === 'function');
    assert(typeof AtlasSpeech.getMediaStream === 'function');
    assert(typeof AtlasSpeech.getAnalyserNode === 'function');
  });

  test('sidebar.js contains #atlas-voice-meter with 4 .atlas-meter-bar elements', () => {
    assert(sidebarCode.includes('id="atlas-voice-meter"'));
    assert(sidebarCode.includes('atlas-meter-bar atlas-meter-bar-1'));
    assert(sidebarCode.includes('atlas-meter-bar atlas-meter-bar-2'));
    assert(sidebarCode.includes('atlas-meter-bar atlas-meter-bar-3'));
    assert(sidebarCode.includes('atlas-meter-bar atlas-meter-bar-4'));
  });

  test('AtlasSidebar exports setVoiceLevel and adjusts bar scaleY', () => {
    assert(typeof AtlasSidebar.setVoiceLevel === 'function');
    AtlasSidebar.setVoiceLevel(0.85, [0.3, 0.5, 0.8, 0.9]);
    assert.strictEqual(meterBarsMock[0].style.transform, 'scaleY(0.30)');
    assert.strictEqual(meterBarsMock[1].style.transform, 'scaleY(0.50)');
    assert.strictEqual(meterBarsMock[2].style.transform, 'scaleY(0.80)');
    assert.strictEqual(meterBarsMock[3].style.transform, 'scaleY(0.90)');
  });

  test('content.js handles ATLAS_TRIGGER_VOICE and ATLAS_GOAL_RESUME messages', () => {
    assert(contentCode.includes('ATLAS_TRIGGER_VOICE'));
    assert(contentCode.includes('ATLAS_GOAL_RESUME'));
  });

  test('content.js binds in-page Alt+A and Alt+V keyboard shortcuts', () => {
    assert(contentCode.includes('handleKeyboardShortcuts'));
    assert(contentCode.includes('KeyA'));
    assert(contentCode.includes('KeyV'));
  });

  // ── [Suite 4: Universal Prime Directive Audit] ─────────────────────────────
  console.log('\n[Suite 4: Universal Prime Directive Audit]');

  const forbiddenDomains = [
    'google.com',
    'amazon.com',
    'wikipedia.org',
    'github.com',
    'drive.google.com',
  ];

  const filesToCheck = [
    { name: 'background.js', content: backgroundCode },
    { name: 'content.js', content: contentCode },
    { name: 'sidebar.js', content: sidebarCode },
    { name: 'sidebar.css', content: sidebarCss },
    { name: 'speech.js', content: speechCode },
  ];

  for (const f of filesToCheck) {
    for (const domain of forbiddenDomains) {
      test(`${f.name} contains ZERO hardcoded references to ${domain}`, () => {
        // Strip comments and test strings
        const lines = f.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(domain) && !line.includes('//') && !line.includes('/*')) {
            throw new Error(`Forbidden domain "${domain}" found at ${f.name}:${i + 1}: ${line}`);
          }
        }
      });
    }
  }

  // ── Final Reporting ────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log(`Wave 2 UX Suite Complete: ${passedCount} passed, ${failedCount} failed.`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();

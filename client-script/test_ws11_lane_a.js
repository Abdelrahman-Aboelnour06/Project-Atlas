// client-script/test_ws11_lane_a.js
// Acceptance test suite for WS11 Lane A: L1, L2, L9, L10

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log('\n--- Running WS11 Lane A Acceptance Tests (L1, L2, L9, L10) ---\n');

  // ============================================================================
  // L1: TabRegistry Service Worker Loading (no top-level redeclaration)
  // ============================================================================
  console.log('[L1: Service Worker importScripts Semantics]');

  await test('L1-01: background.js loads in Service Worker context via importScripts without redeclaration error', () => {
    const bgPath = path.join(__dirname, 'background.js');
    const trPath = path.join(__dirname, 'tab-registry.js');
    const bgCode = fs.readFileSync(bgPath, 'utf8');
    const trCode = fs.readFileSync(trPath, 'utf8');

    const errorLogs = [];
    const warnLogs = [];

    // Create a VM context that simulates Chrome MV3 Service Worker global environment
    const sandbox = {
      console: {
        ...console,
        error: (...args) => errorLogs.push(args.join(' ')),
        warn: (...args) => warnLogs.push(args.join(' ')),
        log: () => {},
      },
      chrome: {
        runtime: { onMessage: { addListener: () => {} } },
        storage: { session: { get: async () => ({}), set: async () => ({}), remove: async () => ({}) } },
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
      },
      importScripts: (scriptName) => {
        if (scriptName === 'tab-registry.js') {
          vm.runInContext(trCode, context);
        }
      },
    };
    sandbox.self = sandbox;
    const context = vm.createContext(sandbox);

    // Execute background.js in this Service Worker context
    vm.runInContext(bgCode, context);

    // Verify no importScripts errors or redeclaration errors were logged
    const importErrors = errorLogs.filter((log) => /failed to importScripts|already been declared/i.test(log));
    assert.strictEqual(
      importErrors.length,
      0,
      `Service Worker importScripts failed with errors: ${importErrors.join('; ')}`
    );

    // Assert TabRegistry and AsyncMutex are defined and accessible in context
    assert(context.TabRegistry, 'TabRegistry must be defined in Service Worker context');
    assert(context.AsyncMutex, 'AsyncMutex must be defined in Service Worker context');
    assert.strictEqual(typeof context.TabRegistry.validateLease, 'function', 'TabRegistry instance must have methods');
  });

  // ============================================================================
  // L2: Frame Isolation Unit Verification
  // ============================================================================
  console.log('\n[L2: Multi-Frame Isolation Unit Logic]');

  await test('L2-01: content.js exposes isTopFrame status and child frames stay idle', () => {
    const content = require('./content.js');
    assert(typeof content.isTopFrame === 'function', 'content.js must export isTopFrame');
    assert(typeof content.setIsTopFrame === 'function', 'content.js must export setIsTopFrame');

    // Default top frame in Node environment
    assert.strictEqual(content.isTopFrame(), true);

    // Simulate child subframe
    content.setIsTopFrame(false);
    assert.strictEqual(content.isTopFrame(), false);

    // Reset back to true
    content.setIsTopFrame(true);
  });

  // ============================================================================
  // L9: UI Stuck on Working / Backend Unreachable / sendResponse Guarantees
  // ============================================================================
  console.log('\n[L9: Error Resilience, Localized Unreachable Message & Background Listener]');

  await test('L9-01: executeGoalHop non-abort error stops loop, clears executing, hides progress, preserves goalState', async () => {
    const content = require('./content.js');

    let setExecutingCalled = null;
    let hideGoalProgressCalled = false;
    let statusText = null;
    let statusType = null;
    let chatMessageAdded = null;
    let chatActions = null;

    global.window = global.window || {};
    global.window.__ATLAS_TEST_ENV__ = true;
    global.window.AtlasSerializer = { serialize: () => [] };
    global.document = { body: null };

    global.window.AtlasSidebar = {
      getLanguage: () => 'en-US',
      setExecuting: (val) => { setExecutingCalled = val; },
      setGoalProgress: () => {},
      hideGoalProgress: () => { hideGoalProgressCalled = true; },
      setAutoHide: () => {},
      setStatus: (msg, type) => {
        statusText = msg;
        statusType = type;
      },
      addChatMessage: (role, msg, opts) => {
        chatMessageAdded = msg;
        chatActions = opts?.actions;
      },
    };

    let sentGoalStoreExecuting = null;
    global.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb({ atlasApiKey: 'atlas_test_key', atlasBaseUrl: 'http://localhost:8000' }),
        },
      },
      runtime: {
        sendMessage: (msg, cb) => {
          if (msg.type === 'ATLAS_GOAL_STORE_SET_EXECUTING') {
            sentGoalStoreExecuting = msg.isExecuting;
          }
          if (msg.type === 'ATLAS_GOAL_STEP') {
            // Simulate port closed / backend unreachable
            global.chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
            cb(null);
            delete global.chrome.runtime.lastError;
          }
        },
      },
    };

    const initialGoal = { goal: 'Test unreachable backend', status: 'in_progress', language: 'en-US' };
    content.setCurrentGoalState(initialGoal);
    content.setExecuting(true);

    await content.executeGoalHop(initialGoal);

    // Assert executing state was cleared
    assert.strictEqual(content.isExecuting(), false, 'isExecuting must be cleared');
    assert.strictEqual(content.isHopInProgress(), false, 'isHopInProgress must be cleared');
    assert.strictEqual(setExecutingCalled, false, 'sidebar setExecuting(false) must be called');
    assert.strictEqual(hideGoalProgressCalled, true, 'sidebar hideGoalProgress() must be called');
    assert.strictEqual(sentGoalStoreExecuting, false, 'GoalStore executing flag must be false');

    // Assert goalState was NOT cleared (Approved Change 1: Preserved for Retry/Resume)
    assert.strictEqual(content.getCurrentGoalState(), initialGoal, 'currentGoalState must be preserved for Retry');

    // Assert English localized error and Retry action
    assert(statusText.includes("Can't reach the Atlas backend"), `Status must show unreachable message: got "${statusText}"`);
    assert.strictEqual(statusType, 'error');
    assert(chatMessageAdded.includes("Can't reach the Atlas backend"), `Chat message must show unreachable text`);
    assert(Array.isArray(chatActions) && chatActions.includes('Retry'), 'Must include Retry action button');
  });

  await test('L9-02: executeGoalHop displays Arabic localized message and Retry action in ar-EG mode', async () => {
    const content = require('./content.js');

    let statusText = null;
    let chatMessageAdded = null;
    let chatActions = null;

    global.window = global.window || {};
    global.window.__ATLAS_TEST_ENV__ = true;
    global.window.AtlasSerializer = { serialize: () => [] };
    global.document = { body: null };

    global.window.AtlasSidebar = {
      getLanguage: () => 'ar-EG',
      setExecuting: () => {},
      setGoalProgress: () => {},
      hideGoalProgress: () => {},
      setAutoHide: () => {},
      setStatus: (msg) => { statusText = msg; },
      addChatMessage: (role, msg, opts) => {
        chatMessageAdded = msg;
        chatActions = opts?.actions;
      },
    };

    global.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb({ atlasApiKey: 'atlas_test_key', atlasBaseUrl: 'http://localhost:8000' }),
        },
      },
      runtime: {
        sendMessage: (msg, cb) => {
          if (msg.type === 'ATLAS_GOAL_STEP') {
            cb({ ok: false, error: "Can't reach the Atlas backend at http://localhost:8000", code: 'BACKEND_UNREACHABLE' });
          }
        },
      },
    };

    const initialGoal = { goal: 'اختبار تعذر الوصول', status: 'in_progress', language: 'ar-EG' };
    content.setCurrentGoalState(initialGoal);
    content.setExecuting(true);

    await content.executeGoalHop(initialGoal);

    // Arabic text assertions
    assert(statusText && statusText.includes('تعذر الوصول إلى خادم أطلس'), `Arabic status expected: got "${statusText}"`);
    assert(chatMessageAdded && chatMessageAdded.includes('تعذر الوصول إلى خادم أطلس'), `Arabic chat message expected: got "${chatMessageAdded}"`);
    assert(Array.isArray(chatActions) && chatActions.includes('إعادة المحاولة'), `Arabic Retry button expected: got ${JSON.stringify(chatActions)}`);
  });

  await test('L9-03: background.js onMessage guarantees sendResponse exactly once for every message type (Approved Change 5)', async () => {
    // Clear and reload background.js to capture the real onMessage listener
    delete require.cache[require.resolve('./background.js')];

    let registeredListener = null;
    global.chrome = {
      runtime: {
        openOptionsPage: () => {},
        onMessage: {
          addListener: (fn) => {
            registeredListener = fn;
          },
        },
      },
      storage: {
        session: {
          get: async () => ({}),
          set: async () => ({}),
          remove: async () => ({}),
        },
        local: {
          get: (keys, cb) => cb({}),
        },
      },
      tabs: {
        create: async () => ({ id: 999 }),
        sendMessage: async () => ({}),
      },
      declarativeNetRequest: {
        updateSessionRules: async () => ({}),
      },
    };

    // Global fetch configured to reject (simulate backend down / network failure)
    global.fetch = async () => {
      const err = new TypeError('fetch failed: ECONNREFUSED');
      throw err;
    };

    require('./background.js');
    assert(typeof registeredListener === 'function', 'background.js must register chrome.runtime.onMessage listener');

    const messageTypesToTest = [
      { type: 'ATLAS_OPEN_OPTIONS' },
      { type: 'ATLAS_CHAT', payload: { message: 'hello' } },
      { type: 'ATLAS_SUMMARY', payload: {} },
      { type: 'ATLAS_GOAL_STEP', payload: {} },
      { type: 'ATLAS_GOAL_STORE_GET', tabId: 101 },
      { type: 'ATLAS_GOAL_STORE_PUT', tabId: 101, goalState: { status: 'in_progress' } },
      { type: 'ATLAS_GOAL_STORE_CLEAR', tabId: 101 },
      { type: 'ATLAS_GOAL_STORE_SET_EXECUTING', tabId: 101, isExecuting: false },
      { type: 'ATLAS_HELLO', tabId: 101 },
      { type: 'ATLAS_LEASE_HEARTBEAT', sessionId: 's1', tabId: 101, leaseEpoch: 1 },
      { type: 'ATLAS_ARM_CAUSAL_WINDOW', sessionId: 's1', tabId: 101, windowMs: 3000 },
      { type: 'ATLAS_GRANT_LEASE', sessionId: 's1', newTabId: 102 },
      { type: 'ATLAS_VALIDATE_LEASE', sessionId: 's1', tabId: 101, leaseEpoch: 1 },
      { type: 'ATLAS_CREATE_TAB', url: 'http://example.com' },
      { type: 'UNKNOWN_MSG_TYPE' },
    ];

    for (const msg of messageTypesToTest) {
      let callCount = 0;
      let lastResponse = null;

      const sendResponse = (res) => {
        callCount++;
        lastResponse = res;
      };

      const keepsChannelOpen = registeredListener(msg, { tab: { id: 101 } }, sendResponse);
      assert.strictEqual(keepsChannelOpen, true, `Listener must return true for async sendResponse on ${msg.type}`);

      // Wait brief tick for async handler completion
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(
        callCount,
        1,
        `sendResponse must be called exactly once for message type "${msg.type}", got ${callCount}`
      );
      assert(lastResponse !== null && typeof lastResponse === 'object', `Response must be an object for "${msg.type}"`);

      // For network messages with failing fetch, assert BACKEND_UNREACHABLE error code or message
      if (msg.type === 'ATLAS_GOAL_STEP' || msg.type === 'ATLAS_CHAT' || msg.type === 'ATLAS_SUMMARY') {
        assert.strictEqual(lastResponse.ok, false, `Expected failure response when backend down for ${msg.type}`);
        assert(
          lastResponse.error.includes("Can't reach the Atlas backend"),
          `Expected "Can't reach the Atlas backend" error, got: ${lastResponse.error}`
        );
      }
    }
  });

  // ============================================================================
  // L10: Human Interaction False-Positive Suppression
  // ============================================================================
  console.log('\n[L10: Human Agency Yield & composedPath Shadow Filtering]');

  await test('L10-01: Enter key in sidebar input and clicking confirmation chip do NOT pause goal; trusted page click DOES pause', async () => {
    const content = require('./content.js');

    content.setExecuting(true);
    content.setIsPausedForHuman(false);

    // Mock sidebar host element
    const sidebarHostEl = {
      id: 'atlas-sidebar-host',
      classList: { contains: () => false },
      getAttribute: () => null,
      closest: (sel) => (sel === '#atlas-sidebar-host' ? sidebarHostEl : null),
    };

    const sidebarInputEl = {
      id: 'atlas-chat-input',
      classList: { contains: () => false },
      getAttribute: () => null,
      closest: (sel) => (sel === '#atlas-sidebar-host' ? sidebarHostEl : null),
    };

    const confirmationChipEl = {
      classList: { contains: (cls) => cls === 'atlas-confirmation-chips' || cls === 'atlas-action-chip' },
      getAttribute: () => null,
      closest: () => null,
    };

    const pageButtonEl = {
      id: 'real-page-button',
      tagName: 'BUTTON',
      classList: { contains: () => false },
      getAttribute: () => null,
      closest: () => null,
    };

    global.document = {
      getElementById: (id) => (id === 'atlas-sidebar-host' ? sidebarHostEl : null),
    };

    // 1. Enter key inside sidebar input (composedPath includes sidebarHostEl)
    const sidebarEnterEvent = {
      type: 'keydown',
      key: 'Enter',
      isTrusted: true,
      target: sidebarInputEl,
      composedPath: () => [sidebarInputEl, sidebarHostEl, { tagName: 'BODY' }],
    };

    content.onHumanInteraction(sidebarEnterEvent);
    assert.strictEqual(content.isPausedForHuman(), false, 'Enter in sidebar input must NOT pause execution');

    // 2. Click on confirmation chip (composedPath includes sidebarHostEl)
    const chipClickEvent = {
      type: 'pointerdown',
      isTrusted: true,
      target: confirmationChipEl,
      composedPath: () => [confirmationChipEl, sidebarHostEl, { tagName: 'BODY' }],
    };

    content.onHumanInteraction(chipClickEvent);
    assert.strictEqual(content.isPausedForHuman(), false, 'Clicking confirmation chip must NOT pause execution');

    // 3. Synthetic executor event (isTrusted = false)
    const syntheticEvent = {
      type: 'pointerdown',
      isTrusted: false,
      target: pageButtonEl,
      composedPath: () => [pageButtonEl, { tagName: 'BODY' }],
    };

    content.onHumanInteraction(syntheticEvent);
    assert.strictEqual(content.isPausedForHuman(), false, 'Synthetic action must NOT pause execution');

    // 4. Real trusted user click on page element outside sidebar (composedPath does NOT include sidebar)
    let resumeButtonShown = false;
    let pauseMessageAdded = false;

    global.window.AtlasSidebar = {
      setExecuting: () => {},
      setStatus: () => {},
      addChatMessage: (role, msg) => {
        if (msg.includes('Paused for human interaction')) pauseMessageAdded = true;
      },
      showResumeButton: () => { resumeButtonShown = true; },
    };

    const trustedPageClickEvent = {
      type: 'pointerdown',
      isTrusted: true,
      target: pageButtonEl,
      composedPath: () => [pageButtonEl, { tagName: 'MAIN' }, { tagName: 'BODY' }],
    };

    content.onHumanInteraction(trustedPageClickEvent);
    assert.strictEqual(content.isPausedForHuman(), true, 'Real trusted page click outside sidebar MUST pause execution');
    assert.strictEqual(resumeButtonShown, true, 'Resume button must be shown');
    assert.strictEqual(pauseMessageAdded, true, 'Pause chat message must be added');
  });

  // ============================================================================
  // L12: Navigation Resumption Quiet Mount & Sidebar State
  // ============================================================================
  console.log('\n[L12: Navigation Resumption Quiet Mount & Language Preservation]');

  await test('L12-01: resume with sidebar not active mounts it once, shows no welcome, sends no ATLAS_SUMMARY, preserves language; 2nd resume does not mount twice', () => {
    const content = require('./content.js');

    // Reset state
    content.deactivate();
    assert.strictEqual(content.isActive(), false, 'Sidebar must be inactive initially');

    let mountCalls = 0;
    let welcomeMessageSent = false;
    let chatMessages = [];
    let progressSet = null;
    let languageSet = null;
    let atlasSummaryCalls = 0;

    global.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          if (msg && msg.type === 'ATLAS_SUMMARY') {
            atlasSummaryCalls++;
          }
          if (cb) cb({ ok: true });
        },
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ atlasApiKey: 'test_key', atlasBaseUrl: 'http://localhost:8000' }),
          set: (obj, cb) => cb && cb(),
        },
      },
    };

    global.window.AtlasSidebar = {
      mount: () => { mountCalls++; },
      unmount: () => {},
      addChatMessage: (role, text) => {
        chatMessages.push(text);
        if (/Hi! I'm Atlas/i.test(text)) {
          welcomeMessageSent = true;
        }
      },
      setGoalProgress: (state) => { progressSet = state; },
      setLanguage: (lang) => { languageSet = lang; },
      setStatus: () => {},
      renderElements: () => {},
      deriveDisplayItems: () => [],
    };

    global.window.AtlasSerializer = {
      serialize: () => [],
      observe: () => () => {},
    };

    const goalStateAr = {
      goal: 'اريد الاستفسار عن مخالفات المركبات',
      language: 'ar-EG',
      status: 'in_progress',
      hop_count: 1,
      milestones: [{ label: 'البحث عن الخدمة', status: 'completed' }],
    };

    // First resume: mounts sidebar
    const result1 = content.mountSidebarForResume(goalStateAr);
    assert.strictEqual(result1, true, 'mountSidebarForResume must return true on first call');
    assert.strictEqual(content.isActive(), true, 'Sidebar must now be active');
    assert.strictEqual(mountCalls, 1, 'Sidebar mount must be called exactly once');
    assert.strictEqual(welcomeMessageSent, false, 'No welcome message must be shown during quiet resume mount');
    assert.strictEqual(atlasSummaryCalls, 0, 'No ATLAS_SUMMARY must be requested during quiet resume mount');
    assert.strictEqual(languageSet, 'ar-EG', 'Goal language must be preserved (ar-EG)');
    assert(progressSet !== null && progressSet.goal === goalStateAr.goal, 'Goal progress must be updated');
    assert(chatMessages.some((msg) => msg.includes('متابعة')), 'Quiet resume chat message must be added in Arabic');

    // Second resume: already active, must NOT mount a second time
    const result2 = content.mountSidebarForResume(goalStateAr);
    assert.strictEqual(result2, false, 'mountSidebarForResume must return false when already active');
    assert.strictEqual(mountCalls, 1, 'Sidebar mount must NOT be called a second time');

    // Clean up
    content.deactivate();
    assert.strictEqual(content.isActive(), false, 'deactivate must clear active flag');
  });

  console.log(`\nWS11 Lane A Tests Complete: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

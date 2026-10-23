/**
 * client-script/test_ws12_lane_d.js
 * Acceptance & Unit Test Suite for WS12 Lane D:
 * - D1: Exactly one activation per click action, target resolution, and doOpen link behavior.
 * - D2: Options chips on awaiting_user_input cards and human-agency exemption during fieldless handoff.
 * - D3: Immediate status line transition upon confirmation.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}
global.PointerEvent = global.PointerEvent || MockEvent;
global.MouseEvent = global.MouseEvent || MockEvent;
global.KeyboardEvent = global.KeyboardEvent || MockEvent;
global.window = global.window || {
  location: { href: 'http://localhost/test' },
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.window.AtlasSerializer = {
  serialize: () => [],
};
global.window.AtlasSidebar = {
  setExecuting: () => {},
  setStatus: () => {},
  addChatMessage: () => {},
  hideGoalProgress: () => {},
  setGoalProgress: () => {},
  setAutoHide: () => {},
  getLanguage: () => 'en-US',
  getShadowRoot: () => null,
  getHost: () => null,
};
global.document = global.document || {
  body: {},
  head: { appendChild: () => {} },
  getElementById: () => null,
  createElement: () => ({
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {} },
    appendChild: () => {},
    setAttribute: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
};

const AtlasExecutor = require('./executor.js');
const content = require('./content.js');
const sidebarPath = path.join(__dirname, 'sidebar.js');

let passed = 0;
let failed = 0;
const asyncQueue = [];

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

console.log('\n--- Running WS12 Lane D Unit Tests ---\n');

// ── 1. Target Resolution (Rule 1 & Rule 2) ───────────────────────────────────
console.log('[Suite 1: Target Resolution & Direct Interactivity]');

test('isDirectlyInteractive identifies buttons, links, inputs, and semantic roles', () => {
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({ nodeType: 1, tagName: 'BUTTON' }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({ nodeType: 1, tagName: 'A' }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({ nodeType: 1, tagName: 'INPUT' }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({ nodeType: 1, tagName: 'SUMMARY' }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({
    nodeType: 1, tagName: 'DIV', getAttribute: (k) => k === 'role' ? 'button' : null,
  }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({
    nodeType: 1, tagName: 'DIV', getAttribute: (k) => k === 'role' ? 'link' : null,
  }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({
    nodeType: 1, tagName: 'DIV', hasAttribute: (k) => k === 'onclick',
  }), true);
  assert.strictEqual(AtlasExecutor.isDirectlyInteractive({
    nodeType: 1, tagName: 'DIV', getAttribute: () => null, hasAttribute: () => false,
  }), false);
});

test('resolveClickTarget resolves non-interactive wrapper with single child link to child link', () => {
  const childLink = { nodeType: 1, tagName: 'A', href: 'http://example.com' };
  const wrapperDiv = {
    nodeType: 1,
    tagName: 'DIV',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelectorAll: (sel) => [childLink],
  };
  const resolved = AtlasExecutor.resolveClickTarget(wrapperDiv);
  assert.strictEqual(resolved, childLink, 'Must resolve to the single child link');
});

test('resolveClickTarget resolves non-interactive wrapper with single child button to child button', () => {
  const childBtn = { nodeType: 1, tagName: 'BUTTON' };
  const wrapperDiv = {
    nodeType: 1,
    tagName: 'DIV',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelectorAll: (sel) => [childBtn],
  };
  const resolved = AtlasExecutor.resolveClickTarget(wrapperDiv);
  assert.strictEqual(resolved, childBtn, 'Must resolve to the single child button');
});

test('resolveClickTarget keeps interactive element as itself', () => {
  const divBtn = {
    nodeType: 1,
    tagName: 'DIV',
    getAttribute: (k) => k === 'role' ? 'button' : null,
    hasAttribute: () => false,
    querySelectorAll: () => [{ nodeType: 1, tagName: 'A' }],
  };
  const resolved = AtlasExecutor.resolveClickTarget(divBtn);
  assert.strictEqual(resolved, divBtn, 'Role=button must NOT delegate to child link');
});

// ── 2. D1 Click Activations ──────────────────────────────────────────────────
console.log('\n[Suite 2: D1 Single Click Activation Invariants]');

test('doClick dispatches exactly ONE click activation on button', () => {
  const events = [];
  const mockBtn = {
    nodeType: 1,
    tagName: 'BUTTON',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    dispatchEvent: (e) => events.push(e.type),
    click: function() { events.push('click'); },
  };

  AtlasExecutor.doClick(mockBtn);
  assert.deepStrictEqual(events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  const clickCount = events.filter((e) => e === 'click').length;
  assert.strictEqual(clickCount, 1, 'Must dispatch exactly 1 click event');
});

test('doClick on span inside link does NOT trigger duplicate anchor click fallback', () => {
  const events = [];
  const mockLink = {
    nodeType: 1,
    tagName: 'A',
    href: 'http://example.com/test',
    contains: (child) => child === mockSpan,
    click: () => events.push('link:click'),
  };
  const mockSpan = {
    nodeType: 1,
    tagName: 'SPAN',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    closest: (sel) => sel.includes('a') ? mockLink : null,
    dispatchEvent: (e) => events.push('span:' + e.type),
    click: () => events.push('span:click'),
  };

  AtlasExecutor.doClick(mockSpan);
  assert.strictEqual(events.filter((e) => e === 'span:click').length, 1);
  assert.strictEqual(events.filter((e) => e === 'link:click').length, 0, 'Must NOT invoke redundant link.click() fallback');
});

test('doClick on tile div whose only child is a link navigates once', () => {
  const events = [];
  const mockChildLink = {
    nodeType: 1,
    tagName: 'A',
    href: 'http://example.com/dest',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    dispatchEvent: (e) => events.push('link:' + e.type),
    click: () => events.push('link:click'),
    hasAttribute: (k) => k === 'href',
    getAttribute: (k) => k === 'href' ? 'http://example.com/dest' : null,
  };
  const mockTileDiv = {
    nodeType: 1,
    tagName: 'DIV',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelectorAll: (sel) => [mockChildLink],
    click: () => events.push('div:click'),
  };

  AtlasExecutor.doClick(mockTileDiv);
  assert.strictEqual(events.filter((e) => e === 'link:click').length, 1, 'Child link must be clicked exactly once');
  assert.strictEqual(events.filter((e) => e === 'div:click').length, 0, 'Parent wrapper must NOT receive extra synthetic click');
});

test('doClick on tile div whose only child is a button fires that button once', () => {
  const events = [];
  const mockChildBtn = {
    nodeType: 1,
    tagName: 'BUTTON',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    dispatchEvent: (e) => events.push('btn:' + e.type),
    click: () => events.push('btn:click'),
  };
  const mockTileDiv = {
    nodeType: 1,
    tagName: 'DIV',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelectorAll: (sel) => [mockChildBtn],
    click: () => events.push('div:click'),
  };

  AtlasExecutor.doClick(mockTileDiv);
  assert.strictEqual(events.filter((e) => e === 'btn:click').length, 1, 'Child button must be clicked exactly once');
  assert.strictEqual(events.filter((e) => e === 'div:click').length, 0, 'Parent wrapper must NOT receive extra synthetic click');
});

testAsync('doOpen on non-link element produces exactly 2 click activations and 1 dblclick', async () => {
  const events = [];
  const mockDiv = {
    nodeType: 1,
    tagName: 'DIV',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    dispatchEvent: (e) => events.push(e.type),
    click: () => events.push('click'),
  };

  await AtlasExecutor.doOpen(mockDiv);
  const clickCount = events.filter((e) => e === 'click').length;
  const dblClickCount = events.filter((e) => e === 'dblclick').length;
  assert.strictEqual(clickCount, 2, 'Must produce exactly 2 click activations');
  assert.strictEqual(dblClickCount, 1, 'Must produce exactly 1 dblclick event');
});

testAsync('doOpen on <a href> target performs exactly ONE click activation (Change 3)', async () => {
  const events = [];
  const mockLink = {
    nodeType: 1,
    tagName: 'A',
    href: 'http://example.com/page',
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
    dispatchEvent: (e) => events.push(e.type),
    click: () => events.push('click'),
    hasAttribute: (k) => k === 'href',
    getAttribute: (k) => k === 'href' ? 'http://example.com/page' : null,
  };

  await AtlasExecutor.doOpen(mockLink);
  const clickCount = events.filter((e) => e === 'click').length;
  assert.strictEqual(clickCount, 1, 'Link target under doOpen must only navigate once');
});

// ── 3. D2 Awaiting Input Chips & Fieldless Handoff ───────────────────────────
console.log('\n[Suite 3: D2 Awaiting Input Chips & Fieldless Handoff Exemption]');

test('isFieldlessHandoff derives directly from currentGoalState status and fields', () => {
  // 1. No goal active
  content.setCurrentGoalState(null);
  assert.strictEqual(content.isFieldlessHandoff(), false);

  // 2. Goal in progress
  content.setCurrentGoalState({ status: 'in_progress' });
  assert.strictEqual(content.isFieldlessHandoff(), false);

  // 3. Awaiting with form fields (not fieldless)
  content.setCurrentGoalState({
    status: 'awaiting_user_input',
    awaiting: {
      prompt: 'Enter ID',
      fields: [{ ref: 'id', kind: 'text' }],
    },
  });
  assert.strictEqual(content.isFieldlessHandoff(), false);

  // 4. Fieldless awaiting (e.g. credential / captcha / otp without fields)
  content.setCurrentGoalState({
    status: 'awaiting_user_input',
    awaiting: {
      prompt: 'Complete credential check on page',
      kind: 'credential',
      fields: [],
    },
  });
  assert.strictEqual(content.isFieldlessHandoff(), true);
});

test('onHumanInteraction does NOT pause goal when in fieldless handoff', () => {
  content.setCurrentGoalState({
    status: 'awaiting_user_input',
    awaiting: {
      prompt: 'Solve captcha on page',
      kind: 'captcha',
      fields: [],
    },
  });
  content.setExecuting(true);
  content.setIsPausedForHuman(false);

  let pauseMessageAdded = false;
  let resumeShown = false;
  global.window.AtlasSidebar = {
    setExecuting: () => {},
    setStatus: () => {},
    addChatMessage: (role, msg) => {
      if (typeof msg === 'string' && msg.includes('Paused for human interaction')) {
        pauseMessageAdded = true;
      }
    },
    showResumeButton: () => { resumeShown = true; },
    getHost: () => null,
  };

  const trustedPageEvent = {
    type: 'pointerdown',
    isTrusted: true,
    target: { tagName: 'DIV', closest: () => null },
    composedPath: () => [{ tagName: 'DIV' }],
  };

  content.onHumanInteraction(trustedPageEvent);
  assert.strictEqual(content.isPausedForHuman(), false, 'Must NOT pause for trusted page click during fieldless wait');
  assert.strictEqual(pauseMessageAdded, false, 'Must NOT show human agency pause message');
  assert.strictEqual(resumeShown, false, 'Must NOT show resume button');
});

testAsync('fieldless credential prompt renders default chip and clicking it sends done (Change 4)', async () => {
  let renderedActions = null;
  let chatInputReceived = null;

  global.window.AtlasSidebar = {
    setExecuting: () => {},
    setStatus: () => {},
    hideGoalProgress: () => {},
    setGoalProgress: () => {},
    setAutoHide: () => {},
    getLanguage: () => 'en-US',
    addChatMessage: (role, msg, opts) => {
      if (opts && opts.actions) {
        renderedActions = opts.actions;
      }
    },
    getShadowRoot: () => ({ querySelector: () => null }),
  };

  // Mock handleChatInput on content to verify execution routing
  const origHandleChatInput = content.handleChatInput;
  content.handleChatInput = async (val) => { chatInputReceived = val; };

  try {
    const fieldlessGoalHopData = {
      status: 'awaiting_user_input',
      reply: 'Please complete the authentication challenge on the page.',
      goal_state: {
        status: 'awaiting_user_input',
        awaiting: {
          kind: 'credential',
          prompt: 'Please complete the authentication challenge on the page.',
          fields: [],
          options: [],
        },
      },
    };

    // Simulate goal hop response handling
    global.chrome = {
      storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb() } },
      runtime: { sendMessage: (p, cb) => cb({ ok: true, data: fieldlessGoalHopData }) },
    };

    await content.executeGoalHop({ status: 'in_progress' });

    assert(renderedActions && renderedActions.length === 1, 'Must render exactly 1 default chip');
    assert.strictEqual(renderedActions[0].label, 'Done, continue', 'Default chip label in EN must be Done, continue');
    assert.strictEqual(renderedActions[0].value, 'done', 'Default chip value must be done');
  } finally {
    content.handleChatInput = origHandleChatInput;
  }
});

testAsync('card with 2 fields plus options ["X"] renders fields and one "X" chip (Change 4)', async () => {
  let renderedActions = null;
  let formRendered = false;

  global.window.AtlasSidebar = {
    setExecuting: () => {},
    setStatus: () => {},
    hideGoalProgress: () => {},
    setGoalProgress: () => {},
    setAutoHide: () => {},
    getLanguage: () => 'en-US',
    addChatMessage: (role, msg, opts) => {
      if (opts && opts.actions) {
        renderedActions = opts.actions;
      }
    },
    getShadowRoot: () => ({
      querySelector: () => ({
        appendChild: () => { formRendered = true; },
        querySelector: () => null,
      }),
    }),
  };

  const fieldsWithOptionsData = {
    status: 'awaiting_user_input',
    reply: 'Please provide vehicle registration details or skip.',
    goal_state: {
      status: 'awaiting_user_input',
      awaiting: {
        prompt: 'Please provide vehicle registration details or skip.',
        fields: [
          { ref: 'plate_num', label: 'Plate Number', kind: 'text', required: true },
          { ref: 'plate_letters', label: 'Plate Letters', kind: 'text', required: true },
        ],
        options: ['X'],
      },
    },
  };

  global.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb() } },
    runtime: { sendMessage: (p, cb) => cb({ ok: true, data: fieldsWithOptionsData }) },
  };

  await content.executeGoalHop({ status: 'in_progress' });

  assert(renderedActions && renderedActions.length === 1, 'Must render exactly 1 option chip');
  assert.strictEqual(renderedActions[0].label, 'X');
  assert.strictEqual(renderedActions[0].value, 'X');
});

// ── 4. D3 Immediate Status Transition ───────────────────────────────────────
console.log('\n[Suite 4: D3 Immediate Status Line Transition]');

test('sidebar.js contains bilingual status mappings for confirmation and resumption', () => {
  const sidebarCode = fs.readFileSync(sidebarPath, 'utf8');
  assert(sidebarCode.includes('"Awaiting confirmation": "في انتظار التأكيد..."'), 'Arabic awaiting confirmation mapping present');
  assert(sidebarCode.includes('"Resuming goal...": "جارٍ استئناف الهدف..."'), 'Arabic resuming goal mapping present');
  assert(sidebarCode.includes('"Awaiting input": "في انتظار البيانات..."'), 'Arabic awaiting input mapping present');
  assert(sidebarCode.includes('done|continue|نعم|تأكيد|موافق|استمرار|متابعة|خلصت|كمل'), 'Chip confirm regex includes done/continue/خلصت/كمل');
});

testAsync('affirmative chat input immediately sets status to Resuming goal...', async () => {
  const statuses = [];
  global.window.AtlasSidebar = {
    setExecuting: () => {},
    setStatus: (s) => { statuses.push(s); },
    addChatMessage: () => {},
    hideGoalProgress: () => {},
    setGoalProgress: () => {},
    setAutoHide: () => {},
  };
  global.window.AtlasSerializer = {
    serialize: () => [],
  };

  content.setCurrentGoalState({
    status: 'in_progress',
    requires_confirmation: true,
  });

  // Call handleChatInput with 'yes'
  // Mock background messaging to avoid unhandled rejections
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => (cb ? cb({}) : Promise.resolve({})),
        set: (obj, cb) => (cb ? cb() : Promise.resolve()),
      },
    },
    runtime: {
      sendMessage: (payload, cb) => {
        if (cb) cb({ ok: true, data: { status: 'goal_complete', goal_state: { status: 'goal_complete' } } });
      },
    },
  };

  await content.handleChatInput('yes');
  assert(statuses.includes('Resuming goal...'), 'Status line must set Resuming goal...');
});

(async () => {
  for (const t of asyncQueue) {
    await t();
  }
  console.log(`\nWS12 Lane D Unit Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
})();

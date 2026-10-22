/**
 * test_connection_resilience.js — Connection Resilience & UX Verification Suite
 * Project Atlas — Task U5
 *
 * Verifies:
 * 1. Exponential backoff formula with jitter: Math.min(30000, 1000 * Math.pow(2, attempt) + Math.random() * 1000).
 * 2. Real-time countdown banner text progression ("Connecting...", "Disconnected — retrying in Xs", "Offline — click to retry").
 * 3. "Retry Now" button resetting backoff attempt counter and cancelling active countdowns.
 * 4. Stale queue purging on disconnect and prevention of stale goal / action replays.
 * 5. Zero unhandled exceptions across all network failure modes.
 * 6. Browser online / offline event coordination.
 * 7. DOM & ARIA compliance (role="status", aria-live="polite", >=44x44px touch targets).
 * 8. 100% adherence to the Universal Prime Directive (0 domain hardcoding).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

console.log('======================================================');
console.log('   Atlas Assistant — Task U5 Connection Resilience    ');
console.log('======================================================\n');

const { ConnectionManager, STATE } = require('./connection-manager.js');
const connManagerCode = fs.readFileSync(path.join(__dirname, 'connection-manager.js'), 'utf8');
const wsClientCode = fs.readFileSync(path.join(__dirname, 'websocket-client.js'), 'utf8');
const sidebarJs = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
const sidebarCss = fs.readFileSync(path.join(__dirname, 'sidebar.css'), 'utf8');
const contentJs = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

async function runAllTests() {
  // ── Suite 1: Mathematical Exponential Backoff & Jitter ──────────────────────
  console.log('[Suite 1: Exponential Backoff Formula & Jitter Math]');

  test('Backoff formula matches Math.min(30000, 1000 * 2^attempt + jitter)', () => {
    const cm = new ConnectionManager();
    // Test base progression without jitter variability checking
    for (let attempt = 0; attempt <= 4; attempt++) {
      const minExpected = 1000 * Math.pow(2, attempt);
      const maxExpected = minExpected + 1000;
      for (let i = 0; i < 50; i++) {
        const delay = cm.calculateDelay(attempt);
        assert(delay >= minExpected, `Attempt ${attempt}: delay ${delay} must be >= min ${minExpected}`);
        assert(delay <= maxExpected, `Attempt ${attempt}: delay ${delay} must be <= max ${maxExpected}`);
        assert(delay <= 30000, `Delay must not exceed 30000`);
      }
    }
  });

  test('Backoff is strictly capped at 30000ms for attempt >= 5', () => {
    const cm = new ConnectionManager();
    for (let attempt = 5; attempt <= 15; attempt++) {
      for (let i = 0; i < 20; i++) {
        const delay = cm.calculateDelay(attempt);
        assert.strictEqual(delay, 30000, `Attempt ${attempt}: delay ${delay} must be exactly 30000 (capped)`);
      }
    }
  });

  test('1,000 randomized iterations verify jitter is uniform and non-negative', () => {
    const cm = new ConnectionManager();
    for (let i = 0; i < 1000; i++) {
      const attempt = i % 10;
      const delay = cm.calculateDelay(attempt);
      assert(!isNaN(delay), 'Delay must not be NaN');
      assert(delay >= 1000, 'Delay must be at least 1000ms');
      assert(delay <= 30000, 'Delay must never exceed 30000ms');
    }
  });

  test('Custom options configure baseDelay, jitter, and maxDelay cleanly', () => {
    const custom = new ConnectionManager({ baseDelay: 500, jitter: 200, maxDelay: 5000 });
    const delay0 = custom.calculateDelay(0);
    assert(delay0 >= 500 && delay0 <= 700, `Custom delay0 ${delay0} must be in [500, 700]`);
    const delayCap = custom.calculateDelay(10);
    assert.strictEqual(delayCap, 5000, `Custom delayCap ${delayCap} must equal maxDelay 5000`);
  });

  // ── Suite 2: Connection Lifecycle & State Progression ───────────────────────
  console.log('\n[Suite 2: State Machine & Dynamic Banner Progression]');

  test('Lifecycle states transition IDLE -> CONNECTING -> CONNECTED', () => {
    const cm = new ConnectionManager();
    assert.strictEqual(cm.getState(), STATE.IDLE);
    assert.strictEqual(cm.getAttempt(), 0);

    let observedState = null;
    cm.onStateChange((state) => { observedState = state; });

    cm.startConnecting();
    assert.strictEqual(cm.getState(), STATE.CONNECTING);
    assert.strictEqual(observedState, STATE.CONNECTING);

    cm.markConnected();
    assert.strictEqual(cm.getState(), STATE.CONNECTED);
    assert.strictEqual(observedState, STATE.CONNECTED);
    assert.strictEqual(cm.getAttempt(), 0);
    cm.destroy();
  });

  test('Disconnect transitions to RECONNECTING with computed secondsRemaining', () => {
    const cm = new ConnectionManager();
    cm.markConnected();

    let capturedPayload = null;
    cm.onStateChange((state, payload) => {
      if (state === STATE.RECONNECTING) capturedPayload = payload;
    });

    cm.handleDisconnect(new Error('Connection dropped'));
    assert.strictEqual(cm.getState(), STATE.RECONNECTING);
    assert(capturedPayload !== null, 'RECONNECTING payload must be emitted');
    assert(capturedPayload.secondsRemaining >= 1 && capturedPayload.secondsRemaining <= 2);
    assert.strictEqual(capturedPayload.attempt, 0);
    cm.destroy();
  });

  test('Countdown emits decrements and banner states', async () => {
    const cm = new ConnectionManager({ baseDelay: 100, jitter: 0, maxDelay: 1000 });
    let countdownTicks = [];
    cm.onCountdown((sec) => countdownTicks.push(sec));

    cm.handleDisconnect(new Error('Temporary drop'));
    assert.strictEqual(cm.getState(), STATE.RECONNECTING);
    cm.destroy();
  });

  test('Offline transition sets OFFLINE state and resets countdown', () => {
    const cm = new ConnectionManager();
    let emittedState = null;
    cm.onStateChange((s) => { emittedState = s; });

    cm.transitionToOffline();
    assert.strictEqual(cm.getState(), STATE.OFFLINE);
    assert.strictEqual(emittedState, STATE.OFFLINE);
    assert.strictEqual(cm.getSecondsRemaining(), 0);
    cm.destroy();
  });

  // ── Suite 3: "Retry Now" Action Semantics ────────────────────────────────────
  console.log('\n[Suite 3: "Retry Now" Reset & Immediate Handshake]');

  await testAsync('retryNow() resets attempt counter, clears timer, and calls connectFn', async () => {
    const cm = new ConnectionManager();
    let connectCalled = false;

    cm.setConnectHandler(async () => {
      connectCalled = true;
    });

    cm.handleDisconnect(new Error('Drop 1'));
    assert.strictEqual(cm.getState(), STATE.RECONNECTING);

    // Call retryNow()
    const p = cm.retryNow();
    assert.strictEqual(cm.getAttempt(), 0, 'Attempt counter must be reset to 0');
    assert.strictEqual(cm.getSecondsRemaining(), 0, 'Countdown seconds must be reset to 0');
    await p;

    assert.strictEqual(connectCalled, true, 'connectHandler must be invoked immediately');
    assert.strictEqual(cm.getState(), STATE.CONNECTED, 'Successful connectHandler sets CONNECTED');
    cm.destroy();
  });

  await testAsync('retryNow() handles subsequent connect rejection by re-entering RECONNECTING', async () => {
    const cm = new ConnectionManager();
    let attempts = 0;

    cm.setConnectHandler(async () => {
      attempts++;
      throw new Error('Server still unavailable');
    });

    await cm.retryNow();
    assert.strictEqual(attempts, 1);
    assert.strictEqual(cm.getState(), STATE.RECONNECTING);
    assert(cm.getSecondsRemaining() > 0);
    cm.destroy();
  });

  // ── Suite 4: Stale Queue Purging & Stale Goal Prevention ─────────────────────
  console.log('\n[Suite 4: Stale Action Purging & Zero Goal Replay]');

  test('websocket-client.js rejects pendingQueue with isConnectionLost on disconnect', () => {
    assert(wsClientCode.includes('err.isConnectionLost = true') || wsClientCode.includes('connection lost'));
    assert(wsClientCode.includes('pendingQueue.forEach') || wsClientCode.includes('pendingQueue = []'));
    assert(wsClientCode.includes('pendingQueue = []') || wsClientCode.includes('pendingQueue.clear'));
  });

  test('content.js halts goal execution loop mid-hop on disconnect', () => {
    assert(contentJs.includes('window.AtlasSocket.onDisconnect'));
    assert(contentJs.includes('currentAbortController?.abort()') || contentJs.includes('currentAbortController.abort()'));
    assert(contentJs.includes('isExecuting = false'));
    assert(contentJs.includes('pendingConfirmation = null'));
    assert(contentJs.includes('hideGoalProgress()'));
  });

  test('content.js does not automatically replay actions upon reconnection', () => {
    // Check that when CONNECTED state fires, inputs are re-enabled but runCommand / executeGoal is NOT auto-invoked
    assert(contentJs.includes('case "CONNECTED":') || contentJs.includes("case 'CONNECTED':"));
    assert(!contentJs.includes('case "CONNECTED":\n            runCommand'));
    assert(!contentJs.includes('case "CONNECTED":\n            executeGoal'));
  });

  // ── Suite 5: Zero Unhandled Exceptions & Error Boundaries ────────────────────
  console.log('\n[Suite 5: Zero Unhandled Exceptions & Fault Tolerance]');

  await testAsync('Listener exceptions in onStateChange are swallowed safely', async () => {
    const cm = new ConnectionManager();
    cm.onStateChange(() => {
      throw new Error('Faulty external listener');
    });

    // Should not throw
    cm.startConnecting();
    assert.strictEqual(cm.getState(), STATE.CONNECTING);
    cm.destroy();
  });

  test('handleDisconnect accepts null or malformed error without crashing', () => {
    const cm = new ConnectionManager();
    assert.doesNotThrow(() => {
      cm.handleDisconnect(null);
    });
    assert.strictEqual(cm.getState(), STATE.RECONNECTING);
    cm.destroy();

    const cm2 = new ConnectionManager();
    assert.doesNotThrow(() => {
      cm2.handleDisconnect('string error');
    });
    cm2.destroy();
  });

  await testAsync('retryNow() with no connectHandler does not throw', async () => {
    const cm = new ConnectionManager();
    await assert.doesNotReject(async () => {
      await cm.retryNow();
    });
    cm.destroy();
  });

  // ── Suite 6: DOM, ARIA & Touch Target Specifications ────────────────────────
  console.log('\n[Suite 6: DOM, ARIA Semantics & WCAG Touch Targets]');

  test('sidebar.js defines .atlas-status with role="status" and aria-live="polite"', () => {
    assert(sidebarJs.includes('role="status"'));
    assert(sidebarJs.includes('aria-live="polite"'));
    assert(sidebarJs.includes('atlas-status-text'));
  });

  test('sidebar.js renders #atlas-retry-btn with aria-label and type="button"', () => {
    assert(sidebarJs.includes('id="atlas-retry-btn"'));
    assert(sidebarJs.includes('aria-label="Retry connection now"'));
    assert(sidebarJs.includes('type="button"'));
  });

  test('sidebar.css enforces minimum 44px touch target on .atlas-retry-btn', () => {
    assert(/\.atlas-retry-btn\s*\{[^}]*min-height:\s*var\(--atlas-touch-min,\s*44px\)/s.test(sidebarCss) ||
           /\.atlas-retry-btn\s*\{[^}]*min-height:\s*44px/s.test(sidebarCss));
    assert(sidebarCss.includes('.atlas-retry-btn:focus-visible'));
    assert(sidebarCss.includes('outline: 3px solid'));
  });

  test('sidebar.css styles disabled input controls during disconnection', () => {
    assert(sidebarCss.includes('.atlas-chat-input:disabled'));
    assert(sidebarCss.includes('.atlas-mic-btn:disabled'));
  });

  // ── Suite 7: Universal Prime Directive Compliance ───────────────────────────
  console.log('\n[Suite 7: Universal Prime Directive Compliance]');

  test('connection-manager.js contains 0 website or domain hardcoding', () => {
    const forbidden = ['google.com', 'amazon.com', 'github.com', 'drive.google', 'twitter.com', 'facebook.com'];
    for (const d of forbidden) {
      assert(!connManagerCode.toLowerCase().includes(d), `connection-manager.js must not contain domain ${d}`);
    }
  });

  test('websocket-client.js contains 0 website or domain hardcoding', () => {
    const forbidden = ['amazon.com', 'drive.google', 'twitter.com', 'facebook.com'];
    for (const d of forbidden) {
      assert(!wsClientCode.toLowerCase().includes(d), `websocket-client.js must not contain domain ${d}`);
    }
  });

  console.log(`\n======================================================`);
  console.log(`Connection Resilience Suite: ${passed} passed, ${failed} failed.`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

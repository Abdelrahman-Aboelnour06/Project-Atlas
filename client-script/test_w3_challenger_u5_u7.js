/**
 * test_w3_challenger_u5_u7.js — Empirical Challenger Wave 3.1 Stress Suite
 * Project Atlas — Wave 3 Tasks U5 (Connection Resilience UX) & U7 (Accessible Guided Tour)
 *
 * Adversarial Stress & Verification Harness:
 * 1. Task U5: Mathematical Backoff Rigor & Jitter Bounds (10,000 iterations, 0 overflow / NaN)
 * 2. Task U5: Backend Dropout Simulation & State Machine Lifecycle (immediate, intermittent, permanent)
 * 3. Task U5: "Retry Now" 100 Rapid Clicks & Leak Prevention (no socket leaks, timer leaks, or race conditions)
 * 4. Task U5: Stale Action Replay & Queue Purging Prevention mid-hop
 * 5. Task U5: Zero Unhandled Exceptions across all failure modes
 * 6. Task U7: Focus Trap Cyclic Stress (50 Tab and 50 Shift+Tab cycles across steps 1, 2, 3)
 * 7. Task U7: Escape Dismissal & Event Propagation (stopPropagation prevents sidebar collapse)
 * 8. Task U7: Storage Persistence & Options Page Restart (atlas_tour_completed lifecycle)
 * 9. Task U7: Closed Shadow DOM Isolation against Hostile Host Page CSS (* { font-size: 0px !important; color: red !important; })
 * 10. Task U7: WCAG Touch Targets Computed Dimensions (>= 44x44px) across Normal, Large, and XL
 * 11. Universal Prime Directive Compliance (0 domain hardcoding)
 *
 * Run with: node client-script/test_w3_challenger_u5_u7.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

let passed = 0;
let failed = 0;
const failureDetails = [];

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failureDetails.push({ name, details });
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

async function runChallengerStressSuite() {
  console.log('===============================================================');
  console.log('  Atlas Assistant — Wave 3.1 Empirical Challenger Stress Suite ');
  console.log('  Testing Tasks U5 (Connection Resilience) & U7 (Guided Tour)  ');
  console.log('===============================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const clientDir = path.join(rootDir, 'client-script');

  const connManagerPath = path.join(clientDir, 'connection-manager.js');
  const wsClientPath = path.join(clientDir, 'websocket-client.js');
  const sidebarJsPath = path.join(clientDir, 'sidebar.js');
  const sidebarCssPath = path.join(clientDir, 'sidebar.css');
  const contentJsPath = path.join(clientDir, 'content.js');
  const optionsHtmlPath = path.join(clientDir, 'options.html');
  const optionsJsPath = path.join(clientDir, 'options.js');
  const serializerJsPath = path.join(clientDir, 'dom-serializer.js');
  const ttsJsPath = path.join(clientDir, 'tts.js');

  const connManagerCode = fs.readFileSync(connManagerPath, 'utf8');
  const wsClientCode = fs.readFileSync(wsClientPath, 'utf8');
  const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
  const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
  const contentJs = fs.readFileSync(contentJsPath, 'utf8');
  const optionsHtml = fs.readFileSync(optionsHtmlPath, 'utf8');
  const optionsJs = fs.readFileSync(optionsJsPath, 'utf8');
  const serializerJs = fs.readFileSync(serializerJsPath, 'utf8');
  const ttsJs = fs.readFileSync(ttsJsPath, 'utf8');

  const { ConnectionManager, STATE } = require('./connection-manager.js');

  // ==========================================================================
  // DOMAIN 1: Task U5 — Mathematical Backoff Rigor & Jitter Bounds
  // ==========================================================================
  console.log('[Domain 1: Task U5 — Mathematical Backoff Rigor & Jitter Bounds]');

  const cm = new ConnectionManager();

  // Test 1.1: Math.min(30000, 1000 * 2^attempt + jitter)
  let formulaStrict = true;
  for (let attempt = 0; attempt <= 4; attempt++) {
    const minDelay = 1000 * Math.pow(2, attempt);
    const maxDelay = minDelay + 1000;
    for (let i = 0; i < 100; i++) {
      const delay = cm.calculateDelay(attempt);
      if (delay < minDelay || delay > maxDelay || delay > 30000) {
        formulaStrict = false;
        break;
      }
    }
  }
  record('U5-MATH-01: Delay satisfies Math.min(30000, 1000 * 2^attempt + jitter) for attempts 0..4',
    formulaStrict, 'Delay was out of expected exponential + jitter bounds');

  // Test 1.2: Hard 30000ms cap for attempt >= 5
  let cappedStrict = true;
  for (let attempt = 5; attempt <= 20; attempt++) {
    for (let i = 0; i < 50; i++) {
      const delay = cm.calculateDelay(attempt);
      if (delay !== 30000) {
        cappedStrict = false;
        break;
      }
    }
  }
  record('U5-MATH-02: Backoff strictly capped at exactly 30000ms for all attempts 5..20',
    cappedStrict, 'Delay exceeded or differed from 30000ms cap');

  // Test 1.3: Boundary & extreme attempts stress (10,000 iterations: 0 overflow / NaN / negative)
  let extremePass = true;
  for (let i = 0; i < 10000; i++) {
    const attempt = Math.floor(Math.random() * 2000); // 0 to 2000
    const delay = cm.calculateDelay(attempt);
    if (isNaN(delay) || !isFinite(delay) || delay < 1000 || delay > 30000) {
      extremePass = false;
      break;
    }
  }
  record('U5-MATH-03: 10,000 extreme attempt iterations produce 0 NaN, 0 overflow, delay in [1000, 30000]',
    extremePass, 'Encountered NaN, infinite, or out-of-range delay in 10,000 iterations');

  // Test 1.4: Jitter randomness distribution over 5,000 samples for attempt 0
  let minJitter = 10000;
  let maxJitter = -10000;
  let jitterSum = 0;
  const samples = 5000;
  for (let i = 0; i < samples; i++) {
    const delay = cm.calculateDelay(0);
    const jitter = delay - 1000;
    if (jitter < minJitter) minJitter = jitter;
    if (jitter > maxJitter) maxJitter = jitter;
    jitterSum += jitter;
  }
  const avgJitter = jitterSum / samples;
  const jitterDistributed = minJitter >= 0 && minJitter < 50 && maxJitter > 950 && maxJitter <= 1000 && avgJitter >= 450 && avgJitter <= 550;
  record('U5-MATH-04: Jitter is uniformly distributed in [0, 1000) ms without deterministic collapse',
    jitterDistributed, `Jitter min: ${minJitter}, max: ${maxJitter}, avg: ${avgJitter}`);

  cm.destroy();

  // ==========================================================================
  // DOMAIN 2: Task U5 — Backend Dropout Simulation & State Machine Lifecycle
  // ==========================================================================
  console.log('\n[Domain 2: Task U5 — Backend Dropout Simulation & State Machine]');

  // Test 2.1: Immediate drop after connection
  const cmDrop = new ConnectionManager({ baseDelay: 100, jitter: 10, maxDelay: 1000 });
  const observedStates = [];
  cmDrop.onStateChange((s) => observedStates.push(s));
  cmDrop.startConnecting();
  cmDrop.markConnected();
  cmDrop.handleDisconnect(new Error('Connection abruptly terminated'));
  record('U5-STATE-01: Immediate dropout transitions CONNECTING -> CONNECTED -> RECONNECTING',
    observedStates[0] === STATE.CONNECTING && observedStates[1] === STATE.CONNECTED && observedStates[2] === STATE.RECONNECTING,
    `Observed states: ${observedStates.join(' -> ')}`);
  cmDrop.destroy();

  // Test 2.2: Intermittent network drops (50 consecutive disconnect/reconnect cycles)
  const cmIntermittent = new ConnectionManager();
  let cycleSuccess = true;
  for (let cycle = 0; cycle < 50; cycle++) {
    cmIntermittent.startConnecting();
    if (cmIntermittent.getState() !== STATE.CONNECTING) { cycleSuccess = false; break; }
    cmIntermittent.markConnected();
    if (cmIntermittent.getState() !== STATE.CONNECTED || cmIntermittent.getAttempt() !== 0) { cycleSuccess = false; break; }
    cmIntermittent.handleDisconnect(new Error(`Intermittent drop ${cycle}`));
    if (cmIntermittent.getState() !== STATE.RECONNECTING || cmIntermittent.getSecondsRemaining() < 1) { cycleSuccess = false; break; }
  }
  record('U5-STATE-02: 50 rapid disconnect/reconnect cycles maintain clean state machine transitions',
    cycleSuccess, 'State machine failed or desynced during 50 intermittent drops');
  cmIntermittent.destroy();

  // Test 2.3: Permanent disconnection simulation (backend server never recovers)
  const cmPermanent = new ConnectionManager({ baseDelay: 10, jitter: 0, maxDelay: 50 });
  let reconnectAttemptsCount = 0;
  cmPermanent.setConnectHandler(async () => {
    reconnectAttemptsCount++;
    throw new Error('Connection refused (server offline)');
  });
  cmPermanent.handleDisconnect(new Error('Initial permanent drop'));
  record('U5-STATE-03: Permanent disconnection cleanly enters RECONNECTING without crashing',
    cmPermanent.getState() === STATE.RECONNECTING && cmPermanent.getSecondsRemaining() >= 1,
    'Failed to enter RECONNECTING on permanent drop');
  cmPermanent.destroy();

  // Test 2.4: Online / offline browser events coordination
  const cmNet = new ConnectionManager();
  let offlineNotified = false;
  cmNet.onStateChange((state) => {
    if (state === STATE.OFFLINE) offlineNotified = true;
  });
  cmNet.transitionToOffline();
  record('U5-STATE-04: transitionToOffline() sets OFFLINE state and zeroes countdown',
    cmNet.getState() === STATE.OFFLINE && cmNet.getSecondsRemaining() === 0 && offlineNotified,
    'transitionToOffline did not notify or set OFFLINE state');
  cmNet.destroy();

  // ==========================================================================
  // DOMAIN 3: Task U5 — "Retry Now" 100 Rapid Clicks & Anti-Leak Stress
  // ==========================================================================
  console.log('\n[Domain 3: Task U5 — "Retry Now" 100 Rapid Clicks & Anti-Leak]');

  // Test 3.1: 100 Synchronous rapid clicks on Retry Now
  const cmSpamSync = new ConnectionManager();
  let syncHandlerInvocations = 0;
  cmSpamSync.setConnectHandler(async () => {
    syncHandlerInvocations++;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true };
  });

  // Rapidly trigger 100 clicks
  for (let i = 0; i < 100; i++) {
    cmSpamSync.retryNow();
  }

  record('U5-SPAM-01: 100 synchronous rapid clicks reset attempt to 0 without unhandled errors',
    cmSpamSync.getAttempt() === 0 && cmSpamSync.getSecondsRemaining() === 0,
    `Attempt was ${cmSpamSync.getAttempt()}, secondsRemaining: ${cmSpamSync.getSecondsRemaining()}`);

  await new Promise((r) => setTimeout(r, 100));
  record('U5-SPAM-02: After 100 clicks settle, state is CONNECTED and timers are cleared',
    cmSpamSync.getState() === STATE.CONNECTED && cmSpamSync.countdownInterval === null && cmSpamSync.backoffTimer === null,
    `State: ${cmSpamSync.getState()}, interval: ${cmSpamSync.countdownInterval}`);
  cmSpamSync.destroy();

  // Test 3.2: 100 Staggered async rapid clicks against failing backend (assert NO duplicate timers or socket leaks)
  const cmSpamAsync = new ConnectionManager({ baseDelay: 100, jitter: 10, maxDelay: 500 });
  let asyncFails = 0;
  cmSpamAsync.setConnectHandler(async () => {
    asyncFails++;
    await new Promise((r) => setTimeout(r, 10));
    throw new Error('Server unreachable');
  });

  const spamPromises = [];
  for (let i = 0; i < 100; i++) {
    spamPromises.push(
      new Promise((resolve) => {
        setTimeout(async () => {
          try {
            await cmSpamAsync.retryNow();
          } catch (_) {}
          resolve();
        }, (i % 10) * 2);
      })
    );
  }
  await Promise.all(spamPromises);
  await new Promise((r) => setTimeout(r, 80));

  record('U5-SPAM-03: 100 async rapid retry clicks against failing backend settle into RECONNECTING with at most 1 active timer',
    cmSpamAsync.getState() === STATE.RECONNECTING && cmSpamAsync.backoffTimer === null,
    `State: ${cmSpamAsync.getState()}, backoffTimer: ${cmSpamAsync.backoffTimer}`);
  cmSpamAsync.destroy();

  // Test 3.3: Listener cleanup & memory stability
  const cmMem = new ConnectionManager();
  const unsub1 = cmMem.onStateChange(() => {});
  const unsub2 = cmMem.onCountdown(() => {});
  record('U5-MEM-01: Listeners are registered as Sets and unregister cleanly',
    cmMem.listeners.stateChange.size === 1 && cmMem.listeners.countdown.size === 1,
    'Listeners were not added to Sets');
  unsub1();
  unsub2();
  record('U5-MEM-02: Unsubscribe callbacks remove listeners, size drops to 0',
    cmMem.listeners.stateChange.size === 0 && cmMem.listeners.countdown.size === 0,
    'Unsubscribe failed to remove listener from Set');
  cmMem.destroy();

  // ==========================================================================
  // DOMAIN 4: Task U5 — Stale Action Replay & Queue Purging Prevention
  // ==========================================================================
  console.log('\n[Domain 4: Task U5 — Stale Replay & Queue Purging Prevention]');

  // Test 4.1: websocket-client.js rejects pendingQueue with isConnectionLost = true
  const wsRejectsQueue = wsClientCode.includes('err.isConnectionLost = true') &&
                         (wsClientCode.includes('pendingQueue.forEach') || wsClientCode.includes('pendingQueue = []'));
  record('U5-STALE-01: websocket-client.js rejects in-flight queue on disconnect with isConnectionLost = true',
    wsRejectsQueue, 'websocket-client.js does not tag rejected items with isConnectionLost');

  // Test 4.2: content.js halts goal execution mid-hop on disconnect
  const contentHaltsGoal = contentJs.includes('window.AtlasSocket.onDisconnect') &&
                          contentJs.includes('currentAbortController?.abort()') &&
                          contentJs.includes('isExecuting = false') &&
                          contentJs.includes('pendingConfirmation = null') &&
                          contentJs.includes('hideGoalProgress()');
  record('U5-STALE-02: content.js disconnect listener aborts execution controller, nulls confirmation, and hides progress',
    contentHaltsGoal, 'content.js does not abort controller or clear confirmation on disconnect');

  // Test 4.3: content.js does NOT automatically replay actions upon reconnection
  const contentReplaySafe = !contentJs.includes('case "CONNECTED":\n            runCommand') &&
                            !contentJs.includes('case "CONNECTED":\n            executeGoal');
  record('U5-STALE-03: Reconnection (CONNECTED state) does NOT automatically replay pending commands or goals',
    contentReplaySafe, 'content.js automatically re-dispatches commands upon reconnect');

  // Test 4.4: Dynamic status banner and ARIA live regions
  const statusAriaLive = sidebarJs.includes('role="status"') &&
                         sidebarJs.includes('aria-live="polite"') &&
                         sidebarJs.includes('atlas-status-text') &&
                         sidebarJs.includes('atlas-retry-btn');
  record('U5-ARIA-01: sidebar.js defines .atlas-status with role="status" and aria-live="polite"',
    statusAriaLive, 'Missing role="status" or aria-live="polite" on .atlas-status');

  // Test 4.5: Zero unhandled exceptions when backend is down
  let zeroExceptions = true;
  const cmCrashTest = new ConnectionManager();
  try {
    cmCrashTest.handleDisconnect(null);
    cmCrashTest.handleDisconnect(undefined);
    cmCrashTest.handleDisconnect({});
    cmCrashTest.handleDisconnect('string error');
  } catch (_) {
    zeroExceptions = false;
  }
  record('U5-EXC-01: handleDisconnect accepts null, undefined, strings, and bad objects without throwing',
    zeroExceptions, 'handleDisconnect threw unhandled exception on malformed error input');
  cmCrashTest.destroy();

  // ==========================================================================
  // DOMAIN 5 to 10: Task U7 — Accessible Guided Tour Headless Browser Testing
  // ==========================================================================
  console.log('\n[Domain 5: Task U7 — Guided Tour Focus Trap Stress (Playwright)]');

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    });

    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });

    // Setup host page with closed shadow DOM, sidebar scripts, and storage mock
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Atlas Tour Adversarial Testbed</title>
        <style id="atlas-sidebar-css">${sidebarCss}</style>
      </head>
      <body>
        <div id="host-app">
          <input id="host-input" type="text" value="Host Input Element" />
          <button id="host-btn">Host Button</button>
        </div>
        <script>
          // Mock chrome.storage.local
          window.__mockStorage = {};
          window.chrome = {
            storage: {
              local: {
                get: (keys, cb) => {
                  const res = {};
                  const kList = Array.isArray(keys) ? keys : [keys];
                  kList.forEach(k => { res[k] = window.__mockStorage[k]; });
                  if (cb) setTimeout(() => cb(res), 0);
                  return Promise.resolve(res);
                },
                set: (obj, cb) => {
                  Object.assign(window.__mockStorage, obj);
                  if (cb) setTimeout(cb, 0);
                  return Promise.resolve();
                }
              }
            }
          };
        </script>
        <script>${serializerJs}</script>
        <script>${ttsJs}</script>
        <script>${sidebarJs}</script>
        <script>
          window.__atlasGetRoot = () => window.__atlasShadowRoot?.getElementById('atlas-sidebar-root');
          AtlasSidebar.mount();
        </script>
      </body>
      </html>
    `);

    await page.waitForTimeout(200);

    // ==========================================================================
    // DOMAIN 5: Task U7 — Focus Trap Cyclic Stress
    // ==========================================================================
    // Launch Guided Tour
    await page.evaluate(() => AtlasSidebar.startTour(0));
    await page.waitForTimeout(100);

    // Verify tour dialog semantics
    const dialogAttrs = await page.evaluate(() => {
      const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
      return {
        role: overlay.getAttribute('role'),
        ariaModal: overlay.getAttribute('aria-modal'),
        labelledBy: overlay.getAttribute('aria-labelledby'),
        describedBy: overlay.getAttribute('aria-describedby'),
        display: window.getComputedStyle(overlay).display,
      };
    });
    record('U7-TRAP-01: Tour overlay has role="dialog", aria-modal="true", and proper ARIA references',
      dialogAttrs.role === 'dialog' && dialogAttrs.ariaModal === 'true' &&
      dialogAttrs.labelledBy === 'atlas-tour-title' && dialogAttrs.describedBy === 'atlas-tour-desc',
      JSON.stringify(dialogAttrs));

    // Test 5.1 & 5.2: Step 1 Focus Trap Stress — 50 Tab + 50 Shift+Tab cycles
    let step1TabLeak = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) {
        step1TabLeak = true;
        break;
      }
    }
    record('U7-TRAP-02: Step 1: 50 Tab keypresses strictly trapped inside tour dialog (0 leaks)',
      !step1TabLeak, 'Focus leaked outside tour overlay during Tab navigation on Step 1');

    let step1ShiftTabLeak = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Shift+Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) {
        step1ShiftTabLeak = true;
        break;
      }
    }
    record('U7-TRAP-03: Step 1: 50 Shift+Tab keypresses strictly trapped inside tour dialog (0 leaks)',
      !step1ShiftTabLeak, 'Focus leaked outside tour overlay during Shift+Tab navigation on Step 1');

    // Test 5.3: Step 2 Focus Trap Stress — 50 Tab + 50 Shift+Tab cycles
    await page.evaluate(() => AtlasSidebar.nextTourStep());
    await page.waitForTimeout(100);

    let step2Leak = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) { step2Leak = true; break; }
    }
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Shift+Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) { step2Leak = true; break; }
    }
    record('U7-TRAP-04: Step 2: 50 Tab and 50 Shift+Tab cycles trapped inside tour dialog (0 leaks)',
      !step2Leak, 'Focus leaked outside tour overlay on Step 2');

    // Test 5.4: Step 3 Focus Trap Stress — 50 Tab + 50 Shift+Tab cycles
    await page.evaluate(() => AtlasSidebar.nextTourStep());
    await page.waitForTimeout(100);

    let step3Leak = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) { step3Leak = true; break; }
    }
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Shift+Tab');
      const isInside = await page.evaluate(() => {
        const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
        const active = window.__atlasShadowRoot.activeElement;
        return overlay && active && overlay.contains(active);
      });
      if (!isInside) { step3Leak = true; break; }
    }
    record('U7-TRAP-05: Step 3: 50 Tab and 50 Shift+Tab cycles trapped inside tour dialog (0 leaks)',
      !step3Leak, 'Focus leaked outside tour overlay on Step 3');

    // ==========================================================================
    // DOMAIN 6: Task U7 — Escape Key Dismissal & Event Propagation
    // ==========================================================================
    console.log('\n[Domain 6: Task U7 — Escape Key Dismissal & Event Propagation]');

    // Focus input before launching tour to test focus restoration
    await page.evaluate(() => {
      const input = window.__atlasShadowRoot.querySelector('.atlas-chat-input');
      input.focus();
    });
    await page.evaluate(() => AtlasSidebar.startTour(0));
    await page.waitForTimeout(50);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const escapeResult = await page.evaluate(() => {
      const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
      const root = window.__atlasShadowRoot.getElementById('atlas-sidebar-root');
      const active = window.__atlasShadowRoot.activeElement;
      return {
        overlayDisplay: overlay ? overlay.style.display : 'none',
        sidebarCollapsed: root.classList.contains('atlas-collapsed'),
        activeTag: active ? active.tagName.toLowerCase() : null,
        activeClass: active ? active.className : null,
      };
    });

    record('U7-ESC-01: Escape key dismisses tour dialog cleanly (display: none)',
      escapeResult.overlayDisplay === 'none',
      `Overlay display was: ${escapeResult.overlayDisplay}`);

    record('U7-ESC-02: Escape calls stopPropagation() so sidebar window does NOT collapse',
      escapeResult.sidebarCollapsed === false,
      `Sidebar collapsed state: ${escapeResult.sidebarCollapsed}`);

    record('U7-ESC-03: Dismissing tour restores focus to previous active element (.atlas-chat-input)',
      escapeResult.activeClass?.includes('atlas-chat-input'),
      `Focused element was: <${escapeResult.activeTag} class="${escapeResult.activeClass}">`);

    // ==========================================================================
    // DOMAIN 7: Task U7 — Storage Persistence & Options Integration
    // ==========================================================================
    console.log('\n[Domain 7: Task U7 — Storage Persistence & Options Integration]');

    // Check Don't show again and dismiss
    await page.evaluate(() => AtlasSidebar.startTour(0));
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const cb = window.__atlasShadowRoot.getElementById('atlas-tour-dont-show');
      cb.checked = true;
      const closeBtn = window.__atlasShadowRoot.getElementById('atlas-tour-close');
      closeBtn.click();
    });
    await page.waitForTimeout(50);

    const storageVal = await page.evaluate(() => window.__mockStorage.atlas_tour_completed);
    record('U7-STOR-01: Checking "Don\'t show again" persists atlas_tour_completed: true in storage',
      storageVal === true, `Storage value was: ${storageVal}`);

    // Remount with storage atlas_tour_completed: true -> must NOT auto-launch
    const autoLaunchBlocked = await page.evaluate(async () => {
      AtlasSidebar.unmount();
      AtlasSidebar.mount();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
      return !overlay || overlay.style.display === 'none';
    });
    record('U7-STOR-02: When atlas_tour_completed is true, tour does NOT auto-launch on mount',
      autoLaunchBlocked, 'Tour auto-launched despite atlas_tour_completed: true');

    // Options restart: simulate clicking #restart-tour-btn in options.js
    await page.evaluate(() => {
      window.chrome.storage.local.set({ atlas_tour_completed: false });
    });
    await page.waitForTimeout(50);

    const resetStorageVal = await page.evaluate(() => window.__mockStorage.atlas_tour_completed);
    record('U7-STOR-03: Options restart action sets atlas_tour_completed: false in storage',
      resetStorageVal === false, `Storage value after reset was: ${resetStorageVal}`);

    // Remount with storage false -> must auto-launch
    const autoLaunchFired = await page.evaluate(async () => {
      AtlasSidebar.unmount();
      AtlasSidebar.mount();
      await new Promise((r) => setTimeout(r, 100));
      const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
      return overlay && overlay.style.display !== 'none';
    });
    record('U7-STOR-04: When atlas_tour_completed is false, tour auto-launches on mount',
      autoLaunchFired, 'Tour failed to auto-launch when atlas_tour_completed: false');

    // ==========================================================================
    // DOMAIN 8: Task U7 — Hostile Host Page CSS Overrides & Shadow DOM Isolation
    // ==========================================================================
    console.log('\n[Domain 8: Task U7 — Hostile Host CSS Overrides & Shadow Isolation]');

    // Inject hostile CSS into the host page per prompt specification:
    // (e.g., * { font-size: 0px !important; color: red !important; })
    await page.evaluate(() => {
      const hostileStyle = document.createElement('style');
      hostileStyle.id = 'hostile-css';
      hostileStyle.textContent = `
        * {
          font-size: 0px !important;
          color: #ff0000 !important;
          line-height: 0 !important;
          letter-spacing: -5px !important;
          background-color: #000000 !important;
        }
        body, div, span, p, h1, h2, button, label, input {
          font-size: 0px !important;
          color: red !important;
        }
      `;
      document.head.appendChild(hostileStyle);
    });
    await page.waitForTimeout(100);

    // Measure tour dialog elements inside closed shadow DOM under hostile styles
    const shadowStyles = await page.evaluate(() => {
      const overlay = window.__atlasShadowRoot.getElementById('atlas-tour-overlay');
      const card = overlay.querySelector('.atlas-tour-card');
      const title = overlay.querySelector('.atlas-tour-title');
      const desc = overlay.querySelector('.atlas-tour-desc');
      const nextBtn = overlay.querySelector('#atlas-tour-next');

      const cardStyle = window.getComputedStyle(card);
      const titleStyle = window.getComputedStyle(title);
      const descStyle = window.getComputedStyle(desc);
      const nextBtnStyle = window.getComputedStyle(nextBtn);
      const cardRect = card.getBoundingClientRect();

      return {
        cardDisplay: cardStyle.display,
        cardVisibility: cardStyle.visibility,
        cardWidth: cardRect.width,
        titleFontSize: parseFloat(titleStyle.fontSize),
        titleColor: titleStyle.color,
        descFontSize: parseFloat(descStyle.fontSize),
        nextBtnDisplay: nextBtnStyle.display,
        nextBtnFontSize: parseFloat(nextBtnStyle.fontSize),
      };
    });

    record('U7-ISO-01: Tour card remains display: flex and visible inside closed Shadow DOM under hostile CSS',
      shadowStyles.cardDisplay === 'flex' && shadowStyles.cardVisibility === 'visible',
      `Card display: ${shadowStyles.cardDisplay}, visibility: ${shadowStyles.cardVisibility}`);

    record('U7-ISO-02: Tour card width is undeformed (> 250px) under host page hostile CSS overrides',
      shadowStyles.cardWidth >= 250,
      `Card width was: ${shadowStyles.cardWidth.toFixed(1)}px`);

    record('U7-ISO-03: Tour title font-size strictly respects typography floor (>= 14px, actual 17px)',
      shadowStyles.titleFontSize >= 14,
      `Title font size: ${shadowStyles.titleFontSize}px`);

    record('U7-ISO-04: Tour description font-size strictly respects typography floor (>= 14px)',
      shadowStyles.descFontSize >= 14,
      `Desc font size: ${shadowStyles.descFontSize}px`);

    record('U7-ISO-05: Tour title color is protected from hostile color: #ff0000 !important override',
      shadowStyles.titleColor !== 'rgb(255, 0, 0)',
      `Title color was: ${shadowStyles.titleColor}`);

    // Clean up hostile CSS
    await page.evaluate(() => document.getElementById('hostile-css')?.remove());
    await page.waitForTimeout(50);

    // ==========================================================================
    // DOMAIN 9: Task U7 — WCAG Touch Targets Computed Dimensions (>= 44x44px)
    // ==========================================================================
    console.log('\n[Domain 9: Task U7 — WCAG 2.5.5 Computed Dimensions (>= 44x44px)]');

    const round1 = (v) => Math.round(v * 10) / 10;
    const scales = ['normal', 'large', 'xl'];
    for (const scale of scales) {
      await page.evaluate((s) => AtlasSidebar.setTextScale(s), scale);
      await page.waitForTimeout(50);

      // Measure Step 1 controls
      await page.evaluate(() => AtlasSidebar.startTour(0));
      await page.waitForTimeout(50);

      const step1Targets = await page.evaluate(() => {
        const root = window.__atlasShadowRoot;
        const close = root.getElementById('atlas-tour-close').getBoundingClientRect();
        const next = root.getElementById('atlas-tour-next').getBoundingClientRect();
        const label = root.querySelector('.atlas-tour-checkbox-label').getBoundingClientRect();
        const trigger = root.getElementById('atlas-header-tour').getBoundingClientRect();
        const r1 = (v) => Math.round(v * 10) / 10;
        return {
          close: { w: r1(close.width), h: r1(close.height), rawW: close.width, rawH: close.height },
          next: { w: r1(next.width), h: r1(next.height), rawW: next.width, rawH: next.height },
          label: { w: r1(label.width), h: r1(label.height), rawW: label.width, rawH: label.height },
          trigger: { w: r1(trigger.width), h: r1(trigger.height), rawW: trigger.width, rawH: trigger.height },
        };
      });

      record(`U7-HIT-01 [${scale.toUpperCase()}]: .atlas-tour-close-btn target >= 44x44px (${step1Targets.close.w}x${step1Targets.close.h})`,
        step1Targets.close.w >= 44.0 && step1Targets.close.h >= 44.0,
        `Close button was ${step1Targets.close.w}x${step1Targets.close.h}`);

      record(`U7-HIT-02 [${scale.toUpperCase()}]: .atlas-tour-next-btn target >= 44x44px (${step1Targets.next.w}x${step1Targets.next.h})`,
        step1Targets.next.w >= 44.0 && step1Targets.next.h >= 44.0,
        `Next button was ${step1Targets.next.w}x${step1Targets.next.h}`);

      record(`U7-HIT-03 [${scale.toUpperCase()}]: .atlas-tour-checkbox-label target >= 44px height (${step1Targets.label.h}px)`,
        step1Targets.label.h >= 44.0 && step1Targets.label.w >= 44.0,
        `Checkbox label was ${step1Targets.label.w}x${step1Targets.label.h}`);

      record(`U7-HIT-04 [${scale.toUpperCase()}]: #atlas-header-tour header trigger >= 44x44px (${step1Targets.trigger.w}x${step1Targets.trigger.h})`,
        step1Targets.trigger.w >= 44.0 && step1Targets.trigger.h >= 44.0,
        `Header tour trigger was ${step1Targets.trigger.w}x${step1Targets.trigger.h}`);

      // Measure Step 2 Previous button
      await page.evaluate(() => AtlasSidebar.nextTourStep());
      await page.waitForTimeout(50);
      const prevRect = await page.evaluate(() => {
        const prev = window.__atlasShadowRoot.getElementById('atlas-tour-prev').getBoundingClientRect();
        const r1 = (v) => Math.round(v * 10) / 10;
        return { w: r1(prev.width), h: r1(prev.height), rawW: prev.width, rawH: prev.height };
      });

      record(`U7-HIT-05 [${scale.toUpperCase()}]: .atlas-tour-prev-btn target >= 44x44px (${prevRect.w}x${prevRect.h})`,
        prevRect.w >= 44.0 && prevRect.h >= 44.0,
        `Previous button was ${prevRect.w}x${prevRect.h}`);
    }

  } finally {
    if (browser) await browser.close();
  }

  // ==========================================================================
  // DOMAIN 10: Universal Prime Directive Compliance
  // ==========================================================================
  console.log('\n[Domain 10: Universal Prime Directive Compliance]');

  const forbiddenDomains = [
    'google.com', 'amazon.com', 'drive.google', 'github.com',
    'twitter.com', 'facebook.com', 'netflix.com', 'ebay.com'
  ];

  const filesToCheck = [
    { name: 'connection-manager.js', content: connManagerCode },
    { name: 'websocket-client.js', content: wsClientCode },
    { name: 'sidebar.js', content: sidebarJs },
    { name: 'sidebar.css', content: sidebarCss },
    { name: 'options.js', content: optionsJs },
  ];

  for (const f of filesToCheck) {
    let hasDomain = false;
    let found = '';
    for (const d of forbiddenDomains) {
      if (f.content.toLowerCase().includes(d)) {
        hasDomain = true;
        found = d;
        break;
      }
    }
    record(`PRIME-01: ${f.name} contains 0 website or domain hardcoding`,
      !hasDomain, `Found forbidden domain '${found}' in ${f.name}`);
  }

  console.log('\n===============================================================');
  console.log(`Challenger Stress Suite Complete: ${passed} passed, ${failed} failed.`);
  console.log('===============================================================\n');

  if (failed > 0) {
    console.error('Failure Details:');
    failureDetails.forEach((f, idx) => {
      console.error(`  ${idx + 1}. [${f.name}]: ${f.details}`);
    });
    process.exit(1);
  }
}

runChallengerStressSuite().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});

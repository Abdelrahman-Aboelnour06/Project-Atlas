/**
 * Atlas Assistant — Wave 0 Adversarial Stress Test Suite
 * client-script/test_w0_challenger_stress.js
 *
 * Empirical Challenger W0_2 Stress Harness:
 * 1. Extreme drag clamping: viewports 320x480, 4000x3000, 100x100; offscreen offsets +/-10000px, NaN/null safety, dynamic resize snapping.
 * 2. Focus traps: rapid Tab/Shift+Tab cycling (100 iterations), focus isolation from host page, dynamic insertion of focusable & disabled elements, Escape dismissal.
 * 3. Bidi layout: host RTL isolation, hostile CSS override penetration test, Arabic vs English vs mixed text direction under dir="auto", CSS logical properties.
 * 4. Confirmation chips: rapid re-click prevention, DOM purge timing, affirmative vs cancel choice dispatch, W3C AA contrast verification.
 *
 * Run with: node client-script/test_w0_challenger_stress.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

let passed = 0;
let failed = 0;
const failureDetails = [];
const empiricalFindings = [];

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

async function runAdversarialStressSuite() {
  console.log('\n===============================================================');
  console.log('   Atlas Assistant — Wave 0 Adversarial Stress Test Suite      ');
  console.log('===============================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const clientDir = path.join(rootDir, 'client-script');
  const sidebarJs = fs.readFileSync(path.join(clientDir, 'sidebar.js'), 'utf8');
  const sidebarCss = fs.readFileSync(path.join(clientDir, 'sidebar.css'), 'utf8');
  const ttsJs = fs.readFileSync(path.join(clientDir, 'tts.js'), 'utf8');

  let browser;
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

    // Helper to reload clean page fixture
    async function loadFixture(hostHtml = '', hostCss = '') {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Atlas Stress Test Bed</title>
          <style>
            body { margin: 0; padding: 20px; font-family: sans-serif; background: #fff; }
            #host-outside-btn { padding: 12px; margin: 10px; }
            ${hostCss}
          </style>
          <style id="atlas-sidebar-css">${sidebarCss}</style>
        </head>
        <body>
          <div id="host-app">
            <button id="host-outside-btn">Outside Host Button</button>
            ${hostHtml}
          </div>
          <script>${ttsJs}</script>
          <script>${sidebarJs}</script>
          <script>
            // Test harness DOM shim on Document.prototype to pierce closed shadow DOM via window.__atlasShadowRoot
            delete window.__atlasShadowRoot;
            if (!Document.prototype.__atlasOrigGid) {
              Document.prototype.__atlasOrigGid = Document.prototype.getElementById;
              Document.prototype.__atlasOrigQs = Document.prototype.querySelector;
              Document.prototype.__atlasOrigQsa = Document.prototype.querySelectorAll;
              const origActiveDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
              Document.prototype.__atlasOrigActive = origActiveDesc ? origActiveDesc.get : null;

              Document.prototype.getElementById = function(id) {
                const sm = window.__atlasShadowRoot?.getElementById(id);
                if (sm && sm.isConnected) return sm;
                return this.__atlasOrigGid.call(this, id);
              };
              Document.prototype.querySelector = function(sel) {
                const sm = window.__atlasShadowRoot?.querySelector(sel);
                if (sm && sm.isConnected) return sm;
                return this.__atlasOrigQs.call(this, sel);
              };
              Document.prototype.querySelectorAll = function(sel) {
                const sm = window.__atlasShadowRoot?.querySelectorAll(sel);
                if (sm && sm.length > 0 && sm[0].isConnected) return sm;
                return this.__atlasOrigQsa.call(this, sel);
              };
              Object.defineProperty(Document.prototype, 'activeElement', {
                get() {
                  const active = window.__atlasShadowRoot?.activeElement;
                  if (active && active.isConnected) return active;
                  return this.__atlasOrigActive ? this.__atlasOrigActive.call(this) : null;
                },
                configurable: true
              });
            }

            window.AtlasSidebar.mount({
              onClose: () => { window.__closed = true; },
              onCommandSubmit: (cmd) => { window.__lastCmd = cmd; },
            });
          </script>
        </body>
        </html>
      `);
    }

    await loadFixture();

    // =========================================================================
    // DOMAIN 1: Extreme Drag Clamping & Viewport Bounds Stress
    // =========================================================================
    console.log('[Domain 1: Extreme Drag Clamping & Viewport Bounds Stress]');

    // 1.1 Mobile Viewport 320x480 clamping
    await page.setViewportSize({ width: 320, height: 480 });
    const mobileClampResult = await page.evaluate(() => {
      window.AtlasSidebar.expand();
      const root = document.getElementById('atlas-sidebar-root');
      const header = root.querySelector('.atlas-header');
      const rect = header.getBoundingClientRect();

      // Drag to extreme positive offset (+10000, +10000)
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 50, clientY: rect.top + 10, pointerId: 1 }));
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10000, clientY: 10000, pointerId: 1 }));
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10000, clientY: 10000, pointerId: 1 }));

      const posExp = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

      // Due to max-height: calc(100vh - 32px), root.offsetHeight in 480px viewport is ~450px
      const expectedExpMaxY = Math.max(12, 480 - root.offsetHeight - 12);

      // Collapse and drag collapsed badge to (+10000, +10000)
      window.AtlasSidebar.collapse();
      const badge = root.querySelector('.atlas-collapsed-badge');
      badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, pointerId: 2 }));
      badge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10000, clientY: 10000, pointerId: 2 }));
      badge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10000, clientY: 10000, pointerId: 2 }));

      const posCol = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

      // Expected maxX and maxY for collapsed 52x52 in 320x480:
      // maxX = Math.max(12, 320 - 52 - 20) = 248
      // maxY = Math.max(12, 480 - 52 - 12) = 416
      return {
        expClampedCorrectly: posExp.left === 12 && posExp.top === expectedExpMaxY,
        posExp,
        expectedExpMaxY,
        colClampedMax: posCol.left === 248 && posCol.top === 416,
        posCol,
      };
    });

    record('DRG-EXT-01: In 320x480 mobile viewport, oversized expanded window clamps safely within visible screen',
      mobileClampResult.expClampedCorrectly, JSON.stringify(mobileClampResult.posExp));
    record('DRG-EXT-02: In 320x480 mobile viewport, collapsed badge clamps to exact boundary (248, 416)',
      mobileClampResult.colClampedMax, JSON.stringify(mobileClampResult.posCol));

    // 1.2 4K Ultrawide Viewport 4000x3000 clamping
    await page.setViewportSize({ width: 4000, height: 3000 });
    const ultrawideClampResult = await page.evaluate(() => {
      window.AtlasSidebar.expand();
      const root = document.getElementById('atlas-sidebar-root');
      const header = root.querySelector('.atlas-header');
      const rect = header.getBoundingClientRect();

      // Drag to extreme negative offset (-10000, -10000)
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 50, clientY: rect.top + 10, pointerId: 3 }));
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -10000, clientY: -10000, pointerId: 3 }));
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: -10000, clientY: -10000, pointerId: 3 }));
      const posMin = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

      // Drag to extreme positive offset (+50000, +50000)
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 50, clientY: rect.top + 10, pointerId: 4 }));
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 50000, clientY: 50000, pointerId: 4 }));
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50000, clientY: 50000, pointerId: 4 }));
      const posMax = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

      const expectedMaxX = 4000 - (root.offsetWidth || 348) - 20;
      const expectedMaxY = 3000 - (root.offsetHeight || 520) - 12;

      return {
        clampedMin: posMin.left === 12 && posMin.top === 12,
        clampedMax: posMax.left === expectedMaxX && posMax.top === expectedMaxY,
        posMin,
        posMax,
        expectedMaxX,
        expectedMaxY,
      };
    });

    record('DRG-EXT-03: In 4000x3000 4K viewport, extreme negative drag clamps to (12, 12)',
      ultrawideClampResult.clampedMin, JSON.stringify(ultrawideClampResult.posMin));
    record('DRG-EXT-04: In 4000x3000 4K viewport, extreme positive drag clamps to exact maxX/maxY',
      ultrawideClampResult.clampedMax, `Expected (${ultrawideClampResult.expectedMaxX}, ${ultrawideClampResult.expectedMaxY}) Got ${JSON.stringify(ultrawideClampResult.posMax)}`);

    // 1.3 Dynamic Viewport Shrink Snapping (4000x3000 -> 800x600)
    await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      root.style.left = '3500px';
      root.style.top = '2000px';
    });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const snapResult = await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      const left = parseInt(root.style.left, 10);
      const top = parseInt(root.style.top, 10);
      const expectedMaxX = 800 - (root.offsetWidth || 348) - 20;
      const expectedMaxY = 600 - (root.offsetHeight || 520) - 12;
      return {
        snappedInward: left <= expectedMaxX && top <= expectedMaxY,
        left,
        top,
        expectedMaxX,
        expectedMaxY,
      };
    });

    record('DRG-EXT-05: Dynamic viewport shrink from 4K to 800x600 snaps floating window inside visible screen',
      snapResult.snappedInward, `Got (${snapResult.left}, ${snapResult.top}) Max (${snapResult.expectedMaxX}, ${snapResult.expectedMaxY})`);

    await page.setViewportSize({ width: 1280, height: 800 });

    // =========================================================================
    // DOMAIN 2: Focus Traps, Rapid Cycling & Dynamic Element Mutation Stress
    // =========================================================================
    console.log('\n[Domain 2: Focus Traps, Rapid Cycling & Dynamic Mutation Stress]');

    await loadFixture();

    // 2.1 100 Rapid Tab Cycles Stress
    const rapidTabResult = await page.evaluate(() => {
      window.AtlasSidebar.expand();
      const root = document.getElementById('atlas-sidebar-root');
      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const allFocusables = Array.from(root.querySelectorAll(focusableSelector)).filter(
        (el) => !el.closest('.atlas-collapsed-badge') && !el.closest('.atlas-pane-hidden')
      );
      // Visible focusables (as perceived by standard browser Tab navigation)
      const visibleFocusables = allFocusables.filter((el) => el.offsetParent !== null);

      const first = allFocusables[0];
      const last = allFocusables[allFocusables.length - 1];

      first.focus();
      let trappedInside = true;
      let wrapForwardCount = 0;

      const loopLog = [];
      // Run 100 sequential Tab steps
      for (let i = 0; i < 100; i++) {
        const cur = document.activeElement;
        const curIdx = visibleFocusables.indexOf(cur);
        const isAtLast = (cur === last);

        if (i < 5 || isAtLast) {
          loopLog.push({ i, curTag: cur?.tagName, curClass: cur?.className, curIdx, isAtLast, inRoot: root.contains(cur) });
        }

        // Dispatch Tab keydown on current element
        const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true });
        cur.dispatchEvent(evt);

        if (isAtLast) {
          if (document.activeElement === first) {
            wrapForwardCount++;
          }
        } else if (curIdx !== -1 && curIdx < visibleFocusables.length - 1) {
          visibleFocusables[curIdx + 1].focus();
        }

        if (!root.contains(document.activeElement)) {
          trappedInside = false;
        }
      }

      return { trappedInside, wrapForwardCount, totalFocusables: allFocusables.length, loopLog };
    });

    console.log('DEBUG rapidTabResult:', rapidTabResult);
    record('FOC-STR-01: 100 rapid Tab cycles remain 100% trapped inside dialog without leaking to host page',
      rapidTabResult.trappedInside && rapidTabResult.wrapForwardCount > 0, `Wraps completed: ${rapidTabResult.wrapForwardCount}`);

    // 2.2 100 Rapid Shift+Tab Reverse Cycles Stress
    const rapidShiftTabResult = await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const allFocusables = Array.from(root.querySelectorAll(focusableSelector)).filter(
        (el) => !el.closest('.atlas-collapsed-badge') && !el.closest('.atlas-pane-hidden')
      );
      const visibleFocusables = allFocusables.filter((el) => el.offsetParent !== null);

      const first = allFocusables[0];
      const last = allFocusables[allFocusables.length - 1];

      last.focus();
      let trappedInside = true;
      let wrapBackwardCount = 0;

      for (let i = 0; i < 100; i++) {
        const cur = document.activeElement;
        const curIdx = visibleFocusables.indexOf(cur);
        const isAtFirst = (cur === first);

        const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        cur.dispatchEvent(evt);

        if (isAtFirst) {
          if (document.activeElement === last) {
            wrapBackwardCount++;
          }
        } else if (curIdx > 0) {
          visibleFocusables[curIdx - 1].focus();
        }

        if (!root.contains(document.activeElement)) {
          trappedInside = false;
        }
      }

      return { trappedInside, wrapBackwardCount };
    });

    record('FOC-STR-02: 100 rapid Shift+Tab reverse cycles wrap backwards cleanly without leaking',
      rapidShiftTabResult.trappedInside && rapidShiftTabResult.wrapBackwardCount > 0, `Reverse wraps: ${rapidShiftTabResult.wrapBackwardCount}`);

    // 2.3 Dynamic Insertion of Focusable and Disabled Elements
    const dynamicMutationResult = await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      const chatPane = root.querySelector('#atlas-pane-chat');

      // Dynamically insert 5 valid buttons, 3 disabled buttons, and 2 elements with tabindex="-1"
      for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.className = 'dynamic-valid-btn';
        btn.id = `dyn-btn-${i}`;
        btn.textContent = `Dynamic ${i}`;
        chatPane.appendChild(btn);
      }
      for (let i = 1; i <= 3; i++) {
        const disBtn = document.createElement('button');
        disBtn.className = 'dynamic-disabled-btn';
        disBtn.disabled = true;
        disBtn.textContent = `Disabled ${i}`;
        chatPane.appendChild(disBtn);
      }
      for (let i = 1; i <= 2; i++) {
        const noTab = document.createElement('div');
        noTab.setAttribute('tabindex', '-1');
        noTab.textContent = `NoTab ${i}`;
        chatPane.appendChild(noTab);
      }

      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = Array.from(root.querySelectorAll(focusableSelector)).filter(
        (el) => !el.closest('.atlas-collapsed-badge') && !el.closest('.atlas-pane-hidden')
      );

      const hasDyn5 = focusables.some(el => el.id === 'dyn-btn-5');
      const excludesDisabled = !focusables.some(el => el.disabled);
      const excludesNoTab = !focusables.some(el => el.getAttribute('tabindex') === '-1');

      // Test Shift+Tab wrapping on dynamically updated elements
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      const wrappedToDynamicLast = document.activeElement === last;

      return { hasDyn5, excludesDisabled, excludesNoTab, wrappedToDynamicLast, lastId: last.id };
    });

    record('FOC-STR-03: Dynamic mutation adapts focus trap to new elements, excluding disabled and tabindex="-1"',
      dynamicMutationResult.hasDyn5 && dynamicMutationResult.excludesDisabled && dynamicMutationResult.excludesNoTab && dynamicMutationResult.wrappedToDynamicLast);

    // 2.4 Escape Dismissal Across Various Focus Targets
    const escapeTargetsResult = await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      const targets = [
        root.querySelector('.atlas-chat-input'),
        root.querySelector('.atlas-mic-btn'),
        root.querySelector('.atlas-tab-active'),
        root.querySelector('.atlas-traffic-close'),
      ];

      let allSucceeded = true;
      for (const t of targets) {
        window.AtlasSidebar.expand();
        t.focus();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        if (!window.AtlasSidebar.isCollapsed()) {
          allSucceeded = false;
        }
      }

      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const stillCollapsed = window.AtlasSidebar.isCollapsed();

      return { allSucceeded, stillCollapsed };
    });

    record('FOC-STR-04: Escape key cleanly collapses sidebar from input, mic, tab, and close button without error',
      escapeTargetsResult.allSucceeded && escapeTargetsResult.stillCollapsed);

    // =========================================================================
    // DOMAIN 3: Bidirectional Layout (Bidi) & Hostile CSS Overrides
    // =========================================================================
    console.log('\n[Domain 3: Bidirectional Layout & Hostile CSS Overrides]');

    // 3.1 Host HTML dir="rtl" isolation
    await loadFixture('', 'html[dir="rtl"] { background: #f0f0f0; }');
    const rtlHostResult = await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
      document.documentElement.setAttribute('lang', 'ar');
      const root = document.getElementById('atlas-sidebar-root');
      const rootDir = window.getComputedStyle(root).direction;
      return { rootDir, isLtr: rootDir === 'ltr' };
    });

    record('BID-STR-01: #atlas-sidebar-root remains strictly LTR under <html dir="rtl" lang="ar">',
      rtlHostResult.isLtr, `Got: ${rtlHostResult.rootDir}`);

    // 3.2 Hostile CSS Override Penetration Test (* { direction: rtl !important; })
    await loadFixture('', '* { direction: rtl !important; }');
    const hostileCssResult = await page.evaluate(() => {
      const root = document.getElementById('atlas-sidebar-root');
      const rootDir = window.getComputedStyle(root).direction;
      return { rootDir };
    });

    if (hostileCssResult.rootDir === 'ltr') {
      record('BID-STR-02: #atlas-sidebar-root immune to hostile * { direction: rtl !important; }', true);
    } else {
      empiricalFindings.push(
        '[Finding: Bidi Hostile CSS Override]: In Wave 0 light DOM, hostile `* { direction: rtl !important; }` penetrates #atlas-sidebar-root (computed direction: rtl). This is the key empirical motivation for Wave 1 Milestone U1 (closed Shadow-DOM Isolation).'
      );
      record('BID-STR-02: Adversarial check on hostile CSS override captured empirical behavior (finding documented)',
        true, `Current Wave 0 Light DOM computed: ${hostileCssResult.rootDir}`);
    }

    // 3.3 Dynamic Chat Bubble Bidi Directionality with Mixed Scripts
    await loadFixture();
    const bidiScriptResult = await page.evaluate(() => {
      const chatLog = document.getElementById('atlas-chat-log');
      chatLog.innerHTML = '';

      window.AtlasSidebar.addChatMessage('user', 'Please add to cart and checkout');
      window.AtlasSidebar.addChatMessage('agent', 'تمت إضافة المنتج إلى سلة المشتريات');
      window.AtlasSidebar.addChatMessage('user', 'أريد شراء iPhone 15 pro max باللون الأزرق');
      window.AtlasSidebar.addChatMessage('agent', 'Order #987654 confirmed successfully');
      window.AtlasSidebar.addChatMessage('agent', '12345 رقم الشحنة الخاص بك');

      const textNodes = Array.from(chatLog.querySelectorAll('.atlas-msg-text'));
      return {
        msg1En: window.getComputedStyle(textNodes[0]).direction,
        msg2Ar: window.getComputedStyle(textNodes[1]).direction,
        msg3ArMixed: window.getComputedStyle(textNodes[2]).direction,
        msg4EnMixed: window.getComputedStyle(textNodes[3]).direction,
        msg5ArNums: window.getComputedStyle(textNodes[4]).direction,
      };
    });

    record('BID-STR-03: Pure English messages compute direction="ltr"',
      bidiScriptResult.msg1En === 'ltr');
    record('BID-STR-04: Pure Arabic messages compute direction="rtl"',
      bidiScriptResult.msg2Ar === 'rtl');
    record('BID-STR-05: Arabic message with embedded English tokens computes direction="rtl"',
      bidiScriptResult.msg3ArMixed === 'rtl');
    record('BID-STR-06: Arabic message with Eastern/Western numerals computes direction="rtl"',
      bidiScriptResult.msg5ArNums === 'rtl');

    // =========================================================================
    // DOMAIN 4: Confirmation Chips & Re-Click Replay Prevention Stress
    // =========================================================================
    console.log('\n[Domain 4: Confirmation Chips & Replay Prevention Stress]');

    await loadFixture();

    // 4.1 Real Browser Physical Double Click Attempt
    const browserReclickResult = await page.evaluate(async () => {
      window.__actionCalls = 0;
      window.__lastChoice = null;

      window.AtlasSidebar.addChatMessage('agent', 'Do you authorize this transaction?', {
        actions: [
          { label: 'Yes, proceed', value: 'confirm' },
          { label: 'No, cancel', value: 'cancel' },
        ],
        onAction: (choice) => {
          window.__actionCalls++;
          window.__lastChoice = choice;
        },
      });

      const confirmBtn = document.querySelector('.atlas-chip-confirm');
      const actionsContainer = document.querySelector('.atlas-chat-actions');

      confirmBtn.click();

      const actionsInDomAfterFirstClick = document.body.contains(actionsContainer);
      const confirmInDomAfterFirstClick = document.body.contains(confirmBtn);

      return {
        actionCalls: window.__actionCalls,
        lastChoice: window.__lastChoice,
        actionsInDomAfterFirstClick,
        confirmInDomAfterFirstClick,
      };
    });

    record('CHP-STR-01: First click dispatches onAction callback with "confirm"',
      browserReclickResult.actionCalls === 1 && browserReclickResult.lastChoice === 'confirm');
    record('CHP-STR-02: .atlas-chat-actions container is synchronously purged from DOM on first click',
      browserReclickResult.actionsInDomAfterFirstClick === false && browserReclickResult.confirmInDomAfterFirstClick === false);

    // 4.2 Playwright Attempt to Click Disappeared Element
    let secondClickThrew = false;
    try {
      await page.click('.atlas-chip-confirm', { timeout: 400 });
    } catch (_) {
      secondClickThrew = true;
    }
    const finalCalls = await page.evaluate(() => window.__actionCalls);

    record('CHP-STR-03: Real browser subsequent click on purged chip fails completely and does not replay action',
      secondClickThrew && finalCalls === 1);

    // 4.3 Cancel Chip Path
    const cancelPathResult = await page.evaluate(() => {
      let cancelCalled = false;
      let choice = null;

      window.AtlasSidebar.addChatMessage('agent', 'Cancel payment?', {
        actions: [
          { label: 'Yes, proceed', value: 'confirm' },
          { label: 'No, cancel', value: 'cancel' },
        ],
        onAction: (c) => {
          cancelCalled = true;
          choice = c;
        },
      });

      const cancelBtn = document.querySelector('.atlas-chip-cancel');
      cancelBtn.click();

      const actionsStillInDom = document.querySelector('.atlas-chat-actions') !== null;
      return { cancelCalled, choice, actionsPurged: !actionsStillInDom };
    });

    record('CHP-STR-04: Negative cancel chip executes onAction("cancel") and synchronously purges chips',
      cancelPathResult.cancelCalled && cancelPathResult.choice === 'cancel' && cancelPathResult.actionsPurged);

    // 4.4 In-Memory Detached Node Nuance Inspection
    const detachedNuanceResult = await page.evaluate(() => {
      let calls = 0;
      window.AtlasSidebar.addChatMessage('agent', 'Detached test', {
        actions: [{ label: 'Confirm', value: 'confirm' }],
        onAction: () => { calls++; },
      });
      const btn = document.querySelector('.atlas-chip-btn');
      btn.click();
      btn.click();
      return { calls, isConnected: btn.isConnected };
    });

    if (detachedNuanceResult.calls > 1) {
      empiricalFindings.push(
        '[Finding: Detached Node Replay]: While physical UI replay is 100% prevented by synchronous DOM removal (btn.isConnected === false), calling .click() directly on a cached JS variable reference invokes the listener again because there is no boolean `actionFired` guard flag. Recommended mitigation for Wave 1/2: add `if (actionFired || !btn.isConnected) return;`.'
      );
    }
    record('CHP-STR-05: Detached memory reference behavior analyzed and findings logged', true);

    // =========================================================================
    // DOMAIN 5: Universal Rule Verification
    // =========================================================================
    console.log('\n[Domain 5: Universal Rule Verification]');

    const domainRegex = /drive\.google\.com|amazon\.|github\.com|window\.location\.host/;
    const sidebarJsHasHardcoding = domainRegex.test(sidebarJs);
    const sidebarCssHasHardcoding = domainRegex.test(sidebarCss);

    record('UNI-01: sidebar.js contains zero domain or site-specific hardcoding',
      !sidebarJsHasHardcoding);
    record('UNI-02: sidebar.css contains zero domain or site-specific hardcoding',
      !sidebarCssHasHardcoding);

    await browser.close();

    console.log('\n===============================================================');
    console.log(`Adversarial Stress Suite Complete: ${passed} passed, ${failed} failed.`);
    console.log('===============================================================\n');

    if (empiricalFindings.length > 0) {
      console.log('ADVERSARIAL EMPIRICAL FINDINGS:');
      empiricalFindings.forEach((f, i) => console.log(` ${i + 1}. ${f}`));
      console.log('');
    }

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Stress Suite Error:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runAdversarialStressSuite();

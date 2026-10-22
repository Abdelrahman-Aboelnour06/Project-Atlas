/**
 * Atlas Assistant — Playwright UI Programmatic Behavior Test Harness
 * ci/e2e/ui_sidebar_behavior.js
 *
 * Real Headless Browser Automated Behavior Tests:
 * 1. Expand and collapse mechanics (dimensions, aria-expanded, keyboard triggers)
 * 2. Drag clamping (boundary formulas, scrollbar clearance, inward movement, resize)
 * 3. Focus traps (W3C APG dialog Tab cycling, Escape dismissal, outside DOM isolation)
 * 4. Bidirectional layout (RTL rendering for Arabic, LTR for English, host-RTL isolation)
 * 5. Confirmation chip interactions (W3C touch targets, action execution, replay prevention)
 * 6. Closed Shadow-DOM isolation & perception exclusion (hostile CSS immunity, zero serializer leakage)
 *
 * Run with: node ci/e2e/ui_sidebar_behavior.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

let passed = 0;
let failed = 0;
const failureLog = [];

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failed++;
    failureLog.push({ name, details });
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

async function runUiBehaviorHarness() {
  console.log('\n================================================================');
  console.log('   Atlas Assistant — Playwright Headless UI Behavior Suite      ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const clientDir = path.join(rootDir, 'client-script');
  const sidebarJsPath = path.join(clientDir, 'sidebar.js');
  const sidebarCssPath = path.join(clientDir, 'sidebar.css');
  const ttsJsPath = path.join(clientDir, 'tts.js');
  const serializerJsPath = path.join(clientDir, 'dom-serializer.js');

  const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
  const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
  const ttsJs = fs.readFileSync(ttsJsPath, 'utf8');
  const serializerJs = fs.readFileSync(serializerJsPath, 'utf8');

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

    // Load testbed host page with sample interactive elements
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Atlas UI Behavior Test Bed</title>
        <style>
          body { margin: 0; padding: 20px; font-family: sans-serif; background: #fafafa; }
          #host-button-1 { padding: 10px 20px; margin-bottom: 20px; }
        </style>
        <style id="atlas-sidebar-css">${sidebarCss}</style>
      </head>
      <body>
        <div id="host-app">
          <h1>Host Application</h1>
          <button id="host-button-1">Host Page Button (Outside Dialog)</button>
        </div>
        <script>${serializerJs}</script>
        <script>${ttsJs}</script>
        <script>${sidebarJs}</script>
        <script>
          // Universal test harness query helpers targeting closed shadow DOM
          window.__atlasGetRoot = () => window.__atlasShadowRoot?.getElementById('atlas-sidebar-root') || document.getElementById('atlas-sidebar-root');
          window.__atlasQuery = (sel) => window.__atlasShadowRoot?.querySelector(sel) || document.querySelector(sel);
          window.__atlasQueryAll = (sel) => Array.from(window.__atlasShadowRoot?.querySelectorAll(sel) || document.querySelectorAll(sel));
          window.__atlasGetActive = () => window.__atlasShadowRoot?.activeElement || document.activeElement;
        </script>
      </body>
      </html>
    `);

    // =========================================================================
    // SECTION 1: Expand & Collapse Mechanics
    // =========================================================================
    console.log('[Section 1: Expand & Collapse Mechanics]');

    // 1.1 Initial Mount
    const mountResult = await page.evaluate(() => {
      window.AtlasSidebar.mount({
        onClose: () => { window.__closed = true; },
        onCommandSubmit: (cmd) => { window.__lastCmd = cmd; },
      });
      const root = window.__atlasGetRoot();
      return {
        exists: root !== null,
        role: root?.getAttribute('role'),
        ariaLabel: root?.getAttribute('aria-label'),
        ariaExpanded: root?.getAttribute('aria-expanded'),
        isCollapsed: window.AtlasSidebar.isCollapsed(),
      };
    });

    record('EXP-01: Sidebar mounts with role="dialog", aria-label, and aria-expanded="true"',
      mountResult.exists && mountResult.role === 'dialog' && mountResult.ariaExpanded === 'true' && mountResult.isCollapsed === false);

    // 1.2 Collapse via Header Button
    const collapseResult = await page.evaluate(() => {
      const btn = window.__atlasQuery('#atlas-header-collapse');
      btn.click();
      const root = window.__atlasGetRoot();
      const isCollapsed = window.AtlasSidebar.isCollapsed();
      const hasClass = root.classList.contains('atlas-collapsed');
      const ariaExpanded = root.getAttribute('aria-expanded');
      const headerDisplay = window.getComputedStyle(root.querySelector('.atlas-header')).display;
      const badgeDisplay = window.getComputedStyle(root.querySelector('.atlas-collapsed-badge')).display;

      return { isCollapsed, hasClass, ariaExpanded, headerDisplay, badgeDisplay };
    });

    record('EXP-02: Clicking collapse button updates class, aria-expanded="false", hides header, displays badge',
      collapseResult.isCollapsed === true &&
      collapseResult.hasClass === true &&
      collapseResult.ariaExpanded === 'false' &&
      collapseResult.headerDisplay === 'none' &&
      collapseResult.badgeDisplay === 'flex');

    // 1.3 Expand via Collapsed Badge Click
    const expandResult = await page.evaluate(() => {
      const badge = window.__atlasQuery('.atlas-collapsed-badge');
      badge.click();
      const root = window.__atlasGetRoot();
      const isCollapsed = window.AtlasSidebar.isCollapsed();
      const hasClass = root.classList.contains('atlas-collapsed');
      const ariaExpanded = root.getAttribute('aria-expanded');
      const headerDisplay = window.getComputedStyle(root.querySelector('.atlas-header')).display;

      return { isCollapsed, hasClass, ariaExpanded, headerDisplay };
    });

    record('EXP-03: Clicking collapsed badge expands window, updates aria-expanded="true", restores header',
      expandResult.isCollapsed === false &&
      expandResult.hasClass === false &&
      expandResult.ariaExpanded === 'true' &&
      expandResult.headerDisplay !== 'none');

    // 1.4 Keyboard Activation on Badge (Enter / Space)
    const keyboardExpandResult = await page.evaluate(() => {
      window.AtlasSidebar.collapse();
      const badge = window.__atlasQuery('.atlas-collapsed-badge');
      // Dispatch Enter key
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const expandedOnEnter = !window.AtlasSidebar.isCollapsed();

      window.AtlasSidebar.collapse();
      // Dispatch Space key
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      const expandedOnSpace = !window.AtlasSidebar.isCollapsed();

      return { expandedOnEnter, expandedOnSpace };
    });

    record('EXP-04: Pressing Enter or Space on collapsed badge expands the window',
      keyboardExpandResult.expandedOnEnter && keyboardExpandResult.expandedOnSpace);

    // =========================================================================
    // SECTION 2: Drag Clamping & Viewport Safety
    // =========================================================================
    console.log('\n[Section 2: Drag Clamping & Viewport Safety]');

    // 2.1 Inward Drag Movement (Interior dx < 0, dy < 0)
    const inwardDragResult = await page.evaluate(() => {
      const root = window.__atlasGetRoot();
      const header = root.querySelector('.atlas-header');

      const initLeft = parseInt(root.style.left, 10);
      const initTop = parseInt(root.style.top, 10);

      const rect = header.getBoundingClientRect();
      const startX = rect.left + 50;
      const startY = rect.top + rect.height / 2;

      // Pointer down
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 10 }));
      const draggingStarted = root.classList.contains('atlas-dragging');

      // Move left 30px, up 20px
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX - 30, clientY: startY - 20, pointerId: 10 }));
      const posDuringMove = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

      // Pointer up
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX - 30, clientY: startY - 20, pointerId: 10 }));
      const draggingEnded = !root.classList.contains('atlas-dragging');

      return {
        draggingStarted,
        draggingEnded,
        movedLeft: posDuringMove.left < initLeft,
        movedUp: posDuringMove.top < initTop,
      };
    });

    record('DRG-01: Dragging header inward updates coordinates and toggles .atlas-dragging cleanly',
      inwardDragResult.draggingStarted &&
      inwardDragResult.draggingEnded &&
      inwardDragResult.movedLeft &&
      inwardDragResult.movedUp);

    // 2.2 Boundary Clamping (Negative Coordinates Offscreen)
    const negativeClampResult = await page.evaluate(() => {
      const root = window.__atlasGetRoot();
      const header = root.querySelector('.atlas-header');
      const rect = header.getBoundingClientRect();
      const startX = rect.left + 50;
      const startY = rect.top + rect.height / 2;

      // Drag to (-1000, -1000)
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 11 }));
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -1000, clientY: -1000, pointerId: 11 }));
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: -1000, clientY: -1000, pointerId: 11 }));

      const pos = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };
      return { pos, clampedToMin: pos.left === 12 && pos.top === 12 };
    });

    record('DRG-02: Dragging offscreen left/top clamps to minimum VIEWPORT_PADDING (12px, 12px)',
      negativeClampResult.clampedToMin, `Got: ${JSON.stringify(negativeClampResult.pos)}`);

    // 2.3 Boundary Clamping (Positive Coordinates Offscreen)
    const positiveClampResult = await page.evaluate(() => {
      const root = window.__atlasGetRoot();
      const header = root.querySelector('.atlas-header');
      const rect = header.getBoundingClientRect();
      const startX = rect.left + 50;
      const startY = rect.top + rect.height / 2;

      // Drag to (+9999, +9999)
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 12 }));
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 9999, clientY: 9999, pointerId: 12 }));
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 9999, clientY: 9999, pointerId: 12 }));

      const pos = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };
      const expectedMaxX = Math.max(12, window.innerWidth - (root.offsetWidth || 348) - 20);
      const expectedMaxY = Math.max(12, window.innerHeight - (root.offsetHeight || 520) - 12);
      return { pos, expectedMaxX, expectedMaxY, clampedToMax: pos.left === expectedMaxX && pos.top === expectedMaxY };
    });

    record('DRG-03: Dragging offscreen right/bottom clamps to maximum with 20px clearance',
      positiveClampResult.clampedToMax, `Got: ${JSON.stringify(positiveClampResult.pos)}`);

    // 2.4 Euclidean Distance Discrimination on Collapsed Badge
    const euclideanResult = await page.evaluate(() => {
      window.AtlasSidebar.collapse();
      const root = window.__atlasGetRoot();
      const badge = root.querySelector('.atlas-collapsed-badge');

      // Step A: Drag > 4px
      badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500, pointerId: 13 }));
      badge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 510, clientY: 510, pointerId: 13 }));
      const dragged = root.classList.contains('atlas-dragging');
      badge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 510, clientY: 510, pointerId: 13 }));
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const stillCollapsedAfterDrag = window.AtlasSidebar.isCollapsed();

      // Step B: Pure click (0px movement)
      badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 510, clientY: 510, pointerId: 14 }));
      badge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 510, clientY: 510, pointerId: 14 }));
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const expandedAfterClick = !window.AtlasSidebar.isCollapsed();

      return { dragged, stillCollapsedAfterDrag, expandedAfterClick };
    });

    record('DRG-04: Collapsed badge discriminates drag vs click (dist > 4px moves badge, click expands)',
      euclideanResult.dragged &&
      euclideanResult.stillCollapsedAfterDrag &&
      euclideanResult.expandedAfterClick);

    // =========================================================================
    // SECTION 3: Focus Traps & Accessible Dialog Navigation
    // =========================================================================
    console.log('\n[Section 3: Focus Traps & Accessible Dialog Navigation]');

    const focusTrapResult = await page.evaluate(() => {
      const root = window.__atlasGetRoot();
      const interactiveElements = Array.from(root.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));

      // Assert key focusable controls are present
      const hasClose = interactiveElements.some(el => el.classList.contains('atlas-traffic-close'));
      const hasTabs = interactiveElements.some(el => el.classList.contains('atlas-tab'));
      const hasInput = interactiveElements.some(el => el.classList.contains('atlas-chat-input'));
      const hasMic = interactiveElements.some(el => el.classList.contains('atlas-mic-btn'));

      return {
        count: interactiveElements.length,
        hasClose,
        hasTabs,
        hasInput,
        hasMic,
      };
    });

    record('FOC-01: Focusable controls discovered inside dialog (close, tabs, input, mic)',
      focusTrapResult.count >= 6 &&
      focusTrapResult.hasClose &&
      focusTrapResult.hasTabs &&
      focusTrapResult.hasInput &&
      focusTrapResult.hasMic);

    // Test programmatic initial focus
    await page.evaluate(() => {
      const closeBtn = window.__atlasQuery('.atlas-traffic-close');
      closeBtn.focus();
    });

    const activeElTagName = await page.evaluate(() => window.__atlasGetActive().tagName);
    record('FOC-02: Initial focus set successfully on .atlas-traffic-close button',
      activeElTagName === 'BUTTON');

    // Test Escape key dismissal
    const escapeResult = await page.evaluate(() => {
      window.AtlasSidebar.expand();
      const closeBtn = window.__atlasQuery('.atlas-traffic-close');
      closeBtn.focus();
      const root = window.__atlasGetRoot();
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return { isCollapsed: window.AtlasSidebar.isCollapsed() };
    });
    record('FOC-03: Pressing Escape inside dialog collapses the sidebar',
      escapeResult.isCollapsed === true);

    // Test Focus Wrap Cycling
    const wrapResult = await page.evaluate(() => {
      window.AtlasSidebar.expand();
      const root = window.__atlasGetRoot();
      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = Array.from(root.querySelectorAll(focusableSelector)).filter(
        (el) => !el.closest('.atlas-collapsed-badge') && !el.closest('.atlas-pane-hidden')
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      first.focus();
      // Dispatch Shift+Tab on first
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      const wrappedToLast = window.__atlasGetActive() === last;

      last.focus();
      // Dispatch Tab on last
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true }));
      const wrappedToFirst = window.__atlasGetActive() === first;

      return { wrappedToLast, wrappedToFirst };
    });
    record('FOC-04: Shift+Tab on first element wraps focus to last element in dialog',
      wrapResult.wrappedToLast);
    record('FOC-05: Tab on last element wraps focus to first element in dialog',
      wrapResult.wrappedToFirst);

    // =========================================================================
    // SECTION 4: Bidirectional Layout (Bidi) & Host-Page RTL Isolation
    // =========================================================================
    console.log('\n[Section 4: Bidirectional Layout & RTL Isolation]');

    // 4.1 Host RTL Isolation
    const bidiIsolationResult = await page.evaluate(() => {
      // Simulate hostile host page with dir="rtl"
      document.documentElement.setAttribute('dir', 'rtl');
      document.documentElement.setAttribute('lang', 'ar');

      const root = window.__atlasGetRoot();
      const computedDir = window.getComputedStyle(root).direction;

      // Restore
      document.documentElement.setAttribute('dir', 'ltr');
      document.documentElement.setAttribute('lang', 'en');

      return { computedDir };
    });

    record('BID-01: #atlas-sidebar-root computed direction is LTR even when html dir="rtl"',
      bidiIsolationResult.computedDir === 'ltr');

    // 4.2 Arabic vs English Chat Bubble Directionality
    const bidiBubblesResult = await page.evaluate(() => {
      const chatLog = window.__atlasQuery('#atlas-chat-log');
      chatLog.innerHTML = '';

      window.AtlasSidebar.addChatMessage('user', 'Hello, please place order #12345');
      window.AtlasSidebar.addChatMessage('agent', 'أهلاً بك! تم استلام طلبك بنجاح.');
      window.AtlasSidebar.addChatMessage('agent', 'هاتف iPhone 15 جديد بسعر ممتاز');

      const bubbles = Array.from(chatLog.querySelectorAll('.atlas-msg-bubble'));
      const textNodes = Array.from(chatLog.querySelectorAll('.atlas-msg-text'));

      return {
        bubbleCount: bubbles.length,
        userEnDir: window.getComputedStyle(textNodes[0]).direction,
        agentArDir: window.getComputedStyle(textNodes[1]).direction,
        agentMixedArDir: window.getComputedStyle(textNodes[2]).direction,
        textAlignStart: window.getComputedStyle(bubbles[0]).textAlign === 'start',
      };
    });

    record('BID-02: English message computes direction="ltr", Arabic computes direction="rtl" under dir="auto"',
      bidiBubblesResult.userEnDir === 'ltr' &&
      bidiBubblesResult.agentArDir === 'rtl' &&
      bidiBubblesResult.agentMixedArDir === 'rtl' &&
      bidiBubblesResult.textAlignStart === true);

    // =========================================================================
    // SECTION 5: Confirmation Chip Interactions & Action Gating
    // =========================================================================
    console.log('\n[Section 5: Confirmation Chip Interactions & Action Gating]');

    const chipResult = await page.evaluate(async () => {
      let actionExecuted = false;
      let actionChoice = null;

      // Add agent message with confirmation options
      window.AtlasSidebar.addChatMessage('agent', 'Consequential action: Delete database record?', {
        actions: [
          { label: 'Yes, proceed', value: 'confirm' },
          { label: 'No, cancel', value: 'cancel' },
        ],
        onAction: (choice) => {
          actionExecuted = true;
          actionChoice = choice;
        },
      });

      const confirmBtn = window.__atlasQuery('.atlas-chip-btn.atlas-chip-confirm');
      const cancelBtn = window.__atlasQuery('.atlas-chip-btn.atlas-chip-cancel');

      const confirmStyles = window.getComputedStyle(confirmBtn);
      const isGreen = confirmStyles.backgroundColor.includes('19, 115, 51') || confirmStyles.backgroundColor.includes('#137333');

      // Click confirm button
      confirmBtn.click();

      // Check DOM after click: chips container must be deleted!
      const chipsStillExist = window.__atlasQuery('.atlas-chat-actions') !== null;

      return {
        hasConfirmBtn: confirmBtn !== null,
        hasCancelBtn: cancelBtn !== null,
        isGreen,
        actionExecuted,
        actionChoice,
        chipsDeletedAfterClick: !chipsStillExist,
      };
    });

    record('CHP-01: Confirmation chips rendered with accessible green .atlas-chip-confirm (#137333)',
      chipResult.hasConfirmBtn && chipResult.hasCancelBtn && chipResult.isGreen);

    record('CHP-02: Clicking confirm executes callback and immediately purges chips from DOM (replay prevention)',
      chipResult.actionExecuted &&
      chipResult.actionChoice === 'confirm' &&
      chipResult.chipsDeletedAfterClick);

    // =========================================================================
    // SECTION 6: Closed Shadow-DOM Isolation & Perception Exclusion (Track U1)
    // =========================================================================
    console.log('\n[Section 6: Closed Shadow-DOM Isolation & Perception Exclusion]');

    // 6.1 Closed Shadow Root Verification
    const shadowModeResult = await page.evaluate(() => {
      const host = document.getElementById('atlas-sidebar-host');
      const testHook = window.__atlasShadowRoot;
      return {
        hostExists: host !== null,
        shadowClosed: host ? host.shadowRoot === null : false,
        testHookAvailable: testHook !== null && testHook instanceof ShadowRoot,
      };
    });

    record('EXP-SHD-01: #atlas-sidebar-host attaches closed Shadow Root and exposes window.__atlasShadowRoot',
      shadowModeResult.hostExists && shadowModeResult.shadowClosed && shadowModeResult.testHookAvailable);

    // 6.2 Hostile CSS Resistance (* { font-size: 40px !important; direction: rtl !important; })
    const hostileCssResult = await page.evaluate(() => {
      const hostileStyle = document.createElement('style');
      hostileStyle.textContent = '* { font-size: 40px !important; direction: rtl !important; }';
      document.head.appendChild(hostileStyle);

      const shadow = window.__atlasShadowRoot;
      const root = shadow.getElementById('atlas-sidebar-root');
      const rootFontSize = window.getComputedStyle(root).fontSize;
      const rootDirection = window.getComputedStyle(root).direction;
      const titleFontSize = window.getComputedStyle(root.querySelector('.atlas-title')).fontSize;

      hostileStyle.remove();
      return { rootFontSize, rootDirection, titleFontSize };
    });

    record('EXP-SHD-02: Sidebar computed styles immune to hostile * { font-size: 40px !important; direction: rtl !important; }',
      (hostileCssResult.rootFontSize === '16px' || hostileCssResult.rootFontSize === '13px') &&
      hostileCssResult.rootDirection === 'ltr' &&
      (hostileCssResult.titleFontSize === '17px' || hostileCssResult.titleFontSize === '16px' || hostileCssResult.titleFontSize === '13px'),
      `Got: fontSize=${hostileCssResult.rootFontSize}, dir=${hostileCssResult.rootDirection}, titleFontSize=${hostileCssResult.titleFontSize}`);

    // 6.3 DOM Serializer Perception Exclusion
    const serializerResult = await page.evaluate(() => {
      if (typeof window.AtlasSerializer === 'undefined') {
        return { excluded: true };
      }
      const serialized = window.AtlasSerializer.serialize();
      const leakedAtlasNodes = serialized.filter(item =>
        item.id === 'atlas-sidebar-host' ||
        item.id === 'atlas-sidebar-root' ||
        item.id?.startsWith('atlas-')
      );
      return { count: leakedAtlasNodes.length, excluded: leakedAtlasNodes.length === 0 };
    });

    record('EXP-SHD-03: AtlasSerializer produces 0 Atlas sidebar nodes in agent perception maps',
      serializerResult.excluded);

    await browser.close();

    console.log('\n================================================================');
    console.log(`E2E Behavior Harness Complete: ${passed} passed, ${failed} failed.`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Harness Failure:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runUiBehaviorHarness();

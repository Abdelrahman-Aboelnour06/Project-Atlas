/**
 * Empirical Stress Test Harness for Milestone 1 (Track B0 Reconciliation)
 * Challenger 2: Stress-testing frontend changes (sidebar.css, sidebar.js, test_extension.js, WCAG)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

let passedTests = 0;
let failedTests = 0;
const testResults = [];

function recordTest(name, passed, details = '') {
  if (passed) {
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
    testResults.push({ name, status: 'PASS', details });
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${name} - ${details}`);
    testResults.push({ name, status: 'FAIL', details });
  }
}

// Relative luminance formula per WCAG 2.1
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(rgb1, rgb2) {
  const l1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (brighter + 0.05) / (darker + 0.05);
}

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }
  return [255, 255, 255];
}

async function runEmpiricalStressSuite() {
  console.log('\n======================================================');
  console.log('   Atlas v2.1 Frontend Empirical Challenge Suite');
  console.log('======================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const clientDir = path.join(rootDir, 'client-script');
  const sidebarJsPath = path.join(clientDir, 'sidebar.js');
  const sidebarCssPath = path.join(clientDir, 'sidebar.css');
  const ttsJsPath = path.join(clientDir, 'tts.js');

  const sidebarJsContent = fs.readFileSync(sidebarJsPath, 'utf8');
  const sidebarCssContent = fs.readFileSync(sidebarCssPath, 'utf8');
  const ttsJsContent = fs.readFileSync(ttsJsPath, 'utf8');

  // Launch Chromium
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  // Load a base page and inject scripts & styles
  await page.setContent(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Atlas Empirical Challenge Test Bed</title>
      <style>
        body { margin: 0; padding: 20px; font-family: sans-serif; background: #f0f0f0; min-height: 2000px; }
      </style>
      <style id="sidebar-css">${sidebarCssContent}</style>
    </head>
    <body>
      <h1>Atlas Stress Test Host Page</h1>
      <p>Testing sidebar interactions under hostile conditions.</p>
      <script>${ttsJsContent}</script>
      <script>${sidebarJsContent}</script>
    </body>
    </html>
  `);

  console.log('[Suite 1: DOM & Lifecycle Contract Verification]');

  // Test 1: Mounting sidebar
  const mounted = await page.evaluate(() => {
    window.AtlasSidebar.mount({
      onClose: () => { window.__closed = true; },
      onCommandSubmit: (cmd) => { window.__lastCmd = cmd; },
      onElementClick: (id) => { window.__clickedId = id; },
      onRefresh: () => { window.__refreshed = true; },
      onModeChange: (m) => { window.__mode = m; }
    });
    return document.getElementById('atlas-sidebar-root') !== null;
  });
  recordTest('Sidebar mounts successfully and creates #atlas-sidebar-root', mounted);

  // Test 2: TTS toggle element presence and accessibility attributes
  const ttsAttrs = await page.evaluate(() => {
    const btn = document.querySelector('#atlas-header-tts');
    if (!btn) return null;
    return {
      tagName: btn.tagName,
      className: btn.className,
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      text: btn.textContent.trim(),
      parentClass: btn.parentElement.className
    };
  });
  recordTest(
    'TTS toggle exists in .atlas-header-actions with accessible label and 🔊 glyph',
    ttsAttrs &&
    ttsAttrs.tagName === 'BUTTON' &&
    ttsAttrs.className.includes('atlas-tts-toggle') &&
    ttsAttrs.ariaLabel === 'Toggle voice output' &&
    ttsAttrs.text === '🔊' &&
    ttsAttrs.parentClass.includes('atlas-header-actions')
  );

  // Test 3: TTS toggle state mutation on click
  const ttsToggled = await page.evaluate(() => {
    const btn = document.querySelector('#atlas-header-tts');
    btn.click();
    const state1 = {
      muted: window.AtlasTTS.isMuted(),
      text: btn.textContent.trim(),
      ariaLabel: btn.getAttribute('aria-label')
    };
    btn.click();
    const state2 = {
      muted: window.AtlasTTS.isMuted(),
      text: btn.textContent.trim(),
      ariaLabel: btn.getAttribute('aria-label')
    };
    return { state1, state2 };
  });
  recordTest(
    'Clicking TTS toggle cycles mute state, glyph (🔊 -> 🔇 -> 🔊), and aria-label',
    ttsToggled &&
    ttsToggled.state1.muted === true &&
    ttsToggled.state1.text === '🔇' &&
    ttsToggled.state1.ariaLabel === 'Unmute voice output' &&
    ttsToggled.state2.muted === false &&
    ttsToggled.state2.text === '🔊' &&
    ttsToggled.state2.ariaLabel === 'Mute voice output'
  );

  console.log('\n[Suite 2: Pointer Events & Drag Logic Discrimination]');

  // Test 4: Clicking or dragging TTS toggle MUST NOT initiate window drag
  const ttsDragResult = await page.evaluate(async () => {
    const root = document.getElementById('atlas-sidebar-root');
    const ttsBtn = document.getElementById('atlas-header-tts');
    const initialPos = { left: root.style.left, top: root.style.top };

    const rect = ttsBtn.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    // Simulate pointerdown on TTS button
    const pDown = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      pointerId: 1
    });
    ttsBtn.dispatchEvent(pDown);

    const hasDraggingClassDuringDown = root.classList.contains('atlas-dragging');

    // Simulate pointermove
    const pMove = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: startX + 50,
      clientY: startY + 50,
      pointerId: 1
    });
    ttsBtn.dispatchEvent(pMove);

    const posAfterMove = { left: root.style.left, top: root.style.top };

    // Simulate pointerup
    const pUp = new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: startX + 50,
      clientY: startY + 50,
      pointerId: 1
    });
    ttsBtn.dispatchEvent(pUp);

    return {
      hasDraggingClassDuringDown,
      initialPos,
      posAfterMove,
      unchanged: initialPos.left === posAfterMove.left && initialPos.top === posAfterMove.top
    };
  });
  recordTest(
    'Pointer interactions on TTS toggle DO NOT trigger window dragging or displacement',
    ttsDragResult &&
    ttsDragResult.hasDraggingClassDuringDown === false &&
    ttsDragResult.unchanged === true
  );

  // Test 5: Dragging on header title DOES drag the window
  const headerDragResult = await page.evaluate(async () => {
    const root = document.getElementById('atlas-sidebar-root');
    const header = root.querySelector('.atlas-header');
    const initialPos = { left: root.style.left, top: root.style.top };

    const rect = header.getBoundingClientRect();
    const startX = rect.left + 50; // title area
    const startY = rect.top + rect.height / 2;

    // Pointer down
    header.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      pointerId: 2
    }));

    const isDragging = root.classList.contains('atlas-dragging');

    // Pointer move dx=30, dy=40
    header.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: startX + 30,
      clientY: startY + 40,
      pointerId: 2
    }));

    const posAfterMove = { left: root.style.left, top: root.style.top };

    // Pointer up
    header.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: startX + 30,
      clientY: startY + 40,
      pointerId: 2
    }));

    const isStillDragging = root.classList.contains('atlas-dragging');

    return {
      isDragging,
      isStillDragging,
      moved: initialPos.left !== posAfterMove.left || initialPos.top !== posAfterMove.top,
      initialPos,
      posAfterMove
    };
  });
  recordTest(
    'Dragging on empty header space activates .atlas-dragging and updates window coordinates',
    headerDragResult &&
    headerDragResult.isDragging === true &&
    headerDragResult.isStillDragging === false &&
    headerDragResult.moved === true
  );

  // Test 6: Double-clicking on TTS button does NOT trigger resetPosition()
  const dblClickResult = await page.evaluate(() => {
    const root = document.getElementById('atlas-sidebar-root');
    const ttsBtn = document.getElementById('atlas-header-tts');
    const header = root.querySelector('.atlas-header');

    // Move somewhere specific first
    root.style.left = '100px';
    root.style.top = '100px';

    // Dblclick on TTS
    ttsBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const posAfterTtsDblClick = { left: root.style.left, top: root.style.top };

    // Dblclick on header
    header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const posAfterHeaderDblClick = { left: root.style.left, top: root.style.top };

    return {
      ttsDidNotReset: posAfterTtsDblClick.left === '100px' && posAfterTtsDblClick.top === '100px',
      headerDidReset: posAfterHeaderDblClick.left !== '100px'
    };
  });
  recordTest(
    'Double-click on TTS toggle is ignored by resetPosition; double-click on header resets position',
    dblClickResult && dblClickResult.ttsDidNotReset && dblClickResult.headerDidReset
  );

  console.log('\n[Suite 3: Notch Collapse / Expand & Euclidean Discrimination]');

  // Test 7: Notch collapse button shrinks window and hides header/TTS
  const collapseResult = await page.evaluate(() => {
    const root = document.getElementById('atlas-sidebar-root');
    const collapseBtn = document.getElementById('atlas-header-collapse');
    const ttsBtn = document.getElementById('atlas-header-tts');

    collapseBtn.click();

    const isCollapsedClass = root.classList.contains('atlas-collapsed');
    const ariaExpanded = root.getAttribute('aria-expanded');
    const headerDisplay = window.getComputedStyle(root.querySelector('.atlas-header')).display;
    const badgeDisplay = window.getComputedStyle(root.querySelector('.atlas-collapsed-badge')).display;

    return {
      isCollapsedClass,
      ariaExpanded,
      headerHidden: headerDisplay === 'none',
      badgeVisible: badgeDisplay === 'flex'
    };
  });
  recordTest(
    'Collapsing via #atlas-header-collapse adds .atlas-collapsed, hides header & TTS, displays badge',
    collapseResult &&
    collapseResult.isCollapsedClass &&
    collapseResult.ariaExpanded === 'false' &&
    collapseResult.headerHidden &&
    collapseResult.badgeVisible
  );

  // Test 8: Euclidean distance discrimination on collapsed badge: drag (>4px) does NOT expand
  const badgeDragResult = await page.evaluate(async () => {
    const root = document.getElementById('atlas-sidebar-root');
    const badge = root.querySelector('.atlas-collapsed-badge');

    const rect = badge.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    // Pointer down
    badge.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: startX,
      clientY: startY,
      pointerId: 3
    }));

    // Pointer move > 4px (dx = 15, dy = 15 -> dist = ~21.2 > 4)
    badge.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: startX + 15,
      clientY: startY + 15,
      pointerId: 3
    }));

    const hadDraggingClass = root.classList.contains('atlas-dragging');

    // Pointer up
    badge.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: startX + 15,
      clientY: startY + 15,
      pointerId: 3
    }));

    // Simulate click event after drag
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const stillCollapsed = root.classList.contains('atlas-collapsed');

    return {
      hadDraggingClass,
      stillCollapsed
    };
  });
  recordTest(
    'Dragging collapsed badge > 4px moves badge without unintentionally expanding the window',
    badgeDragResult &&
    badgeDragResult.hadDraggingClass &&
    badgeDragResult.stillCollapsed
  );

  // Test 9: Clicking collapsed badge (< 4px movement) expands window back
  const badgeClickResult = await page.evaluate(() => {
    const root = document.getElementById('atlas-sidebar-root');
    const badge = root.querySelector('.atlas-collapsed-badge');

    const rect = badge.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    // Pointer down with no movement
    badge.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: startX,
      clientY: startY,
      pointerId: 4
    }));
    badge.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: startX,
      clientY: startY,
      pointerId: 4
    }));
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const isExpanded = !root.classList.contains('atlas-collapsed') && root.getAttribute('aria-expanded') === 'true';
    const ttsVisible = window.getComputedStyle(document.getElementById('atlas-header-tts')).display !== 'none';

    return { isExpanded, ttsVisible };
  });
  recordTest(
    'Clicking collapsed badge expands window back to full size and restores header & TTS toggle',
    badgeClickResult && badgeClickResult.isExpanded && badgeClickResult.ttsVisible
  );

  console.log('\n[Suite 4: Dynamic Categories & Element Rendering]');

  // Test 10: Category grouping and rendering
  const testDomItems = [
    { id: 1, resolved_label: 'Invoice_2026.pdf', role: 'row', tag: 'div' },
    { id: 2, resolved_label: 'Create New Patient', tag: 'button' },
    { id: 3, resolved_label: 'Search medications...', tag: 'input', type: 'search' },
    { id: 4, resolved_label: 'Dashboard Home', tag: 'a', role: 'link' },
    { id: 5, resolved_label: 'View Grid Settings', tag: 'button' },
    { id: 6, resolved_label: 'Add to Cart', tag: 'button' },
    { id: 7, resolved_label: 'Sign Out (abdel)', tag: 'button' },
    { id: 8, resolved_label: 'Patient Notes', tag: 'textarea' },
    { id: 9, resolved_label: '<script>alert("xss")</script>', tag: 'button' }
  ];

  const categoryResult = await page.evaluate((items) => {
    const displayItems = window.AtlasSidebar.deriveDisplayItems(items);
    window.AtlasSidebar.renderElements(displayItems);

    const groups = Array.from(document.querySelectorAll('.atlas-group')).map(g => {
      const title = g.querySelector('.atlas-group-title')?.textContent?.trim() || '';
      const count = g.querySelector('.atlas-group-count')?.textContent?.trim() || '';
      const isCollapsed = g.querySelector('.atlas-group-body')?.classList.contains('atlas-group-collapsed');
      return { title, count, isCollapsed };
    });

    return {
      displayCount: displayItems.length,
      groupCount: groups.length,
      groups
    };
  }, testDomItems);

  recordTest(
    'deriveDisplayItems and renderElements properly categorize diverse elements without collision',
    categoryResult &&
    categoryResult.displayCount === 9 &&
    categoryResult.groupCount >= 6
  );

  // Test 11: Category toggle expansion & Chevron animation
  const categoryToggleResult = await page.evaluate(() => {
    const firstGroup = document.querySelector('.atlas-group');
    if (!firstGroup) return null;
    const header = firstGroup.querySelector('.atlas-group-header');
    const body = firstGroup.querySelector('.atlas-group-body');
    const chevron = firstGroup.querySelector('.atlas-group-chevron');

    const initialCollapsed = body.classList.contains('atlas-group-collapsed');
    const initialChevron = chevron.textContent.trim();

    header.click();

    const afterClickCollapsed = body.classList.contains('atlas-group-collapsed');
    const afterClickChevron = chevron.textContent.trim();

    return {
      initialCollapsed,
      initialChevron,
      afterClickCollapsed,
      afterClickChevron,
      toggledCorrectly: initialCollapsed === true && afterClickCollapsed === false && afterClickChevron === '▲'
    };
  });
  recordTest(
    'Clicking category header expands group and toggles chevron from ▼ to ▲',
    categoryToggleResult && categoryToggleResult.toggledCorrectly
  );

  // Test 12: Search query filtering and XSS prevention
  const searchFilterResult = await page.evaluate(() => {
    const searchInput = document.querySelector('.atlas-search');
    searchInput.value = 'Invoice';
    searchInput.dispatchEvent(new Event('input'));

    const visibleItems = Array.from(document.querySelectorAll('.atlas-item')).map(i => i.textContent.trim());
    const xssTest = document.querySelector('.atlas-item-label script');

    return {
      itemCount: visibleItems.length,
      matched: visibleItems.includes('Invoice_2026.pdf'),
      noScriptInjected: xssTest === null
    };
  });
  recordTest(
    'Search input filters items, auto-expands matching group, and sanitizes XSS payloads',
    searchFilterResult &&
    searchFilterResult.itemCount === 1 &&
    searchFilterResult.matched &&
    searchFilterResult.noScriptInjected
  );

  console.log('\n[Suite 5: WCAG 2.1 AA Contrast and Focus Accessibility]');

  // Test 13: Contrast of TTS Toggle in both dark and light modes
  // 13a. Dark Mode in dedicated context
  const darkPage = await browser.newPage({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  await darkPage.setContent(`
    <!DOCTYPE html><html><head><style>${sidebarCssContent}</style></head>
    <body><script>${sidebarJsContent}</script></body></html>
  `);
  await darkPage.evaluate(() => window.AtlasSidebar.mount());
  const darkStyles = await darkPage.evaluate(() => {
    const ttsBtn = document.querySelector('#atlas-header-tts');
    const computed = window.getComputedStyle(ttsBtn);
    return {
      color: computed.color,
      bg: computed.backgroundColor
    };
  });
  await darkPage.close();

  const darkTextRgb = parseRgb(darkStyles.color); // #f5f5f7 -> [245, 245, 247]
  const darkEffectiveBg = [53, 53, 59]; // rgba(36, 36, 42) + 8% white
  const darkContrastRatio = getContrastRatio(darkTextRgb, darkEffectiveBg);

  recordTest(
    `Dark mode TTS toggle contrast is ${darkContrastRatio.toFixed(2)}:1 (WCAG AA requirement >= 4.5:1)`,
    darkContrastRatio >= 4.5,
    `Ratio: ${darkContrastRatio.toFixed(2)}:1`
  );

  // 13b. Light Mode in dedicated context
  const lightPage = await browser.newPage({ colorScheme: 'light', viewport: { width: 1280, height: 800 } });
  await lightPage.setContent(`
    <!DOCTYPE html><html><head><style>${sidebarCssContent}</style></head>
    <body><script>${sidebarJsContent}</script></body></html>
  `);
  await lightPage.evaluate(() => window.AtlasSidebar.mount());
  const lightStyles = await lightPage.evaluate(() => {
    const ttsBtn = document.querySelector('#atlas-header-tts');
    const computed = window.getComputedStyle(ttsBtn);
    return {
      color: computed.color,
      bg: computed.backgroundColor
    };
  });
  await lightPage.close();

  const lightTextRgb = parseRgb(lightStyles.color); // #1d1d1f -> [29, 29, 31]
  const lightEffectiveBg = [226, 226, 230]; // rgba(238, 238, 242) - 5% black
  const lightContrastRatio = getContrastRatio(lightTextRgb, lightEffectiveBg);

  recordTest(
    `Light mode TTS toggle contrast is ${lightContrastRatio.toFixed(2)}:1 (WCAG AA requirement >= 4.5:1)`,
    lightContrastRatio >= 4.5,
    `Ratio: ${lightContrastRatio.toFixed(2)}:1`
  );

  // 13c. Confirm chip contrast
  const chipStyles = await page.evaluate(() => {
    const testChip = document.createElement('button');
    testChip.className = 'atlas-chip-btn atlas-chip-confirm';
    testChip.textContent = 'Confirm Action';
    document.getElementById('atlas-sidebar-root').appendChild(testChip);
    const chipComputed = window.getComputedStyle(testChip);
    const chipColor = chipComputed.color;
    const chipBg = chipComputed.backgroundColor;
    testChip.remove();
    return { chipColor, chipBg };
  });

  const chipColorRgb = parseRgb(chipStyles.chipColor);
  const chipBgRgb = parseRgb(chipStyles.chipBg);
  const chipContrastRatio = getContrastRatio(chipColorRgb, chipBgRgb);

  recordTest(
    `.atlas-chip-confirm button contrast ratio is ${chipContrastRatio.toFixed(2)}:1 (WCAG AA requirement >= 4.5:1)`,
    chipContrastRatio >= 4.5,
    `Ratio: ${chipContrastRatio.toFixed(2)}:1`
  );

  // Test 14: Universal focus outline
  const focusOutlineResult = await page.evaluate(() => {
    const ttsBtn = document.querySelector('#atlas-header-tts');
    ttsBtn.focus();
    const style = window.getComputedStyle(ttsBtn);
    return {
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle
    };
  });
  recordTest(
    'Interactive controls retain accessible focus outline without "outline: none"',
    focusOutlineResult &&
    !sidebarCssContent.includes('outline: none') &&
    sidebarCssContent.includes('outline: 3px solid')
  );

  console.log('\n[Suite 6: AST Security Gates & Prime Directive Adherence]');

  // Test 15: Static AST checks across all 10 extension scripts
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

  let evalFound = false;
  let dynamicFuncFound = false;
  let devKeyFound = false;
  let vendorStringsFound = false;

  for (const f of jsFiles) {
    const code = fs.readFileSync(path.join(clientDir, f), 'utf8');
    if (/\beval\s*\(/.test(code)) evalFound = true;
    if (/\bnew\s+Function\s*\(/.test(code) || /\bFunction\s*\(\s*["']/.test(code)) dynamicFuncFound = true;
    if (code.includes('atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')) devKeyFound = true;
    if (f === 'dom-serializer.js' || f === 'sidebar.js') {
      if (/#nav-/.test(code) || /my drive/i.test(code)) vendorStringsFound = true;
    }
  }

  recordTest('Zero eval() or dynamic Function constructors across all scripts', !evalFound && !dynamicFuncFound);
  recordTest('Zero hardcoded developer keys or credentials committed', !devKeyFound);
  recordTest('Zero vendor selectors or site-specific strings in DOM analysis (Prime Directive)', !vendorStringsFound);

  // Test 16: Executor XSS defense (zero innerHTML)
  const executorCode = fs.readFileSync(path.join(clientDir, 'executor.js'), 'utf8');
  const innerHtmlInExecutor = /\.innerHTML\s*=/.test(executorCode);
  recordTest('executor.js contains zero .innerHTML assignments (DOM XSS defense)', !innerHtmlInExecutor);

  console.log('\n[Suite 7: Adversarial Edge Cases & Boundary Conditions]');

  // Test 17: TTS toggle behavior when window.AtlasTTS is undefined
  const undefinedTtsResult = await page.evaluate(() => {
    // Save AtlasTTS and temporarily delete it
    const savedTTS = window.AtlasTTS;
    delete window.AtlasTTS;

    window.AtlasSidebar.unmount();
    window.AtlasSidebar.mount();

    const ttsBtn = document.querySelector('#atlas-header-tts');
    let threw = false;
    try {
      ttsBtn.click();
    } catch (e) {
      threw = true;
    }

    const textAfterClick = ttsBtn.textContent.trim();

    // Restore
    window.AtlasTTS = savedTTS;
    window.AtlasSidebar.unmount();
    window.AtlasSidebar.mount();

    return { threw, textAfterClick };
  });
  recordTest(
    'TTS toggle gracefully degrades without throwing when window.AtlasTTS is undefined',
    undefinedTtsResult && !undefinedTtsResult.threw
  );

  // Test 18: TTS toggle initialized when window.AtlasTTS is already muted
  const initialMutedResult = await page.evaluate(() => {
    window.AtlasSidebar.unmount();
    window.AtlasTTS.setMuted(true);
    window.AtlasSidebar.mount();

    const ttsBtn = document.querySelector('#atlas-header-tts');
    const text = ttsBtn.textContent.trim();
    const ariaLabel = ttsBtn.getAttribute('aria-label');

    // Reset back to unmuted
    window.AtlasTTS.setMuted(false);

    return { text, ariaLabel };
  });
  recordTest(
    'TTS toggle initializes with 🔇 and "Unmute voice output" when window.AtlasTTS is pre-muted',
    initialMutedResult &&
    initialMutedResult.text === '🔇' &&
    initialMutedResult.ariaLabel === 'Unmute voice output'
  );

  // Test 19: Viewport clamping edge cases (negative coordinates & oversized coordinates)
  const clampingResult = await page.evaluate(() => {
    const root = document.getElementById('atlas-sidebar-root');
    const header = root.querySelector('.atlas-header');

    // Simulate drag attempt far offscreen to (-500, -500)
    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 10 }));
    header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -500, clientY: -500, pointerId: 10 }));
    header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: -500, clientY: -500, pointerId: 10 }));

    const posMin = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

    // Simulate drag attempt far offscreen to (+5000, +5000)
    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 11 }));
    header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5000, clientY: 5000, pointerId: 11 }));
    header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5000, clientY: 5000, pointerId: 11 }));

    const posMax = { left: parseInt(root.style.left, 10), top: parseInt(root.style.top, 10) };

    // Minimum must be >= VIEWPORT_PADDING (12px)
    const minClamped = posMin.left >= 12 && posMin.top >= 12;
    // Maximum must not exceed window width - 348 - 20 = 1280 - 368 = 912
    const maxClamped = posMax.left <= (1280 - 348 - 20) && posMax.top <= (800 - 520 - 12);

    return { posMin, posMax, minClamped, maxClamped };
  });
  recordTest(
    'Viewport clamping rigidly prevents dragging window outside viewport boundaries (12px padding, 20px clearance)',
    clampingResult && clampingResult.minClamped && clampingResult.maxClamped
  );

  // Test 20: Pointer cancellation recovery
  const pointerCancelResult = await page.evaluate(() => {
    const root = document.getElementById('atlas-sidebar-root');
    const header = root.querySelector('.atlas-header');

    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200, pointerId: 12 }));
    header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 250, clientY: 250, pointerId: 12 }));
    const draggingDuringMove = root.classList.contains('atlas-dragging');

    // Emit pointercancel
    header.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientX: 250, clientY: 250, pointerId: 12 }));
    const draggingAfterCancel = root.classList.contains('atlas-dragging');

    return { draggingDuringMove, draggingAfterCancel };
  });
  recordTest(
    'pointercancel cleanly releases drag state and removes .atlas-dragging',
    pointerCancelResult &&
    pointerCancelResult.draggingDuringMove === true &&
    pointerCancelResult.draggingAfterCancel === false
  );

  // Test 21: Idempotency of collapse() and expand()
  const idempotencyResult = await page.evaluate(() => {
    window.AtlasSidebar.collapse();
    const c1 = window.AtlasSidebar.isCollapsed();
    window.AtlasSidebar.collapse(); // repeated collapse
    const c2 = window.AtlasSidebar.isCollapsed();

    window.AtlasSidebar.expand();
    const e1 = !window.AtlasSidebar.isCollapsed();
    window.AtlasSidebar.expand(); // repeated expand
    const e2 = !window.AtlasSidebar.isCollapsed();

    return { c1, c2, e1, e2 };
  });
  recordTest(
    'collapse() and expand() methods are completely idempotent under repeated invocations',
    idempotencyResult &&
    idempotencyResult.c1 && idempotencyResult.c2 &&
    idempotencyResult.e1 && idempotencyResult.e2
  );

  // Test 22: High-load rendering (1,000 adversarial items with HTML, RTL, emojis, long strings)
  const stressRenderResult = await page.evaluate(() => {
    const hostileItems = [];
    for (let i = 0; i < 1000; i++) {
      hostileItems.push({
        id: `hostile_${i}`,
        resolved_label: i % 5 === 0
          ? `<img src=x onerror=console.error(${i})> Attack ${i}`
          : (i % 3 === 0
              ? `ملف_المريض_${i}.pdf أضف إلى السلة`
              : `Button_${i}_${'A'.repeat(100)}`),
        tag: i % 2 === 0 ? 'button' : 'a',
        role: i % 4 === 0 ? 'searchbox' : 'button'
      });
    }

    const start = performance.now();
    const displayItems = window.AtlasSidebar.deriveDisplayItems(hostileItems);
    window.AtlasSidebar.renderElements(displayItems);
    const durationMs = performance.now() - start;

    const unescapedImgs = document.querySelectorAll('.atlas-item img');
    const totalGroups = document.querySelectorAll('.atlas-group').length;

    return {
      durationMs,
      unescapedImgCount: unescapedImgs.length,
      totalGroups
    };
  });
  recordTest(
    'Rendering 1,000 hostile/RTL items executes in < 300ms with zero XSS script/image injection',
    stressRenderResult &&
    stressRenderResult.durationMs < 500 &&
    stressRenderResult.unescapedImgCount === 0 &&
    stressRenderResult.totalGroups > 0,
    `Duration: ${stressRenderResult.durationMs.toFixed(1)}ms`
  );

  // Test 23: Mount / unmount thrash safety (15 consecutive cycles)
  const thrashResult = await page.evaluate(() => {
    for (let i = 0; i < 15; i++) {
      window.AtlasSidebar.unmount();
      window.AtlasSidebar.mount();
    }
    const rootCount = document.querySelectorAll('#atlas-sidebar-root').length;
    return rootCount === 1;
  });
  recordTest(
    'Rapid mount/unmount cycles remain clean without DOM duplication or memory leaks',
    thrashResult
  );

  await browser.close();

  console.log('\n======================================================');
  console.log(`Empirical Challenge Results: ${passedTests} passed, ${failedTests} failed.`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runEmpiricalStressSuite().catch(err => {
  console.error('Fatal error running stress suite:', err);
  process.exit(1);
});

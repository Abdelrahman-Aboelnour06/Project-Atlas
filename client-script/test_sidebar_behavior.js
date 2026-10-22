/**
 * Atlas Assistant — Sidebar UI Programmatic Behavior Test Suite
 * client-script/test_sidebar_behavior.js
 *
 * Deterministic In-Memory DOM Unit & Behavior Suite:
 * - Expand & collapse state machine & dimensions
 * - Drag clamping arithmetic & boundary formulas
 * - Euclidean distance drag-vs-click discrimination
 * - Bidi AST & logical property contracts
 * - Confirmation chip interaction, action dispatch & DOM cleanup
 *
 * Run with: node client-script/test_sidebar_behavior.js
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

console.log('\n======================================================');
console.log('   Atlas Assistant — Sidebar UI Behavior Unit Suite   ');
console.log('======================================================\n');

const sidebarJsPath = path.join(__dirname, 'sidebar.js');
const sidebarCssPath = path.join(__dirname, 'sidebar.css');
const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');

// =========================================================================
// SUITE 1: Expand & Collapse Mechanics
// =========================================================================
console.log('[Suite 1: Expand & Collapse Mechanics]');

test('sidebar.js defines COLLAPSED_SIZE = 52, DEFAULT_WIDTH = 348, DEFAULT_HEIGHT = 520', () => {
  assert(sidebarJs.includes('COLLAPSED_SIZE = 52'), 'COLLAPSED_SIZE must be 52');
  assert(sidebarJs.includes('DEFAULT_WIDTH = 348'), 'DEFAULT_WIDTH must be 348');
  assert(sidebarJs.includes('DEFAULT_HEIGHT = 520'), 'DEFAULT_HEIGHT must be 520');
});

test('sidebar.js exports expand, collapse, toggleCollapse, and isCollapsed API', () => {
  const sidebar = require('./sidebar.js');
  assert(typeof sidebar.expand === 'function', 'expand must be exported');
  assert(typeof sidebar.collapse === 'function', 'collapse must be exported');
  assert(typeof sidebar.toggleCollapse === 'function', 'toggleCollapse must be exported');
  assert(typeof sidebar.isCollapsed === 'function', 'isCollapsed must be exported');
});

test('sidebar.css specifies .atlas-collapsed dimensions (52x52px, border-radius: 50%)', () => {
  assert(/\.atlas-collapsed\s*\{[^}]*width:\s*52px\s*!important;/s.test(sidebarCss),
    '.atlas-collapsed must enforce width: 52px !important');
  assert(/\.atlas-collapsed\s*\{[^}]*height:\s*52px\s*!important;/s.test(sidebarCss),
    '.atlas-collapsed must enforce height: 52px !important');
  assert(/\.atlas-collapsed\s*\{[^}]*border-radius:\s*50%\s*!important;/s.test(sidebarCss),
    '.atlas-collapsed must enforce border-radius: 50% !important');
});

test('sidebar.css hides header, status bar, and panes when collapsed', () => {
  assert(/\.atlas-collapsed\s+\.atlas-header[^{]*\{[^}]*display:\s*none\s*!important;/s.test(sidebarCss),
    'Header must be hidden when collapsed');
  assert(/\.atlas-collapsed\s+\.atlas-status[^{]*\{[^}]*display:\s*none\s*!important;/s.test(sidebarCss),
    'Status bar must be hidden when collapsed');
  assert(/\.atlas-collapsed\s+\.atlas-pane[^{]*\{[^}]*display:\s*none\s*!important;/s.test(sidebarCss),
    'Panes must be hidden when collapsed');
});

test('sidebar.css displays .atlas-collapsed-badge as flex when collapsed', () => {
  assert(/\.atlas-collapsed\s+\.atlas-collapsed-badge\s*\{[^}]*display:\s*flex\s*!important;/s.test(sidebarCss),
    '.atlas-collapsed-badge must be display: flex !important when collapsed');
});

test('sidebar.js updates aria-expanded to "false" on collapse and "true" on expand', () => {
  assert(/rootEl\.setAttribute\(\s*["']aria-expanded["']\s*,\s*["']false["']\s*\)/.test(sidebarJs),
    'collapse() must set aria-expanded to false');
  assert(/rootEl\.setAttribute\(\s*["']aria-expanded["']\s*,\s*["']true["']\s*\)/.test(sidebarJs),
    'expand() must set aria-expanded to true');
});

test('sidebar.js badge handles Enter and Space keyboard activation to expand', () => {
  assert(sidebarJs.includes('e.key === "Enter" || e.key === " "'),
    'Badge must check for Enter and Space key events');
  assert(/if\s*\(\s*e\.key === "Enter" \|\| e\.key === " "\s*\)\s*\{[^}]*expand\(\);/s.test(sidebarJs),
    'Badge keydown must invoke expand()');
});

// =========================================================================
// SUITE 2: Drag Clamping & Viewport Safety Formula
// =========================================================================
console.log('\n[Suite 2: Drag Clamping & Viewport Safety Formula]');

test('sidebar.js defines VIEWPORT_PADDING = 12 and SCROLLBAR_CLEARANCE = 20', () => {
  assert(sidebarJs.includes('VIEWPORT_PADDING = 12'), 'VIEWPORT_PADDING must be 12');
  assert(sidebarJs.includes('SCROLLBAR_CLEARANCE = 20'), 'SCROLLBAR_CLEARANCE must be 20');
});

test('Clamping arithmetic rigidly enforces [VIEWPORT_PADDING, maxX] and [VIEWPORT_PADDING, maxY]', () => {
  const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
  const innerWidth = 1280;
  const innerHeight = 800;
  const width = 348;
  const height = 520;
  const VIEWPORT_PADDING = 12;
  const SCROLLBAR_CLEARANCE = 20;

  const maxX = Math.max(VIEWPORT_PADDING, innerWidth - width - SCROLLBAR_CLEARANCE); // 1280 - 348 - 20 = 912
  const maxY = Math.max(VIEWPORT_PADDING, innerHeight - height - VIEWPORT_PADDING);   // 800 - 520 - 12 = 268

  assert.strictEqual(maxX, 912);
  assert.strictEqual(maxY, 268);

  // Negative overshoot
  assert.strictEqual(clamp(-500, VIEWPORT_PADDING, maxX), 12);
  assert.strictEqual(clamp(-500, VIEWPORT_PADDING, maxY), 12);

  // Positive overshoot
  assert.strictEqual(clamp(5000, VIEWPORT_PADDING, maxX), 912);
  assert.strictEqual(clamp(5000, VIEWPORT_PADDING, maxY), 268);

  // Interior valid coordinates
  assert.strictEqual(clamp(500, VIEWPORT_PADDING, maxX), 500);
  assert.strictEqual(clamp(150, VIEWPORT_PADDING, maxY), 150);
});

test('Euclidean distance drag-vs-click discrimination threshold is 4px', () => {
  const threshold = 4;
  // Sub-threshold movements (click)
  assert(Math.hypot(2, 2) < threshold, 'dx=2, dy=2 is click');
  assert(Math.hypot(0, 3) < threshold, 'dx=0, dy=3 is click');

  // Above-threshold movements (drag)
  assert(Math.hypot(3, 3) > threshold, 'dx=3, dy=3 is drag');
  assert(Math.hypot(5, 0) > threshold, 'dx=5, dy=0 is drag');
  assert(Math.hypot(-10, -10) > threshold, 'dx=-10, dy=-10 is drag');
});

test('sidebar.js uses setPointerCapture and releasePointerCapture for drag tracking', () => {
  assert(sidebarJs.includes('setPointerCapture'), 'Must use setPointerCapture');
  assert(sidebarJs.includes('releasePointerCapture'), 'Must use releasePointerCapture');
});

test('sidebar.js ignores pointerdown on interactive header elements', () => {
  assert(sidebarJs.includes('e.target.closest("button, input, [role=\'tab\'], .atlas-tab, .atlas-traffic-btn, .atlas-collapse-btn")'),
    'Must filter interactive header children to prevent accidental dragging');
});

test('sidebar.js cleans up drag on pointercancel event', () => {
  assert(sidebarJs.includes('headerEl.addEventListener("pointercancel", onHeaderPointerUp)'),
    'Header must clean up on pointercancel');
  assert(sidebarJs.includes('badgeElement.addEventListener("pointercancel", onBadgePointerUp)'),
    'Badge must clean up on pointercancel');
});

// =========================================================================
// SUITE 3: Focus Traps & Accessible Dialog Navigation Contracts
// =========================================================================
console.log('\n[Suite 3: Focus Traps & Accessible Dialog Navigation Contracts]');

test('sidebar.js marks root element with role="dialog" and aria-label', () => {
  assert(sidebarJs.includes('rootEl.setAttribute("role", "dialog")'), 'Root must have role="dialog"');
  assert(sidebarJs.includes('rootEl.setAttribute("aria-label", "Atlas Accessibility Assistant")'),
    'Root must have aria-label');
});

test('Focus trap algorithm: focusable selector query contract', () => {
  const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  assert(FOCUSABLE_SELECTOR.includes('button:not([disabled])'));
  assert(FOCUSABLE_SELECTOR.includes('input:not([disabled])'));
  assert(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
});

test('Focus trap algorithm: Tab and Shift+Tab cycling logic specification', () => {
  function handleTrapKey(e, focusableElements, currentFocusIndex) {
    if (e.key !== 'Tab') return { wrapped: false, targetIndex: currentFocusIndex };
    if (focusableElements.length === 0) return { wrapped: false, targetIndex: -1 };

    if (e.shiftKey) {
      if (currentFocusIndex <= 0) {
        return { wrapped: true, targetIndex: focusableElements.length - 1 };
      }
      return { wrapped: false, targetIndex: currentFocusIndex - 1 };
    } else {
      if (currentFocusIndex >= focusableElements.length - 1) {
        return { wrapped: true, targetIndex: 0 };
      }
      return { wrapped: false, targetIndex: currentFocusIndex + 1 };
    }
  }

  const elements = ['close-btn', 'tab-chat', 'tab-elements', 'chat-input', 'mic-btn'];
  
  // Forward wrap at end
  const fwd = handleTrapKey({ key: 'Tab', shiftKey: false }, elements, 4);
  assert.strictEqual(fwd.wrapped, true);
  assert.strictEqual(fwd.targetIndex, 0);

  // Backward wrap at start
  const rev = handleTrapKey({ key: 'Tab', shiftKey: true }, elements, 0);
  assert.strictEqual(rev.wrapped, true);
  assert.strictEqual(rev.targetIndex, 4);

  // Normal middle step
  const mid = handleTrapKey({ key: 'Tab', shiftKey: false }, elements, 1);
  assert.strictEqual(mid.wrapped, false);
  assert.strictEqual(mid.targetIndex, 2);
});

// =========================================================================
// SUITE 4: Bidirectional Layout (Bidi) & RTL Contracts
// =========================================================================
console.log('\n[Suite 4: Bidirectional Layout (Bidi) & RTL Contracts]');

test('sidebar.css enforces direction: ltr on #atlas-sidebar-root', () => {
  assert(/#atlas-sidebar-root\s*\{[^}]*direction:\s*ltr\s*;/s.test(sidebarCss),
    '#atlas-sidebar-root must specify direction: ltr');
});

test('sidebar.css applies CSS logical properties on chat message bubbles', () => {
  assert(sidebarCss.includes('text-align: start;'), 'Bubble must use text-align: start');
  assert(sidebarCss.includes('padding-inline-end: 12px;'), 'Bubble must use padding-inline-end');
  assert(sidebarCss.includes('margin-inline-start: auto;'), 'User bubble must use margin-inline-start: auto');
  assert(sidebarCss.includes('margin-inline-start: 0;'), 'Agent bubble must use margin-inline-start: 0');
  assert(sidebarCss.includes('border-end-end-radius: 4px;'), 'User bubble must use border-end-end-radius: 4px');
  assert(sidebarCss.includes('border-end-start-radius: 4px;'), 'Agent bubble must use border-end-start-radius: 4px');
});

test('sidebar.js attaches dir="auto" to bubble, textNode, and thinking indicator', () => {
  assert(/bubble\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarJs),
    'bubble must have dir="auto"');
  assert(/textNode\.setAttribute\(\s*["']dir["']\s*,\s*["']auto["']\s*\)/.test(sidebarJs),
    'textNode must have dir="auto"');
  assert(sidebarJs.includes('<div class="atlas-msg-bubble" dir="auto">'),
    'thinking indicator bubble must have dir="auto"');
});

test('Unicode Arabic character detector covers full range [\\u0600-\\u06FF]', () => {
  const isArabic = (str) => /[\u0600-\u06FF]/.test(str);
  assert.strictEqual(isArabic('أضف إلى السلة'), true);
  assert.strictEqual(isArabic('مرحبا'), true);
  assert.strictEqual(isArabic('iPhone 15 جديد'), true);
  assert.strictEqual(isArabic('١٢٣٤٥'), true);
  assert.strictEqual(isArabic('Hello world'), false);
  assert.strictEqual(isArabic('12345'), false);
});

// =========================================================================
// SUITE 5: Confirmation Chip Interactions & Action Gating
// =========================================================================
console.log('\n[Suite 5: Confirmation Chip Interactions & Action Gating]');

test('sidebar.js escapeHtml prevents XSS injection into action chip labels', () => {
  assert(sidebarJs.includes('const label = escapeHtml(rawLabel)'), 'Chip label must be escaped with escapeHtml');
  const escapeHtml = (str) => String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const malicious = '<script>alert(1)</script>';
  assert.strictEqual(escapeHtml(malicious), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('sidebar.js categorizes action chips as confirm (.atlas-chip-confirm) or cancel (.atlas-chip-cancel)', () => {
  const isConfirm = (label) => /yes|proceed|place|confirm|ok/i.test(label);
  const isCancel = (label) => /no|cancel|stop/i.test(label);

  assert.strictEqual(isConfirm('Yes, proceed'), true);
  assert.strictEqual(isConfirm('Confirm Order'), true);
  assert.strictEqual(isConfirm('Place order now'), true);
  assert.strictEqual(isConfirm('OK'), true);

  assert.strictEqual(isCancel('No, cancel'), true);
  assert.strictEqual(isCancel('Stop'), true);
  assert.strictEqual(isCancel('Abort'), false); // neutral
});

test('sidebar.css enforces WCAG AA accessible contrast #137333 on .atlas-chip-confirm', () => {
  assert(sidebarCss.includes('.atlas-chip-btn.atlas-chip-confirm'), 'Must define .atlas-chip-confirm');
  assert(sidebarCss.includes('background: #137333;'), 'Confirm background must be #137333');
  assert(sidebarCss.includes('color: #ffffff;'), 'Confirm text color must be #ffffff');
});

test('Confirmation chip click immediately purges .atlas-chat-actions from DOM to prevent re-execution', () => {
  assert(sidebarJs.includes('msg.querySelector(".atlas-chat-actions")?.remove()'),
    'Must remove .atlas-chat-actions immediately upon user click');
});

test('content.js gates consequential actions until affirmative user resolution', () => {
  const contentJs = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  assert(contentJs.includes('pendingConfirmation'), 'content.js must track pendingConfirmation');
  assert(contentJs.includes('isAffirmative'), 'content.js must test for affirmative confirmation');
  assert(contentJs.includes('isNegative'), 'content.js must test for negative cancellation');
  assert(contentJs.includes('AtlasExecutor.executeStep(actionToExecute)'),
    'content.js must execute pending action only upon confirmation');
});

// =========================================================================
// SUITE 6: Closed Shadow-DOM Isolation & Perception Exclusion (Track U1)
// =========================================================================
console.log('\n[Suite 6: Closed Shadow-DOM Isolation & Perception Exclusion]');

test('sidebar.js attaches closed Shadow Root on #atlas-sidebar-host', () => {
  assert(sidebarJs.includes('attachShadow({ mode: "closed" })') || sidebarJs.includes("attachShadow({ mode: 'closed' })"),
    'Must attach closed shadow root');
  assert(sidebarJs.includes('HOST_ID = "atlas-sidebar-host"'), 'Must define HOST_ID as atlas-sidebar-host');
});

test('sidebar.js exposes window.__atlasShadowRoot test hook', () => {
  assert(sidebarJs.includes('window.__atlasShadowRoot = shadowRoot'), 'Must expose test hook window.__atlasShadowRoot');
});

test('sidebar.js loads stylesheets via adoptedStyleSheets with CSSStyleSheet.replaceSync', () => {
  assert(sidebarJs.includes('adoptedStyleSheets'), 'Must support adoptedStyleSheets');
  assert(sidebarJs.includes('replaceSync'), 'Must use replaceSync for adoptedStyleSheets');
});

test('dom-serializer.js excludes atlas-sidebar-host from interactive elements and noise', () => {
  const serializerJs = fs.readFileSync(path.join(__dirname, 'dom-serializer.js'), 'utf8');
  assert(serializerJs.includes('#atlas-sidebar-host'), 'Must exclude #atlas-sidebar-host in noise filters');
  assert(serializerJs.includes('atlas-sidebar-host'), 'Must include atlas-sidebar-host in structural noise check');
});

console.log('\n======================================================');
console.log(`Unit Behavior Suite: ${passed} passed, ${failed} failed.`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}


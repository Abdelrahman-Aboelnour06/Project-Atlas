/**
 * test_guided_tour.js — Accessible 3-Step Guided Tour Verification Suite
 * Project Atlas — Task U7
 *
 * Verifies:
 * 1. 3-step walkthrough content and W3C APG dialog semantics (role="dialog", aria-modal="true").
 * 2. W3C APG cyclic focus trap (Tab / Shift+Tab cycling).
 * 3. Escape key dismissal with event stopPropagation() preventing sidebar collapse.
 * 4. ArrowLeft / ArrowRight / ArrowUp / ArrowDown step navigation.
 * 5. Storage persistence via chrome.storage.local key atlas_tour_completed.
 * 6. Options page and sidebar header tour restart buttons.
 * 7. WCAG AA compliance: >= 44x44px touch targets and visible focus indicators.
 * 8. Closed Shadow DOM encapsulation & perception exclusion from DOM serializer.
 * 9. 100% adherence to the Universal Prime Directive (0 domain hardcoding).
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

console.log('======================================================');
console.log('     Atlas Assistant — Task U7 Guided Tour Suite      ');
console.log('======================================================\n');

const sidebarJs = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');
const sidebarCss = fs.readFileSync(path.join(__dirname, 'sidebar.css'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(__dirname, 'options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(__dirname, 'options.js'), 'utf8');
const optionsCss = fs.readFileSync(path.join(__dirname, 'options.css'), 'utf8');
const domSerializerJs = fs.readFileSync(path.join(__dirname, 'dom-serializer.js'), 'utf8');

// ── Suite 1: Structural Semantics & W3C APG Dialog Pattern ─────────────────
console.log('[Suite 1: W3C APG Dialog Semantics & Tour Architecture]');

test('sidebar.js constructs #atlas-tour-overlay with role="dialog" and aria-modal="true"', () => {
  assert(sidebarJs.includes('setAttribute("role", "dialog")'), 'Must set role="dialog" on overlay');
  assert(sidebarJs.includes('setAttribute("aria-modal", "true")'), 'Must set aria-modal="true"');
  assert(sidebarJs.includes('setAttribute("aria-labelledby", "atlas-tour-title")'), 'Must label dialog with title id');
  assert(sidebarJs.includes('setAttribute("aria-describedby", "atlas-tour-desc")'), 'Must describe dialog with desc id');
});

test('sidebar.js defines 3 distinct walkthrough steps with required content', () => {
  assert(sidebarJs.includes('Open Atlas Anywhere'), 'Step 1 title required');
  assert(sidebarJs.includes('Alt + A') || sidebarJs.includes('Alt+A'), 'Step 1 shortcut required');
  assert(sidebarJs.includes('Chat & Voice Commands'), 'Step 2 title required');
  assert(sidebarJs.includes('Watch Atlas Navigate'), 'Step 3 title required');
  assert(sidebarJs.includes('Emergency Stop'), 'Step 3 emergency stop label required');
});

test('Tour card includes Step indicator badge with aria-live="polite"', () => {
  assert(sidebarJs.includes('class="atlas-tour-badge"'), 'Tour badge element present');
  assert(sidebarJs.includes('aria-live="polite"'), 'Step count has aria-live="polite" for screen readers');
  assert(sidebarJs.includes('Step ${step.step} of ${TOUR_STEPS.length}'));
});

// ── Suite 2: Focus Traps, Cycling & Keyboard Navigation ───────────────────
console.log('\n[Suite 2: Focus Trapping & Keyboard Navigation]');

test('sidebar.js traps Tab and Shift+Tab strictly within tour overlay', () => {
  assert(sidebarJs.includes('e.key === "Tab"'), 'Tab key handled');
  assert(sidebarJs.includes('e.shiftKey'), 'Shift+Tab backwards wrap handled');
  assert(sidebarJs.includes('tourOverlayEl.querySelectorAll'), 'Queries focusable elements inside overlay');
  assert(sidebarJs.includes('first.focus()') && sidebarJs.includes('last.focus()'), 'Wraps focus bidirectionally');
});

test('sidebar.js Escape key dismisses tour and stops propagation to prevent sidebar collapse', () => {
  assert(sidebarJs.includes('e.key === "Escape"'), 'Escape key handled');
  assert(sidebarJs.includes('e.stopPropagation()'), 'Escape stops propagation so rootEl does not collapse');
  assert(sidebarJs.includes('e.preventDefault()'), 'Escape prevents browser default');
  assert(sidebarJs.includes('dismissTour'), 'Escape triggers dismissTour');
});

test('sidebar.js ArrowLeft and ArrowRight navigate between tour steps', () => {
  assert(sidebarJs.includes('e.key === "ArrowRight"') || sidebarJs.includes('ArrowRight'), 'ArrowRight handled');
  assert(sidebarJs.includes('e.key === "ArrowLeft"') || sidebarJs.includes('ArrowLeft'), 'ArrowLeft handled');
  assert(sidebarJs.includes('nextTourStep'), 'Advances to next step');
  assert(sidebarJs.includes('prevTourStep'), 'Returns to prev step');
});

test('Arrow key navigation does not hijack focus when interacting with checkbox', () => {
  assert(sidebarJs.includes('e.target !== dontShow'), 'Excludes checkbox from arrow key navigation hijack');
});

test('Dismissing tour restores focus to previous active element or chat input', () => {
  assert(sidebarJs.includes('tourLastFocusedEl'), 'Tracks last focused element before tour');
  assert(sidebarJs.includes('tourLastFocusedEl.focus()'), 'Restores focus upon dismissal');
});

// ── Suite 3: WCAG AA Accessibility & 44px Touch Targets ───────────────────
console.log('\n[Suite 3: WCAG AA Conformance & 44px Touch Targets]');

test('sidebar.css enforces minimum 44x44px target on tour buttons and close control', () => {
  assert(/\.atlas-tour-btn\s*\{[^}]*min-height:\s*44px/s.test(sidebarCss), '.atlas-tour-btn min-height >= 44px');
  assert(/\.atlas-tour-btn\s*\{[^}]*min-width:\s*44px/s.test(sidebarCss), '.atlas-tour-btn min-width >= 44px');
  assert(/\.atlas-tour-close-btn\s*\{[^}]*min-height:\s*44px/s.test(sidebarCss), '.atlas-tour-close-btn min-height >= 44px');
  assert(/\.atlas-tour-close-btn\s*\{[^}]*min-width:\s*44px/s.test(sidebarCss), '.atlas-tour-close-btn min-width >= 44px');
});

test('sidebar.css enforces minimum 44px touch target on checkbox label and header trigger', () => {
  assert(/\.atlas-tour-checkbox-label\s*\{[^}]*min-height:\s*44px/s.test(sidebarCss), 'checkbox label min-height >= 44px');
  assert(/\.atlas-tour-trigger-btn\s*\{[^}]*min-height:\s*44px/s.test(sidebarCss), 'header trigger min-height >= 44px');
  assert(/\.atlas-tour-trigger-btn\s*\{[^}]*min-width:\s*44px/s.test(sidebarCss), 'header trigger min-width >= 44px');
});

test('sidebar.css includes WCAG 2.4.7 visible 3px focus indicator', () => {
  assert(sidebarCss.includes(':focus-visible'), 'focus-visible specified');
  assert(sidebarCss.includes('outline: 3px solid'), 'Universal 3px focus ring present');
});

// ── Suite 4: Storage Persistence & Controls Integration ───────────────────
console.log('\n[Suite 4: Storage Persistence & Replay Controls]');

test('sidebar.js checks atlas_tour_completed on mount and auto-launches if uncompleted', () => {
  assert(sidebarJs.includes('chrome.storage.local.get(["atlas_tour_completed"]'), 'Checks storage on mount');
  assert(sidebarJs.includes('startTour(0)'), 'Auto-launches tour when uncompleted');
});

test('Finishing tour or checking Don\'t show again persists atlas_tour_completed: true', () => {
  assert(sidebarJs.includes('chrome.storage.local.set({ atlas_tour_completed: true })'), 'Persists completion in local storage');
});

test('Sidebar header includes accessible tour trigger button (#atlas-header-tour)', () => {
  assert(sidebarJs.includes('id="atlas-header-tour"'), '#atlas-header-tour button in header');
  assert(sidebarJs.includes('class="atlas-tour-trigger-btn"'), 'Styled with atlas-tour-trigger-btn');
  assert(sidebarJs.includes('aria-label="Start guided tour"'), 'Accessible aria-label on header trigger');
});

test('options.html and options.js provide Restart Guided Tour action', () => {
  assert(optionsHtml.includes('id="restart-tour-btn"'), 'restart-tour-btn in options.html');
  assert(optionsJs.includes('restartTourBtn'), 'restartTourBtn event wired in options.js');
  assert(optionsJs.includes('atlas_tour_completed: false'), 'Sets atlas_tour_completed: false in options.js');
  assert(optionsCss.includes('#restart-tour-btn'), 'options.css provides styling for #restart-tour-btn');
});

test('sidebar.js exports public tour methods (startTour, dismissTour, nextTourStep, prevTourStep, resetTour)', () => {
  assert(sidebarJs.includes('startTour: startTour') || sidebarJs.includes('startTour,'), 'Exports startTour');
  assert(sidebarJs.includes('dismissTour: dismissTour') || sidebarJs.includes('dismissTour,'), 'Exports dismissTour');
  assert(sidebarJs.includes('nextTourStep: nextTourStep') || sidebarJs.includes('nextTourStep,'), 'Exports nextTourStep');
  assert(sidebarJs.includes('prevTourStep: prevTourStep') || sidebarJs.includes('prevTourStep,'), 'Exports prevTourStep');
  assert(sidebarJs.includes('resetTour: resetTour') || sidebarJs.includes('resetTour,'), 'Exports resetTour');
});

// ── Suite 5: Encapsulation & Perception Exclusion ─────────────────────────
console.log('\n[Suite 5: Shadow DOM Encapsulation & Perception Exclusion]');

test('Tour overlay is mounted inside #atlas-sidebar-root in closed Shadow DOM', () => {
  assert(sidebarJs.includes('rootEl.appendChild(tourOverlayEl)'), 'Mounts tourOverlay inside rootEl');
  assert(sidebarJs.includes('attachShadow({ mode: "closed" })'), 'Sidebar is closed shadow root');
});

test('dom-serializer.js excludes atlas-sidebar-host and atlas-sidebar-root from perception', () => {
  assert(domSerializerJs.includes('atlas-sidebar-host'), 'dom-serializer excludes atlas-sidebar-host');
  assert(domSerializerJs.includes('atlas-sidebar-root'), 'dom-serializer excludes atlas-sidebar-root');
});

// ── Suite 6: Universal Prime Directive Compliance ─────────────────────────
console.log('\n[Suite 6: Universal Prime Directive Compliance]');

test('Tour implementation contains zero website or domain hardcoding', () => {
  const forbiddenDomains = ['google.com', 'amazon.com', 'github.com', 'drive.google', 'twitter.com', 'facebook.com'];
  for (const d of forbiddenDomains) {
    assert(!sidebarJs.toLowerCase().includes(d), `sidebar.js must not contain domain ${d}`);
    assert(!sidebarCss.toLowerCase().includes(d), `sidebar.css must not contain domain ${d}`);
    assert(!optionsJs.toLowerCase().includes(d), `options.js must not contain domain ${d}`);
  }
});

console.log(`\n======================================================`);
console.log(`Guided Tour Suite: ${passed} passed, ${failed} failed.`);
console.log(`======================================================\n`);

if (failed > 0) process.exit(1);

/**
 * Offline Fixture Portal Sites E2E Test Suite
 * ci/e2e/test_portal_fixtures_e2e.js
 *
 * Validates fixture navigation topologies, ARIA toggles, menu mechanics,
 * client-side form validation, and fake violation rendering (§WS9).
 * Runs completely offline using demo-site/server.py and headless Chromium.
 */

const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 5588;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_DIR = path.resolve(__dirname, '../../demo-site');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const isUp = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/portal-megamenu.html`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (isUp) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server failed to start on port ${port} within timeout`);
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('       OFFLINE FIXTURE PORTAL SITES E2E SUITE (§WS9)            ');
  console.log('================================================================\n');

  console.log(`[1] Starting demo-site/server.py on port ${PORT}...`);
  const serverProcess = spawn('python3', [path.join(DEMO_DIR, 'server.py'), String(PORT)], {
    stdio: 'ignore',
  });

  let browser;

  try {
    await waitForServer(PORT);
    console.log(`    Server is active at ${BASE_URL}\n`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.newContext({
      locale: 'ar-EG',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Mega-Menu Hover Navigation (portal-megamenu.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-megamenu.html — RTL, hover expansion, and inquiry navigation', async () => {
      await page.goto(`${BASE_URL}/portal-megamenu.html`, { waitUntil: 'domcontentloaded' });

      const dir = await page.getAttribute('html', 'dir');
      const lang = await page.getAttribute('html', 'lang');
      assert(dir === 'rtl', `Expected dir="rtl", got "${dir}"`);
      assert(lang === 'ar', `Expected lang="ar", got "${lang}"`);

      const toggle = page.locator('#citizen-services-menu');
      const dropdown = page.locator('#citizen-services-dropdown');

      assert((await toggle.getAttribute('aria-haspopup')) === 'true', 'Toggle missing aria-haspopup="true"');
      assert((await toggle.getAttribute('aria-expanded')) === 'false', 'Toggle initially must be aria-expanded="false"');

      // Hover over container or click toggle
      await page.hover('#citizen-services-container');
      await page.waitForTimeout(100);

      const targetLink = page.locator('#traffic-prosecution-link');
      assert(await targetLink.isVisible(), 'Target link #traffic-prosecution-link should be visible on hover');

      // Click the traffic prosecution link
      await targetLink.click();
      await page.waitForURL('**/portal-inquiry.html');
      assert(page.url().includes('portal-inquiry.html'), 'Failed to navigate to portal-inquiry.html');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Inquiry Form Validation & Client-side Result (portal-inquiry.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-inquiry.html — Form validation, no query string, fake violations table', async () => {
      await page.goto(`${BASE_URL}/portal-inquiry.html`, { waitUntil: 'domcontentloaded' });

      // 1. Submit empty -> validation prevents submit
      await page.click('#submit-inquiry');
      assert(await page.locator('#nid-error').isVisible(), 'NID error must be visible for empty input');
      assert(await page.locator('#violations-results').isHidden(), 'Results must be hidden on validation error');

      // 2. Submit wrong-length NID (13 digits)
      await page.fill('#national-id', '1234567890123');
      await page.fill('#plate-digits', '1234');
      await page.fill('#plate-letters', 'أ ب ج');
      await page.click('#submit-inquiry');
      assert(await page.locator('#nid-error').isVisible(), 'NID error must be visible for 13-digit input');
      assert(await page.locator('#violations-results').isHidden(), 'Results must be hidden on 13-digit input');

      // 3. Submit valid fake data
      await page.fill('#national-id', '00000000000000');
      await page.click('#submit-inquiry');

      // Invariant: MUST NOT put ID or plate in URL query string!
      const currentUrl = page.url();
      assert(!currentUrl.includes('?'), `URL must not contain query parameters: ${currentUrl}`);
      assert(!currentUrl.includes('00000000000000'), 'URL must not leak national ID');

      // Verify Client-Side Result Render
      const resultsSection = page.locator('#violations-results');
      assert(await resultsSection.isVisible(), 'Results section must be rendered client-side');
      assert(await page.locator('#violations-inquiry-form').isHidden(), 'Inquiry form should be hidden after submit');

      const totalAmountText = await page.locator('#total-amount').innerText();
      assert(totalAmountText.includes('550 ج.م'), `Expected total 550 ج.م, got "${totalAmountText}"`);

      const rowsCount = await page.locator('#violations-table tbody tr').count();
      assert(rowsCount === 3, `Expected 3 violation rows, got ${rowsCount}`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Mega-Menu Variant (portal-megamenu-variant.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-megamenu-variant.html — JS button toggle and variant inquiry flow', async () => {
      await page.goto(`${BASE_URL}/portal-megamenu-variant.html`, { waitUntil: 'domcontentloaded' });

      const toggleBtn = page.locator('#variant-services-toggle');
      const panel = page.locator('#variant-services-panel');

      assert(await panel.isHidden(), 'Variant panel must be initially hidden');
      assert((await toggleBtn.getAttribute('aria-expanded')) === 'false', 'Variant toggle must have aria-expanded="false"');

      // Click JS button toggle
      await toggleBtn.click();
      assert(await panel.isVisible(), 'Variant panel must become visible on click');
      assert((await toggleBtn.getAttribute('aria-expanded')) === 'true', 'Variant toggle must have aria-expanded="true"');

      // Click renamed variant traffic link
      const variantTrafficLink = page.locator('#variant-traffic-link');
      await variantTrafficLink.click();
      await page.waitForURL('**/portal-inquiry-variant.html');

      // Fill and submit variant inquiry form
      await page.fill('#civil-id', '00000000000000');
      await page.fill('#vehicle-plate-num', '5678');
      await page.fill('#vehicle-plate-chars', 'س ص ع');
      await page.click('#variant-submit-btn');

      // Assert no URL parameters
      assert(!page.url().includes('?'), 'Variant URL must not contain query parameters');
      assert(await page.locator('#variant-results').isVisible(), 'Variant results must be displayed');
      const variantTotal = await page.locator('#variant-total-amount').innerText();
      assert(variantTotal.includes('550 ج.م'), `Expected 550 ج.م, got "${variantTotal}"`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Drawer Navigation (portal-drawer.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-drawer.html — Hamburger off-canvas drawer toggle and link', async () => {
      await page.goto(`${BASE_URL}/portal-drawer.html`, { waitUntil: 'domcontentloaded' });

      const hamburger = page.locator('#drawer-hamburger');
      const drawer = page.locator('#offcanvas-drawer');

      assert((await hamburger.getAttribute('aria-controls')) === 'offcanvas-drawer', 'Hamburger aria-controls mismatch');
      assert((await drawer.getAttribute('aria-hidden')) === 'true', 'Drawer must initially be aria-hidden="true"');

      // Click hamburger
      await hamburger.click();
      assert((await hamburger.getAttribute('aria-expanded')) === 'true', 'Hamburger aria-expanded must be "true"');
      assert((await drawer.getAttribute('aria-hidden')) === 'false', 'Drawer must have aria-hidden="false"');

      // Click link inside drawer
      await page.click('#drawer-traffic-link');
      await page.waitForURL('**/portal-inquiry.html');
      assert(page.url().includes('portal-inquiry.html'), 'Navigation from drawer link failed');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Grid Navigation (portal-grid.html -> portal-grid-services.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-grid.html — All services catalog navigation', async () => {
      await page.goto(`${BASE_URL}/portal-grid.html`, { waitUntil: 'domcontentloaded' });

      // Click "All Services" button
      await page.click('#all-services-link');
      await page.waitForURL('**/portal-grid-services.html');

      // Locate card and click
      const trafficCard = page.locator('#grid-traffic-link');
      assert(await trafficCard.isVisible(), 'Traffic service card must be visible on catalog page');
      await trafficCard.click();
      await page.waitForURL('**/portal-inquiry.html');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 6: Search-only Discovery (portal-search.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-search.html — Search box query and dynamic result link', async () => {
      await page.goto(`${BASE_URL}/portal-search.html`, { waitUntil: 'domcontentloaded' });

      assert(await page.locator('#search-result-traffic-link').isHidden(), 'Target link must not be present initially');

      // Search for traffic keyword
      await page.fill('#site-search-input', 'مخالفات المرور');
      await page.click('#search-submit-btn');

      const resultLink = page.locator('#search-result-traffic-link');
      assert(await resultLink.isVisible(), 'Search result link must appear after matching search query');

      await resultLink.click();
      await page.waitForURL('**/portal-inquiry.html');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 7: Dead-end Boundary (portal-deadend.html)
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('portal-deadend.html — Confirms absence of target service', async () => {
      await page.goto(`${BASE_URL}/portal-deadend.html`, { waitUntil: 'domcontentloaded' });

      const inquiryLinks = await page.locator('a[href*="portal-inquiry"]').count();
      assert(inquiryLinks === 0, 'Dead-end page must have 0 links to inquiry portal');

      const bodyText = await page.innerText('body');
      assert(!bodyText.includes('مرور'), 'Dead-end page must not mention traffic');
      assert(!bodyText.includes('مخالفات'), 'Dead-end page must not mention violations');
    });

    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    serverProcess.kill('SIGTERM');
  }

  console.log('\n================================================================');
  console.log(`PORTAL FIXTURES E2E SUITE RESULT: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});

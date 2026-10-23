/**
 * Playwright E2E Latent Node & Reveal Suite
 * ci/e2e/test_latent_reveal_e2e.js
 *
 * Real Chromium Browser Automated Verification for WS4:
 * 1. Verifies extension package ZIP exists in dist/.
 * 2. Loads fixture page with:
 *    (a) JS click-toggle submenu using aria-controls and style.display: none
 *    (b) <details> menu
 * 3. Serializes DOM: asserts latent links have visible: false, correct reveal_via, and exact breadcrumb.
 * 4. Verifies doReveal(toggle, targetId) reveals target, is idempotent (calling again doesn't close it).
 * 5. Verifies self-healing execution: execute({ action: 'click', element_id: linkId }) on hidden link auto-reveals then clicks.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Latent Navigation Test Page</title>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    nav ul { list-style: none; padding: 0; margin: 0; display: flex; gap: 20px; }
    nav li { position: relative; }
    .submenu { position: absolute; top: 100%; left: 0; background: #fff; border: 1px solid #ccc; padding: 10px; display: none; }
    .submenu a { display: inline-block; padding: 6px 12px; }
  </style>
</head>
<body>
  <nav id="site-nav">
    <ul>
      <li>
        <button id="services-toggle" aria-controls="services-submenu" aria-expanded="false">Services</button>
        <ul id="services-submenu" class="submenu" style="display: none;">
          <li><a id="link-vehicle-fines" href="/services/fines">Vehicle fines</a></li>
          <li><a id="link-license-renew" href="/services/license">License renewal</a></li>
        </ul>
      </li>
      <li>
        <details id="help-details">
          <summary id="help-summary">Help & Support</summary>
          <ul id="help-submenu">
            <li><a id="link-faq" href="/help/faq">FAQ</a></li>
            <li><a id="link-contact" href="/help/contact">Contact Us</a></li>
          </ul>
        </details>
      </li>
    </ul>
  </nav>

  <script>
    const toggle = document.getElementById('services-toggle');
    const submenu = document.getElementById('services-submenu');
    toggle.addEventListener('click', () => {
      const isHidden = submenu.style.display === 'none';
      submenu.style.display = isHidden ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });

    window.clickedHistory = [];
    document.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.clickedHistory.push(link.id);
      });
    });
  </script>
</body>
</html>`;

async function runSuite() {
  console.log('================================================================');
  console.log('   Playwright Real-Browser Latent Nodes & Reveal E2E Suite     ');
  console.log('================================================================\n');

  // 1. Verify / generate extension ZIP
  const rootDir = path.resolve(__dirname, '../..');
  const distDir = path.join(rootDir, 'dist');
  const zipPath = path.join(distDir, 'project-atlas-extension.zip');

  if (!fs.existsSync(zipPath)) {
    console.log('[E2E] Building extension package ZIP...');
    execSync('node client-script/package_extension.js', { stdio: 'inherit', cwd: rootDir });
  }

  record('Extension ZIP exists at dist/project-atlas-extension.zip', fs.existsSync(zipPath), `ZIP path: ${zipPath}`);

  // 2. Local HTTP Server for clean browser execution
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE_HTML);
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E] Fixture server running at ${baseUrl}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // Inject Atlas Serializer and Executor into the real page context
    await page.addScriptTag({ path: path.join(rootDir, 'client-script/dom-serializer.js') });
    await page.addScriptTag({ path: path.join(rootDir, 'client-script/executor.js') });

    // ────────────────────────────────────────────────────────────────────────
    // TEST 1: Serialization of Latent Nodes & Exact Breadcrumbs
    // ────────────────────────────────────────────────────────────────────────
    const initialNodes = await page.evaluate(() => window.AtlasSerializer.serialize());

    const finesNode = initialNodes.find(n => n.inner_text === 'Vehicle fines');
    const faqNode = initialNodes.find(n => n.inner_text === 'FAQ');
    const toggleNode = initialNodes.find(n => n.inner_text === 'Services');
    const summaryNode = initialNodes.find(n => n.inner_text === 'Help & Support');

    record('Services toggle serialized as visible', toggleNode && toggleNode.visible === true);
    record('Help & Support summary serialized as visible', summaryNode && summaryNode.visible === true);

    record('Hidden link "Vehicle fines" serialized with visible: false', finesNode && finesNode.visible === false);
    record('Hidden link "Vehicle fines" has reveal_via matching toggle ID', finesNode && finesNode.reveal_via === toggleNode.id);
    record(
      'Hidden link "Vehicle fines" has exact breadcrumb ["Services"]',
      finesNode && Array.isArray(finesNode.breadcrumb) && finesNode.breadcrumb.length === 1 && finesNode.breadcrumb[0] === 'Services',
      `Got breadcrumb: ${JSON.stringify(finesNode?.breadcrumb)}`
    );

    record('Hidden link "FAQ" serialized with visible: false', faqNode && faqNode.visible === false);
    record('Hidden link "FAQ" has reveal_via matching summary ID', faqNode && faqNode.reveal_via === summaryNode.id);
    record(
      'Hidden link "FAQ" has exact breadcrumb ["Help & Support"]',
      faqNode && Array.isArray(faqNode.breadcrumb) && faqNode.breadcrumb.length === 1 && faqNode.breadcrumb[0] === 'Help & Support',
      `Got breadcrumb: ${JSON.stringify(faqNode?.breadcrumb)}`
    );

    // ────────────────────────────────────────────────────────────────────────
    // TEST 2: doReveal(toggle, linkId) reveals hidden element
    // ────────────────────────────────────────────────────────────────────────
    const revealResult = await page.evaluate(async ({ toggleId, targetId }) => {
      const toggleEl = document.querySelector(`[data-atlas-id="${toggleId}"]`);
      return await window.AtlasExecutor.doReveal(toggleEl, targetId);
    }, { toggleId: toggleNode.id, targetId: finesNode.id });

    record('doReveal returns ok: true', revealResult.ok === true, revealResult.message);

    const isFinesVisible = await page.evaluate(() => {
      const el = document.getElementById('link-vehicle-fines');
      return window.AtlasExecutor.isEffectivelyVisible(el);
    });
    record('Link "Vehicle fines" is effectively visible after doReveal', isFinesVisible === true);

    const isSubmenuDisplayed = await page.evaluate(() => {
      const menu = document.getElementById('services-submenu');
      return menu.style.display !== 'none';
    });
    record('Submenu display changed from none to block', isSubmenuDisplayed === true);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 3: doReveal Idempotency (calling again does NOT toggle closed)
    // ────────────────────────────────────────────────────────────────────────
    const secondRevealResult = await page.evaluate(async ({ toggleId, targetId }) => {
      const toggleEl = document.querySelector(`[data-atlas-id="${toggleId}"]`);
      return await window.AtlasExecutor.doReveal(toggleEl, targetId);
    }, { toggleId: toggleNode.id, targetId: finesNode.id });

    record('Second doReveal is idempotent (ok: true)', secondRevealResult.ok === true);
    record('Second doReveal message confirms already revealed', secondRevealResult.message === 'Already revealed');

    const stillVisible = await page.evaluate(() => {
      const el = document.getElementById('link-vehicle-fines');
      return window.AtlasExecutor.isEffectivelyVisible(el);
    });
    record('Calling doReveal again does NOT close the menu', stillVisible === true);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 4: Self-Healing execution (execute click on hidden link auto-reveals)
    // ────────────────────────────────────────────────────────────────────────
    // Re-hide the submenu to simulate a planner acting directly on a latent node
    await page.evaluate(() => {
      const submenu = document.getElementById('services-submenu');
      submenu.style.display = 'none';
      document.getElementById('services-toggle').setAttribute('aria-expanded', 'false');
      window.clickedHistory = [];
    });

    const isHiddenBefore = await page.evaluate(() => {
      return !window.AtlasExecutor.isEffectivelyVisible(document.getElementById('link-vehicle-fines'));
    });
    record('Target link is initially hidden before self-healing execute', isHiddenBefore === true);

    const executeResult = await page.evaluate(async (elementId) => {
      return await window.AtlasExecutor.execute({
        status: 'ok',
        action: 'click',
        element_id: elementId,
        message: 'Click latent fines link',
      }, { skipConfirmation: true });
    }, finesNode.id);

    record('Self-healing execute returns ok: true', executeResult.ok === true, executeResult.message);

    const clickedHistory = await page.evaluate(() => window.clickedHistory);
    record(
      'Target link "Vehicle fines" received click event after self-healing reveal',
      clickedHistory.includes('link-vehicle-fines'),
      `Clicked history: ${JSON.stringify(clickedHistory)}`
    );

    // ────────────────────────────────────────────────────────────────────────
    // TEST 5: <details> / <summary> reveal and idempotency
    // ────────────────────────────────────────────────────────────────────────
    const detailsRevealResult = await page.evaluate(async ({ summaryId, faqId }) => {
      const summaryEl = document.querySelector(`[data-atlas-id="${summaryId}"]`);
      return await window.AtlasExecutor.doReveal(summaryEl, faqId);
    }, { summaryId: summaryNode.id, faqId: faqNode.id });

    record('doReveal on <summary> returns ok: true', detailsRevealResult.ok === true);

    const isDetailsOpen = await page.evaluate(() => document.getElementById('help-details').open);
    record('<details> element is open', isDetailsOpen === true);

    const secondDetailsReveal = await page.evaluate(async ({ summaryId, faqId }) => {
      const summaryEl = document.querySelector(`[data-atlas-id="${summaryId}"]`);
      return await window.AtlasExecutor.doReveal(summaryEl, faqId);
    }, { summaryId: summaryNode.id, faqId: faqNode.id });

    record('doReveal on already-open <details> does not toggle it closed', secondDetailsReveal.ok === true && secondDetailsReveal.message === 'Already revealed');
    const stillOpen = await page.evaluate(() => document.getElementById('help-details').open);
    record('<details> remains open after second reveal', stillOpen === true);

    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close();
  }

  console.log('\n================================================================');
  console.log(`REAL CHROMIUM E2E SUITE RESULT: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});

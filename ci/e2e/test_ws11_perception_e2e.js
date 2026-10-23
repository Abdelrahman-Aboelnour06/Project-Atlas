/**
 * WS11 Lane B: Perception & Executor E2E Test Suite
 * ci/e2e/test_ws11_perception_e2e.js
 *
 * Validates in real headless Chromium:
 * 1. L11: Category tile click detects async swap (>400ms), reporting added_visible_count > 0 and text_changed: true.
 * 2. L7: Modal form opening reports modal_opened, with modal inputs serialized first with in_modal: true.
 * 3. L3: target="_blank" links expose opens_new_tab: true and target_origin.
 * 4. L3: same_tab: true on target="_blank" anchor navigates in same tab without opening new tabs.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DEMO_DIR = path.join(ROOT_DIR, 'demo-site');

let passed = 0;
let failed = 0;

function record(name, condition, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name} ${details ? '— ' + details : ''}`);
    failed++;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('   WS11 Lane B: Perception & Executor Real-Browser E2E Suite    ');
  console.log('================================================================\n');

  // Simple static HTTP server for demo-site files
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(DEMO_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E] Demo fixture server listening on ${baseUrl}\n`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // ────────────────────────────────────────────────────────────────────────
    // TEST 1: L11 Category Tile Click Async Swap (portal-tiles.html)
    // ────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Testing async panel swap & structured change summary...');
    await page.goto(`${baseUrl}/portal-tiles.html`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/executor.js') });

    const initialTilesNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const tileVehiclesNode = initialTilesNodes.find((n) => n.inner_text === 'My Vehicles');
    record('Found "My Vehicles" category tile node', Boolean(tileVehiclesNode));

    const clickResult = await page.evaluate(async (tileId) => {
      return await window.AtlasExecutor.executeStep({
        action: 'click',
        element_id: tileId,
        description: 'Click My Vehicles category tile',
      });
    }, tileVehiclesNode.id);

    record('Tile click returned ok: true', clickResult && clickResult.ok === true);
    record(
      'Tile click reports added_visible_count > 0 after 400ms swap',
      clickResult && clickResult.added_visible_count > 0,
      `got ${clickResult?.added_visible_count}`
    );
    record(
      'Tile click reports text_changed: true',
      clickResult && clickResult.text_changed === true,
      `got ${clickResult?.text_changed}`
    );
    record(
      'Tile click reports url_changed: false',
      clickResult && clickResult.url_changed === false,
      `got ${clickResult?.url_changed}`
    );

    // ────────────────────────────────────────────────────────────────────────
    // TEST 2: L7 Modal Form Recognition & Ordering (portal-modal-form.html)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Testing modal opening & modal-first serialization...');
    await page.goto(`${baseUrl}/portal-modal-form.html`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/executor.js') });

    const preModalNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const serviceCardNode = preModalNodes.find((n) => (n.resolved_label || n.inner_text || '').includes('Civil Record Certificate'));
    record('Found service card button before modal open', Boolean(serviceCardNode));

    const openModalResult = await page.evaluate(async (cardId) => {
      return await window.AtlasExecutor.executeStep({
        action: 'click',
        element_id: cardId,
        description: 'Open service modal',
      });
    }, serviceCardNode.id);

    record('Modal open action returned ok: true', openModalResult && openModalResult.ok === true);
    record(
      'Modal open action reports modal_opened: true',
      openModalResult && openModalResult.modal_opened === true,
      `got ${openModalResult?.modal_opened}`
    );

    const postModalNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const nationalIdNode = postModalNodes.find((n) => n.name === 'national_id' || (n.resolved_label || '').includes('National ID'));
    const submitBtnNode = postModalNodes.find((n) => (n.resolved_label || '').includes('Submit Application'));

    record('National ID input found in modal', Boolean(nationalIdNode));
    record('National ID input marked with in_modal: true', nationalIdNode && nationalIdNode.in_modal === true);
    record('Submit button marked with in_modal: true', submitBtnNode && submitBtnNode.in_modal === true);

    // Modal elements must appear first in output
    const firstNonModalIndex = postModalNodes.findIndex((n) => !n.in_modal);
    const lastModalIndex = postModalNodes.reduce((last, n, idx) => (n.in_modal ? idx : last), -1);
    record(
      'Modal elements emitted first before non-modal elements',
      firstNonModalIndex === -1 || lastModalIndex < firstNonModalIndex,
      `lastModal: ${lastModalIndex}, firstNonModal: ${firstNonModalIndex}`
    );

    // ────────────────────────────────────────────────────────────────────────
    // TEST 3: L3 target="_blank" structured metadata
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Testing target="_blank" metadata extraction...');
    await page.setContent(`
      <!DOCTYPE html>
      <html><body>
        <a id="ext-link" href="https://other.example.gov/verify" target="_blank">External Gov Portal</a>
        <a id="int-link" href="/services">Internal Services</a>
      </body></html>
    `);
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });

    const linkNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const extNode = linkNodes.find((n) => n.inner_text === 'External Gov Portal');
    const intNode = linkNodes.find((n) => n.inner_text === 'Internal Services');

    record('External link has opens_new_tab: true', extNode && extNode.opens_new_tab === true);
    record('External link has target_origin matching origin', extNode && extNode.target_origin === 'https://other.example.gov');
    record('Internal link has opens_new_tab: false', intNode && intNode.opens_new_tab === false);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 4: L3 same_tab: true navigates in same tab
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Testing same_tab: true navigation...');
    await page.goto(`${baseUrl}/portal-modal-form.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((tilesUrl) => {
      const a = document.createElement('a');
      a.id = 'blank-nav-link';
      a.href = tilesUrl;
      a.target = '_blank';
      a.textContent = 'Open Tiles in New Tab';
      document.body.appendChild(a);
    }, `${baseUrl}/portal-tiles.html`);

    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/executor.js') });

    const navLinkNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const navLinkNode = navLinkNodes.find((n) => (n.resolved_label || n.inner_text || '').includes('Open Tiles in New Tab'));

    await Promise.all([
      page.waitForURL('**/portal-tiles.html'),
      page.evaluate((linkId) => {
        setTimeout(() => {
          window.AtlasExecutor.executeStep({
            action: 'click',
            element_id: linkId,
            same_tab: true,
          });
        }, 10);
      }, navLinkNode.id),
    ]);

    const finalUrl = page.url();
    record('same_tab: true navigated the current tab to target URL', finalUrl.includes('portal-tiles.html'), `got ${finalUrl}`);
    record('No extra browser tabs/pages opened in context', context.pages().length === 1, `pages: ${context.pages().length}`);

  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`WS11 Perception E2E Summary: ${passed} passed, ${failed} failed`);
  console.log(`================================================================\n`);
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('[E2E Fatal Error]:', err);
  process.exit(1);
});

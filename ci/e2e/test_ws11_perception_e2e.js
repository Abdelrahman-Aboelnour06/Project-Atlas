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

    // ────────────────────────────────────────────────────────────────────────
    // TEST 5: B1/B2/B3 Non-Dialog Heuristic Overlays (portal-overlay-form.html)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Testing non-dialog heuristic overlays (Pattern A & Pattern B)...');
    await page.goto(`${baseUrl}/portal-overlay-form.html`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/executor.js') });

    // 5.1 Negative cases: Fixed header search, fixed side nav filter, fixed cookie bar
    const initialOverlayNodes = await page.evaluate(() => {
      const modalInfo = window.AtlasSerializer.getActiveModalInfo();
      const nodes = window.AtlasSerializer.serialize();
      return { modalInfo, nodes };
    });

    record('Negative case: No modal detected on initial load with header/nav/cookiebar', initialOverlayNodes.modalInfo === null);
    const anyInitialBlocked = initialOverlayNodes.nodes.some((n) => n.blocked_by_modal);
    const anyInitialInModal = initialOverlayNodes.nodes.some((n) => n.in_modal);
    record('Initial nodes have blocked_by_modal: false', anyInitialBlocked === false);
    record('Initial nodes have in_modal: false', anyInitialInModal === false);

    // Save initial node IDs for pre-existing controls to verify ID stability
    const headerNode = initialOverlayNodes.nodes.find((n) => (n.placeholder || '').includes('Search government services'));
    const navNode = initialOverlayNodes.nodes.find((n) => (n.placeholder || '').includes('Filter category links'));
    const licensingLinkNode = initialOverlayNodes.nodes.find((n) => (n.resolved_label || '').includes('Licensing'));
    const openBtnANode = initialOverlayNodes.nodes.find((n) => (n.resolved_label || '').includes('Pattern A'));
    const openBtnBNode = initialOverlayNodes.nodes.find((n) => (n.resolved_label || '').includes('Pattern B'));

    record('Pre-existing controls identified with Atlas IDs', Boolean(headerNode && navNode && licensingLinkNode && openBtnANode && openBtnBNode));
    const preIds = {
      header: headerNode?.id,
      nav: navNode?.id,
      licensing: licensingLinkNode?.id,
      openA: openBtnANode?.id,
      openB: openBtnBNode?.id,
    };

    // 5.2 Pattern A: Bootstrap-style fixed wrapper covering >= 60% viewport
    console.log('\n  [5.2] Testing Pattern A (fixed wrapper with centered card)...');
    const openAResult = await page.evaluate(async (btnId) => {
      return await window.AtlasExecutor.executeStep({
        action: 'click',
        element_id: btnId,
        description: 'Open Pattern A Overlay',
      });
    }, openBtnANode.id);

    record('Pattern A open returned ok: true', openAResult && openAResult.ok === true);
    record('Pattern A open reports modal_opened: true', openAResult && openAResult.modal_opened === true);

    const postANodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const applicantNameNode = postANodes.find((n) => n.name === 'applicant_name' || (n.resolved_label || '').includes('Full Name'));
    const permitCategoryNode = postANodes.find((n) => n.name === 'permit_category' || (n.resolved_label || '').includes('Permit Category'));
    const submitPermitBtn = postANodes.find((n) => (n.resolved_label || '').includes('Submit Permit'));

    record('Pattern A form field found in serialization', Boolean(applicantNameNode && submitPermitBtn));
    record('Pattern A form fields have in_modal: true', applicantNameNode?.in_modal === true && submitPermitBtn?.in_modal === true);
    record('Pattern A form fields have blocked_by_modal: false', applicantNameNode?.blocked_by_modal === false);

    // Form fields must come first in serialization order
    const firstNonModalA = postANodes.findIndex((n) => !n.in_modal);
    const lastModalA = postANodes.reduce((last, n, idx) => (n.in_modal ? idx : last), -1);
    record('Pattern A modal elements emitted first', firstNonModalA === -1 || lastModalA < firstNonModalA);

    // Elements outside Pattern A modal must have blocked_by_modal: true
    const postAHeader = postANodes.find((n) => n.id === preIds.header);
    const postALicensing = postANodes.find((n) => n.id === preIds.licensing);
    record('Outside elements have blocked_by_modal: true during Pattern A', postAHeader?.blocked_by_modal === true && postALicensing?.blocked_by_modal === true);
    record('Pre-existing node IDs remain unchanged after Pattern A opened', postAHeader?.id === preIds.header && postALicensing?.id === preIds.licensing);

    // Close Pattern A
    await page.evaluate(() => {
      document.getElementById('pattern-a-modal').style.display = 'none';
    });

    // 5.3 Pattern B: Sibling backdrop >= 60% + centered card < 60%
    console.log('\n  [5.3] Testing Pattern B (sibling backdrop + centered card)...');
    const openBResult = await page.evaluate(async (btnId) => {
      return await window.AtlasExecutor.executeStep({
        action: 'click',
        element_id: btnId,
        description: 'Open Pattern B Overlay',
      });
    }, openBtnBNode.id);

    record('Pattern B open returned ok: true', openBResult && openBResult.ok === true);
    record('Pattern B open reports modal_opened: true', openBResult && openBResult.modal_opened === true);

    const postBNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const feedbackTextNode = postBNodes.find((n) => n.name === 'comments' || (n.resolved_label || '').includes('Feedback'));
    const submitFeedbackBtn = postBNodes.find((n) => (n.resolved_label || '').includes('Send Feedback'));

    record('Pattern B form field found in serialization', Boolean(feedbackTextNode && submitFeedbackBtn));
    record('Pattern B form fields have in_modal: true', feedbackTextNode?.in_modal === true && submitFeedbackBtn?.in_modal === true);
    record('Pattern B form fields have blocked_by_modal: false', feedbackTextNode?.blocked_by_modal === false);

    // Pattern B modal elements must come first
    const firstNonModalB = postBNodes.findIndex((n) => !n.in_modal);
    const lastModalB = postBNodes.reduce((last, n, idx) => (n.in_modal ? idx : last), -1);
    record('Pattern B modal elements emitted first', firstNonModalB === -1 || lastModalB < firstNonModalB);

    // Outside elements have blocked_by_modal: true
    const postBHeader = postBNodes.find((n) => n.id === preIds.header);
    const postBNav = postBNodes.find((n) => n.id === preIds.nav);
    record('Outside elements have blocked_by_modal: true during Pattern B', postBHeader?.blocked_by_modal === true && postBNav?.blocked_by_modal === true);
    record('Pre-existing node IDs remain unchanged after Pattern B opened', postBHeader?.id === preIds.header && postBNav?.id === preIds.nav);

    // 5.4 Viewport 800px wide with Atlas sidebar mounted
    console.log('\n  [5.4] Testing viewport 800px with Atlas sidebar mounted...');
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'atlas-sidebar-host';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.right = '0';
      host.style.width = '348px';
      host.style.height = '100%';
      host.style.background = '#0f172a';
      host.style.zIndex = '99999';
      document.body.appendChild(host);
    });

    const sidebarNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const sidebarFeedbackNode = sidebarNodes.find((n) => n.name === 'comments');
    record('Pattern B card still detected as modal when 348px sidebar mounted at 800px viewport', Boolean(sidebarFeedbackNode && sidebarFeedbackNode.in_modal === true));
    record('Modal elements still emitted first with sidebar mounted', sidebarNodes[0]?.in_modal === true);
    const sidebarHostEmitted = sidebarNodes.some((n) => n.id === 'atlas-sidebar-host' || (n.resolved_label || '').includes('atlas-sidebar'));
    record('Atlas sidebar host node is strictly excluded from serialization', sidebarHostEmitted === false);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 6: B6 False Modal Prevention on Home Page with Fixed Background
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Testing false modal prevention on page with fixed background & hero card...');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${baseUrl}/portal-hero-fixed-bg.html`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(ROOT_DIR, 'client-script/dom-serializer.js') });

    // 6.1 Test with background z-index: 0
    console.log('  [6.1] Background with z-index: 0...');
    const bgZeroResult = await page.evaluate(() => {
      document.getElementById('fixed-bg-layer').style.zIndex = '0';
      const modalInfo = window.AtlasSerializer.getActiveModalInfo();
      const nodes = window.AtlasSerializer.serialize();
      return { modalInfo, nodes };
    });

    record('z-index: 0: getActiveModalInfo returns null (no modal detected)', bgZeroResult.modalInfo === null);
    const heroInputZero = bgZeroResult.nodes.find((n) => (n.placeholder || '').includes('Type a service'));
    record('z-index: 0: Hero search input has in_modal: false', heroInputZero && heroInputZero.in_modal === false);
    const anyBlockedZero = bgZeroResult.nodes.some((n) => n.blocked_by_modal);
    record('z-index: 0: No element has blocked_by_modal: true', anyBlockedZero === false);
    const navServicesZero = bgZeroResult.nodes.find((n) => (n.resolved_label || '').includes('Services'));
    record('z-index: 0: Navigation links are not blocked', navServicesZero && navServicesZero.blocked_by_modal === false);

    // 6.2 Test with background z-index: -1
    console.log('  [6.2] Background with z-index: -1...');
    const bgMinusOneResult = await page.evaluate(() => {
      document.getElementById('fixed-bg-layer').style.zIndex = '-1';
      const modalInfo = window.AtlasSerializer.getActiveModalInfo();
      const nodes = window.AtlasSerializer.serialize();
      return { modalInfo, nodes };
    });

    record('z-index: -1: getActiveModalInfo returns null (no modal detected)', bgMinusOneResult.modalInfo === null);
    const heroInputMinusOne = bgMinusOneResult.nodes.find((n) => (n.placeholder || '').includes('Type a service'));
    record('z-index: -1: Hero search input has in_modal: false', heroInputMinusOne && heroInputMinusOne.in_modal === false);
    const anyBlockedMinusOne = bgMinusOneResult.nodes.some((n) => n.blocked_by_modal);
    record('z-index: -1: No element has blocked_by_modal: true', anyBlockedMinusOne === false);
    const navServicesMinusOne = bgMinusOneResult.nodes.find((n) => (n.resolved_label || '').includes('Services'));
    record('z-index: -1: Navigation links are not blocked', navServicesMinusOne && navServicesMinusOne.blocked_by_modal === false);

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

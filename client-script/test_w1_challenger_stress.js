/**
 * Atlas Assistant — Wave 1 Adversarial Empirical Stress Test Suite
 * client-script/test_w1_challenger_stress.js
 *
 * Empirical Challenger Wave 1.1 Stress Harness:
 * Domain 1: Closed Shadow-DOM Isolation & Hostile CSS Stress
 *   - Light DOM closed encapsulation invariant (host.shadowRoot === null, querySelector null, attachShadow re-attach forbidden)
 *   - Extreme hostile CSS resets: * { all: unset !important; }
 *   - Extreme typography/bidi overrides: * { font-size: 50px !important; direction: rtl !important; line-height: 0 !important; }
 *   - Host parent destruction: #atlas-sidebar-host { display: none !important; width: 0 !important; }
 *   - Rapid dynamic style tag mutations & body direction flips
 * Domain 2: DOM Serializer Perception 0-Leak Invariant under Complex Layouts
 *   - Custom Web Components hosting open shadow roots
 *   - Deeply nested forms, tables, modals, and similarly named impostor elements
 *   - Strict assertion: ZERO Atlas sidebar nodes appear in serialized perceptions
 * Domain 3: Options Setup Wizard Resilience & Backend Failure Modes
 *   - Backend unreachable / connection aborted -> ✗ Unreachable, Next button disabled
 *   - Backend HTTP 500 Internal Server Error -> ⚠ Degraded, Next button disabled
 *   - Backend HTTP 503 Service Unavailable -> ⚠ Degraded, Next button disabled
 *   - Backend HTTP 200 OK -> ✓ Connected, Next button enabled
 *   - API Key format rejection (empty, missing "atlas_", < 10 chars) -> Next disabled
 *   - API Key auth failure (HTTP 401 Unauthorized) -> ✗ Invalid key, Next disabled
 *   - API Key network error -> ✗ Network error, Next disabled
 *   - API Key auth success (HTTP 200 OK) -> ✓ Valid key, Next enabled
 *   - Multi-step wizard progression through Step 3 (Preferences) and completion view
 * Domain 4: Confirmation Safeguard Protection
 *   - Clearing API key: confirm() dismissal preserves key; confirm() acceptance deletes key
 *   - Clearing vault secrets: confirm() dismissal prevents deletion; confirm() acceptance deletes
 *   - Clearing profile data: confirm() dismissal prevents deletion; confirm() acceptance deletes
 * Domain 5: Missing DOM Elements Resilience & Universal Rule Audit
 *   - Defensive degradation under stripped/missing DOM nodes
 *   - Zero domain / website-specific hardcoding in modified files
 *
 * Run with: node client-script/test_w1_challenger_stress.js
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

async function runWave1ChallengerStress() {
  console.log('\n===============================================================');
  console.log('   Atlas Assistant — Wave 1 Adversarial Empirical Stress Suite ');
  console.log('===============================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const clientDir = path.join(rootDir, 'client-script');
  const sidebarJs = fs.readFileSync(path.join(clientDir, 'sidebar.js'), 'utf8');
  const sidebarCss = fs.readFileSync(path.join(clientDir, 'sidebar.css'), 'utf8');
  const ttsJs = fs.readFileSync(path.join(clientDir, 'tts.js'), 'utf8');
  const serializerJs = fs.readFileSync(path.join(clientDir, 'dom-serializer.js'), 'utf8');
  const optionsHtmlPath = path.join(clientDir, 'options.html');
  const optionsJs = fs.readFileSync(path.join(clientDir, 'options.js'), 'utf8');

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

    // =========================================================================
    // DOMAIN 1: Closed Shadow-DOM Isolation & Hostile CSS Stress
    // =========================================================================
    console.log('[Domain 1: Closed Shadow-DOM Isolation & Hostile CSS Stress]');

    const page1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page1.setContent(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Atlas Isolation Stress Bed</title>
        <style id="atlas-sidebar-css">${sidebarCss}</style>
        <style>
          body { margin: 0; padding: 20px; font-family: sans-serif; background: #fafafa; }
          #host-button { padding: 10px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div id="host-content">
          <h1>Host Application</h1>
          <button id="host-button">Host Button</button>
        </div>
        <script>${ttsJs}</script>
        <script>${sidebarJs}</script>
        <script>
          window.AtlasSidebar.mount();
        </script>
      </body>
      </html>
    `);

    // Test 1.1: Light DOM Closed Mode Invariants
    const lightDomCheck = await page1.evaluate(() => {
      const host = document.getElementById('atlas-sidebar-host');
      const rootInLightDom = document.querySelector('#atlas-sidebar-root');
      const closeInLightDom = document.querySelector('.atlas-traffic-close');
      const inputInLightDom = document.querySelector('#atlas-chat-input');
      const titleInLightDom = document.querySelector('.atlas-title');
      const allAtlasInLight = Array.from(document.querySelectorAll("[class*='atlas-']"))
        .filter(el => el.id !== 'atlas-sidebar-host' && el.id !== 'atlas-sidebar-css');

      let reattachThrows = false;
      try {
        if (host) {
          host.attachShadow({ mode: 'open' });
        }
      } catch (err) {
        reattachThrows = err.name === 'NotSupportedError' || err.name === 'DOMException';
      }

      return {
        hostExists: host !== null,
        shadowRootIsNull: host ? host.shadowRoot === null : false,
        rootInLightDomNull: rootInLightDom === null,
        closeInLightDomNull: closeInLightDom === null,
        inputInLightDomNull: inputInLightDom === null,
        titleInLightDomNull: titleInLightDom === null,
        allAtlasInLightCount: allAtlasInLight.length,
        testHookAvailable: window.__atlasShadowRoot instanceof ShadowRoot,
        reattachThrows,
      };
    });

    record('SHD-ISO-01: #atlas-sidebar-host attaches closed ShadowRoot (host.shadowRoot === null)',
      lightDomCheck.hostExists && lightDomCheck.shadowRootIsNull);
    record('SHD-ISO-02: Light DOM querySelector yields strictly null for all internal sidebar nodes',
      lightDomCheck.rootInLightDomNull &&
      lightDomCheck.closeInLightDomNull &&
      lightDomCheck.inputInLightDomNull &&
      lightDomCheck.titleInLightDomNull &&
      lightDomCheck.allAtlasInLightCount === 0);
    record('SHD-ISO-03: Re-attaching shadow root on #atlas-sidebar-host throws NotSupportedError / DOMException',
      lightDomCheck.reattachThrows);

    // Test 1.2: Hostile Universal CSS Reset (* { all: unset !important; })
    const unsetCssCheck = await page1.evaluate(() => {
      const hostileStyle = document.createElement('style');
      hostileStyle.id = 'hostile-unset-style';
      hostileStyle.textContent = '* { all: unset !important; }';
      document.head.appendChild(hostileStyle);

      const shadow = window.__atlasShadowRoot;
      const root = shadow.getElementById('atlas-sidebar-root');
      const closeBtn = shadow.querySelector('.atlas-traffic-close');
      const title = shadow.querySelector('.atlas-title');

      const csRoot = window.getComputedStyle(root);
      const csClose = window.getComputedStyle(closeBtn);
      const csTitle = window.getComputedStyle(title);

      const res = {
        rootDisplay: csRoot.display,
        rootPosition: csRoot.position,
        rootZIndex: csRoot.zIndex,
        rootBorderRadius: csRoot.borderRadius,
        closeDisplay: csClose.display,
        closeWidth: csClose.width,
        closeHeight: csClose.height,
        titleDisplay: csTitle.display,
      };

      hostileStyle.remove();
      return res;
    });

    record('SHD-CSS-01: Computed styles immune to hostile * { all: unset !important; }',
      unsetCssCheck.rootDisplay === 'flex' &&
      unsetCssCheck.rootPosition === 'fixed' &&
      unsetCssCheck.rootZIndex === '2147483647' &&
      unsetCssCheck.rootBorderRadius === '16px' &&
      (unsetCssCheck.closeWidth === '44px' || unsetCssCheck.closeWidth === '32px') &&
      (unsetCssCheck.closeHeight === '44px' || unsetCssCheck.closeHeight === '32px'),
      `Got: display=${unsetCssCheck.rootDisplay}, pos=${unsetCssCheck.rootPosition}, zIndex=${unsetCssCheck.rootZIndex}, close=${unsetCssCheck.closeWidth}x${unsetCssCheck.closeHeight}`);

    // Test 1.3: Hostile Typography & RTL Direction Injection (* { font-size: 50px !important; direction: rtl !important; line-height: 0 !important; color: rgb(255, 0, 0) !important; letter-spacing: 20px !important; })
    const hostileTypoCheck = await page1.evaluate(() => {
      const hostileStyle = document.createElement('style');
      hostileStyle.id = 'hostile-typo-style';
      hostileStyle.textContent = `
        * {
          font-size: 50px !important;
          direction: rtl !important;
          line-height: 0 !important;
          color: rgb(255, 0, 0) !important;
          letter-spacing: 20px !important;
        }
      `;
      document.head.appendChild(hostileStyle);

      const shadow = window.__atlasShadowRoot;
      const root = shadow.getElementById('atlas-sidebar-root');
      const title = shadow.querySelector('.atlas-title');
      const closeBtn = shadow.querySelector('.atlas-traffic-close');
      const input = shadow.querySelector('.atlas-chat-input');

      const csRoot = window.getComputedStyle(root);
      const csTitle = window.getComputedStyle(title);
      const csClose = window.getComputedStyle(closeBtn);
      const csInput = window.getComputedStyle(input);

      const res = {
        rootDirection: csRoot.direction,
        rootFontSize: csRoot.fontSize,
        rootLineHeight: csRoot.lineHeight,
        rootLetterSpacing: csRoot.letterSpacing,
        titleFontSize: csTitle.fontSize,
        titleDirection: csTitle.direction,
        closeWidth: csClose.width,
        closeHeight: csClose.height,
        inputFontSize: csInput.fontSize,
      };

      hostileStyle.remove();
      return res;
    });

    const parsedLineHeight = parseFloat(hostileTypoCheck.rootLineHeight);
    record('SHD-CSS-02: Direction and typography immune to hostile * { font-size: 50px !important; direction: rtl !important; line-height: 0 !important; }',
      hostileTypoCheck.rootDirection === 'ltr' &&
      (hostileTypoCheck.rootFontSize === '16px' || hostileTypoCheck.rootFontSize === '13px') &&
      parsedLineHeight > 10 &&
      (hostileTypoCheck.rootLetterSpacing === 'normal' || hostileTypoCheck.rootLetterSpacing === '0px') &&
      (hostileTypoCheck.titleFontSize === '17px' || hostileTypoCheck.titleFontSize === '16px' || hostileTypoCheck.titleFontSize === '13px') &&
      hostileTypoCheck.titleDirection === 'ltr',
      `Got: dir=${hostileTypoCheck.rootDirection}, font=${hostileTypoCheck.rootFontSize}, lh=${hostileTypoCheck.rootLineHeight}, ls=${hostileTypoCheck.rootLetterSpacing}`);

    record('SHD-CSS-03: Close button touch target dimensions preserved under extreme hostile typography',
      (hostileTypoCheck.closeWidth === '44px' || hostileTypoCheck.closeWidth === '32px') &&
      (hostileTypoCheck.closeHeight === '44px' || hostileTypoCheck.closeHeight === '32px'),
      `Got: ${hostileTypoCheck.closeWidth} x ${hostileTypoCheck.closeHeight}`);

    // Test 1.4: Host Element Parent Destruction & Inline Specificity Defense
    const hostileHostCheck = await page1.evaluate(() => {
      const hostileStyle = document.createElement('style');
      hostileStyle.id = 'hostile-host-style';
      hostileStyle.textContent = `
        #atlas-sidebar-host {
          display: none !important;
          width: 9999px !important;
          height: 9999px !important;
          margin: 500px !important;
          transform: scale(0) !important;
          visibility: hidden !important;
        }
      `;
      document.head.appendChild(hostileStyle);

      const host = document.getElementById('atlas-sidebar-host');
      const shadow = window.__atlasShadowRoot;
      const root = shadow.getElementById('atlas-sidebar-root');

      const csHost = window.getComputedStyle(host);
      const csRoot = window.getComputedStyle(root);

      const res = {
        // Author inline styles with !important take precedence over stylesheet !important
        hostDisplay: csHost.display,
        hostWidth: csHost.width,
        rootDisplay: csRoot.display,
        rootVisibility: csRoot.visibility,
        rootWidth: csRoot.width,
        rootHeight: csRoot.height,
      };

      hostileStyle.remove();
      return res;
    });

    record('SHD-CSS-04: Host element inline !important reset preserves structural presence and shadow root rendering',
      hostileHostCheck.hostDisplay === 'block' &&
      hostileHostCheck.hostWidth === '0px' &&
      hostileHostCheck.rootDisplay === 'flex' &&
      hostileHostCheck.rootVisibility === 'visible' &&
      hostileHostCheck.rootWidth === '348px' &&
      hostileHostCheck.rootHeight === '520px',
      `Got: hostDisplay=${hostileHostCheck.hostDisplay}, rootDisplay=${hostileHostCheck.rootDisplay}, rootVisibility=${hostileHostCheck.rootVisibility}`);

    // Test 1.5: Dynamic Style Mutations and Body Direction Flips
    const dynamicMutationCheck = await page1.evaluate(() => {
      const shadow = window.__atlasShadowRoot;
      const root = shadow.getElementById('atlas-sidebar-root');
      const initialDirection = window.getComputedStyle(root).direction;
      const initialFontSize = window.getComputedStyle(root).fontSize;

      // Inject 10 dynamic style tags rapidly with hostile rules
      const addedStyles = [];
      for (let i = 0; i < 10; i++) {
        const s = document.createElement('style');
        s.textContent = `
          body { direction: rtl !important; font-size: ${40 + i * 5}px !important; }
          div { box-sizing: content-box !important; }
          * { zoom: ${1 + i * 0.1} !important; }
        `;
        document.head.appendChild(s);
        addedStyles.push(s);
      }
      document.body.dir = 'rtl';
      document.documentElement.dir = 'rtl';

      const postMutationDirection = window.getComputedStyle(root).direction;
      const postMutationFontSize = window.getComputedStyle(root).fontSize;

      // Clean up
      addedStyles.forEach(s => s.remove());
      document.body.dir = 'ltr';
      document.documentElement.dir = 'ltr';

      return {
        initialDirection,
        initialFontSize,
        postMutationDirection,
        postMutationFontSize,
      };
    });

    record('SHD-CSS-05: Sidebar styles remain invariant under 10 rapid dynamic hostile style mutations and body RTL flips',
      dynamicMutationCheck.initialDirection === 'ltr' &&
      dynamicMutationCheck.postMutationDirection === 'ltr' &&
      (dynamicMutationCheck.initialFontSize === '16px' || dynamicMutationCheck.initialFontSize === '13px') &&
      (dynamicMutationCheck.postMutationFontSize === '16px' || dynamicMutationCheck.postMutationFontSize === '13px'),
      `Got: dir=${dynamicMutationCheck.postMutationDirection}, font=${dynamicMutationCheck.postMutationFontSize}`);

    await page1.close();

    // =========================================================================
    // DOMAIN 2: DOM Serializer Perception 0-Leak Invariant under Complex Layouts
    // =========================================================================
    console.log('\n[Domain 2: DOM Serializer Perception 0-Leak Invariant under Complex Layouts]');

    const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page2.setContent(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Complex Host Page for Perception Stress</title>
        <style id="atlas-sidebar-css">${sidebarCss}</style>
      </head>
      <body>
        <!-- 1. Complex Form with diverse inputs -->
        <form id="checkout-form" action="/pay">
          <h2>Billing Information</h2>
          <label for="user-name">Full Name</label>
          <input id="user-name" type="text" placeholder="Jane Doe" required />

          <label for="user-email">Email Address</label>
          <input id="user-email" type="email" placeholder="jane@example.com" />

          <label for="subscribe-check">
            <input id="subscribe-check" type="checkbox" checked /> Subscribe to newsletters
          </label>

          <button id="submit-checkout-btn" type="submit">Submit Order ($99.00)</button>
        </form>

        <!-- 2. Web Component with Open Shadow Root -->
        <div id="web-component-host"></div>

        <!-- 3. Table with data and action buttons -->
        <table id="data-table">
          <thead>
            <tr><th>Invoice #</th><th>Amount</th><th>Action</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>INV-2026-001</td>
              <td>$450.00</td>
              <td><button id="download-inv-btn" aria-label="Download Invoice INV-2026-001">Download</button></td>
            </tr>
          </tbody>
        </table>

        <!-- 4. Impostor Elements with similar IDs/classes -->
        <div id="atlas-sidebar-host-impostor">
          <button id="impostor-button" class="atlas-style-button">Legitimate Host Button With Atlas Class</button>
        </div>
        <input id="impostor-search" placeholder="Search Atlas Documentation" aria-label="Search Atlas Documentation" />

        <!-- 5. Active Modal Dialog -->
        <dialog id="cookie-dialog" open>
          <p>We use essential cookies.</p>
          <button id="dialog-accept-btn">Accept Cookies</button>
        </dialog>

        <script>${ttsJs}</script>
        <script>${serializerJs}</script>
        <script>${sidebarJs}</script>
        <script>
          window.AtlasSidebar.mount();
        </script>
      </body>
      </html>
    `);

    // Define Web Component with open shadow root in host page
    await page2.evaluate(() => {
      const compHost = document.getElementById('web-component-host');
      const openShadow = compHost.attachShadow({ mode: 'open' });
      openShadow.innerHTML = `
        <div class="card">
          <h3>Custom Card Web Component (Open Shadow Root)</h3>
          <button id="component-action-btn" aria-label="Trigger Card Action">Card Action Button</button>
          <input id="component-input" type="text" placeholder="Component notes" />
          <a id="component-link" href="#details">Learn More</a>
        </div>
      `;

      // Add dummy elements and chat messages to Atlas sidebar
      if (window.AtlasSidebar && window.AtlasSidebar.setItems) {
        window.AtlasSidebar.setItems([
          { id: 'atlas_el_1', tag: 'button', resolved_label: 'Files & Folders Item', inner_text: 'Report.pdf', role: 'row' },
          { id: 'atlas_el_2', tag: 'input', resolved_label: 'Search Field', placeholder: 'Find in page...', role: 'searchbox' },
        ]);
        window.AtlasSidebar.addChatMessage('user', 'Hello Atlas, summarize this document');
        window.AtlasSidebar.addChatMessage('agent', 'Analyzing page structure and open documents...');
      }
    });

    const serializationCheck = await page2.evaluate(() => {
      if (!window.AtlasSerializer || typeof window.AtlasSerializer.serialize !== 'function') {
        return { error: 'AtlasSerializer.serialize not available' };
      }

      // Close the dialog so full page interactive elements are collected
      const dialog = document.getElementById('cookie-dialog');
      if (dialog) dialog.close();

      const serialized = window.AtlasSerializer.serialize();
      const shadow = window.__atlasShadowRoot;

      // Check for host page interactive elements
      const hasCheckoutSubmit = serialized.some(n => n.id?.includes('submit-checkout-btn') || n.inner_text?.includes('Submit Order'));
      const hasComponentBtn = serialized.some(n => n.aria_label === 'Trigger Card Action' || n.inner_text?.includes('Card Action Button'));
      const hasImpostorBtn = serialized.some(n => n.inner_text?.includes('Legitimate Host Button With Atlas Class'));

      // Check for LEAKED Atlas sidebar elements
      const leakedNodes = [];
      for (const node of serialized) {
        // Direct ID check
        if (node.id === 'atlas-sidebar-host' || node.id === 'atlas-sidebar-root') {
          leakedNodes.push({ reason: 'Direct ID match', node });
          continue;
        }

        // Internal sidebar strings
        const text = (node.inner_text || '').toLowerCase();
        const label = (node.resolved_label || node.aria_label || '').toLowerCase();
        const placeholder = (node.placeholder || '').toLowerCase();

        if (text === '✕' || label.includes('close atlas window') || label.includes('atlas accessibility assistant')) {
          leakedNodes.push({ reason: 'Sidebar UI text leak', node });
          continue;
        }

        if (text.includes('files & folders') || text.includes('actions & create') || placeholder.includes('type instructions')) {
          leakedNodes.push({ reason: 'Sidebar panel text leak', node });
          continue;
        }

        // Shadow root containment check
        if (shadow && shadow.contains) {
          const matchingDomEl = document.querySelector(`[data-atlas-id="${node.id}"]`);
          if (!matchingDomEl && shadow.querySelector) {
            const inShadow = shadow.querySelector(`[data-atlas-id="${node.id}"]`);
            if (inShadow) {
              leakedNodes.push({ reason: 'DOM element physically lives inside sidebar shadow root', node });
            }
          }
        }
      }

      return {
        totalSerialized: serialized.length,
        hasCheckoutSubmit,
        hasComponentBtn,
        hasImpostorBtn,
        leakedCount: leakedNodes.length,
        leakedNodes,
      };
    });

    record('SER-LEAK-01: AtlasSerializer successfully serializes host elements (including open Web Components)',
      serializationCheck.totalSerialized > 0 &&
      serializationCheck.hasCheckoutSubmit &&
      serializationCheck.hasComponentBtn,
      `totalSerialized=${serializationCheck.totalSerialized}, hasCheckout=${serializationCheck.hasCheckoutSubmit}, hasCompBtn=${serializationCheck.hasComponentBtn}`);

    record('SER-LEAK-02: Impostor host elements with "atlas" strings are correctly preserved for agent actions',
      serializationCheck.hasImpostorBtn);

    record('SER-LEAK-03: STRICT INVARIANT: Exactly 0 Atlas sidebar nodes appear in serialized perceptions',
      serializationCheck.leakedCount === 0,
      `Leaked nodes found (${serializationCheck.leakedCount}): ${JSON.stringify(serializationCheck.leakedNodes)}`);

    await page2.close();

    // =========================================================================
    // DOMAIN 3: Options Setup Wizard Resilience & Backend Failure Modes
    // =========================================================================
    console.log('\n[Domain 3: Options Setup Wizard Resilience & Backend Failure Modes]');

    const page3 = await browser.newPage({ viewport: { width: 1024, height: 768 } });

    // Install mock chrome.storage.local before loading options.html
    await page3.addInitScript(() => {
      window.__mockStorage = {};
      window.chrome = {
        storage: {
          local: {
            get: (keys, cb) => {
              const res = {};
              if (!keys) {
                Object.assign(res, window.__mockStorage);
              } else if (Array.isArray(keys)) {
                keys.forEach(k => res[k] = window.__mockStorage[k]);
              } else if (typeof keys === 'string') {
                res[keys] = window.__mockStorage[keys];
              }
              if (cb) cb(res);
              return Promise.resolve(res);
            },
            set: (items, cb) => {
              Object.assign(window.__mockStorage, items);
              if (cb) cb();
              return Promise.resolve();
            },
            remove: (keys, cb) => {
              const arr = Array.isArray(keys) ? keys : [keys];
              arr.forEach(k => delete window.__mockStorage[k]);
              if (cb) cb();
              return Promise.resolve();
            },
          },
        },
        runtime: {
          getURL: (p) => p,
        },
      };
    });

    await page3.goto('file://' + optionsHtmlPath);

    // Test 3.1: First-Run Wizard Auto-Display
    const wizardDisplayCheck = await page3.evaluate(() => {
      const wizardContainer = document.getElementById('atlas-wizard-container');
      const standardSettings = document.getElementById('atlas-standard-settings');
      const step1Pane = document.getElementById('wizard-step-1');
      const stepInd1 = document.getElementById('step-ind-1');

      return {
        wizardVisible: wizardContainer && window.getComputedStyle(wizardContainer).display !== 'none',
        standardHidden: standardSettings && window.getComputedStyle(standardSettings).display === 'none',
        step1Visible: step1Pane && window.getComputedStyle(step1Pane).display !== 'none',
        stepInd1Active: stepInd1 && stepInd1.classList.contains('atlas-step-active'),
      };
    });

    record('WIZ-FR-01: First run auto-displays setup wizard container and activates Step 1 indicator',
      wizardDisplayCheck.wizardVisible &&
      wizardDisplayCheck.standardHidden &&
      wizardDisplayCheck.step1Visible &&
      wizardDisplayCheck.stepInd1Active);

    // Test 3.2: Step 1 Backend Failure — Unreachable / Offline
    await page3.route('**/health', route => route.abort('failed'));
    await page3.click('#wizard-test-backend-btn');
    await page3.waitForTimeout(100);

    const unreachableCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-backend-status');
      const nextBtn = document.getElementById('wizard-step1-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-ERR-01: Backend unreachable/offline flags ✗ Unreachable and disables Next button',
      unreachableCheck.hasErrorClass &&
      unreachableCheck.text.includes('✗ Unreachable') &&
      unreachableCheck.nextDisabled === true,
      `text: "${unreachableCheck.text}", nextDisabled: ${unreachableCheck.nextDisabled}`);

    // Test 3.3: Step 1 Backend Failure — HTTP 500 Internal Server Error
    await page3.unroute('**/health');
    await page3.route('**/health', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal Server Error' }),
      });
    });
    await page3.click('#wizard-test-backend-btn');
    await page3.waitForTimeout(100);

    const http500Check = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-backend-status');
      const nextBtn = document.getElementById('wizard-step1-next');
      return {
        hasWarnClass: statusEl.classList.contains('atlas-status-warn'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-ERR-02: Backend HTTP 500 flags ⚠ Degraded: HTTP 500 and disables Next button',
      http500Check.hasWarnClass &&
      http500Check.text.includes('HTTP 500') &&
      http500Check.nextDisabled === true,
      `text: "${http500Check.text}", nextDisabled: ${http500Check.nextDisabled}`);

    // Test 3.4: Step 1 Backend Failure — HTTP 503 Service Unavailable
    await page3.unroute('**/health');
    await page3.route('**/health', route => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Service Unavailable' }),
      });
    });
    await page3.click('#wizard-test-backend-btn');
    await page3.waitForTimeout(100);

    const http503Check = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-backend-status');
      const nextBtn = document.getElementById('wizard-step1-next');
      return {
        hasWarnClass: statusEl.classList.contains('atlas-status-warn'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-ERR-03: Backend HTTP 503 flags ⚠ Degraded: HTTP 503 and disables Next button',
      http503Check.hasWarnClass &&
      http503Check.text.includes('HTTP 503') &&
      http503Check.nextDisabled === true,
      `text: "${http503Check.text}", nextDisabled: ${http503Check.nextDisabled}`);

    // Test 3.5: Step 1 Backend Success — HTTP 200 OK
    await page3.unroute('**/health');
    await page3.route('**/health', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', version: '0.1.0', db: 'ok', llm: 'mock' }),
      });
    });
    await page3.click('#wizard-test-backend-btn');
    await page3.waitForTimeout(100);

    const http200Check = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-backend-status');
      const nextBtn = document.getElementById('wizard-step1-next');
      return {
        hasOkClass: statusEl.classList.contains('atlas-status-ok'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-OK-01: Backend HTTP 200 OK flags ✓ Connected and enables Next button',
      http200Check.hasOkClass &&
      http200Check.text.includes('✓ Connected') &&
      http200Check.nextDisabled === false,
      `text: "${http200Check.text}", nextDisabled: ${http200Check.nextDisabled}`);

    // Advance to Step 2
    await page3.click('#wizard-step1-next');
    await page3.waitForTimeout(50);

    // Test 3.6: Step 2 Validation — Empty API Key
    await page3.fill('#wizard-api-key', '');
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(50);

    const emptyKeyCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-01: Empty API key rejected by format guard and blocks advancement',
      emptyKeyCheck.hasErrorClass &&
      emptyKeyCheck.text.includes('Invalid key format') &&
      emptyKeyCheck.nextDisabled === true);

    // Test 3.7: Step 2 Validation — Invalid Prefix (e.g. sk_live_...)
    await page3.fill('#wizard-api-key', 'sk_live_1234567890abcdef');
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(50);

    const badPrefixCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-02: Non-atlas_ prefix rejected with descriptive requirement message',
      badPrefixCheck.hasErrorClass &&
      badPrefixCheck.text.includes("must begin with 'atlas_'") &&
      badPrefixCheck.nextDisabled === true);

    // Test 3.8: Step 2 Validation — Short Key (<10 chars)
    await page3.fill('#wizard-api-key', 'atlas_123');
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(50);

    const shortKeyCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-03: Key shorter than 10 characters rejected by format validator',
      shortKeyCheck.hasErrorClass &&
      shortKeyCheck.nextDisabled === true);

    // Test 3.9: Step 2 Validation — Backend Auth Rejection (HTTP 401 Unauthorized)
    await page3.route('**/v1/session/start', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Invalid API key or authentication failed' }),
      });
    });
    await page3.fill('#wizard-api-key', 'atlas_invalid_key_999999');
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(100);

    const auth401Check = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-04: HTTP 401 Unauthorized from /v1/session/start flags rejected key and blocks advancement',
      auth401Check.hasErrorClass &&
      auth401Check.text.includes('rejected by backend authentication (HTTP 401)') &&
      auth401Check.nextDisabled === true,
      `text: "${auth401Check.text}", nextDisabled: ${auth401Check.nextDisabled}`);

    // Test 3.10: Step 2 Validation — Network Error during Auth
    await page3.unroute('**/v1/session/start');
    await page3.route('**/v1/session/start', route => route.abort('failed'));
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(100);

    const netErrCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasErrorClass: statusEl.classList.contains('atlas-status-error'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-05: Network failure during key authentication flags ✗ Network error gracefully',
      netErrCheck.hasErrorClass &&
      netErrCheck.text.includes('✗ Network error') &&
      netErrCheck.nextDisabled === true);

    // Test 3.11: Step 2 Validation — Valid Key Authenticated (HTTP 200 OK)
    await page3.unroute('**/v1/session/start');
    await page3.route('**/v1/session/start', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_id: 'sess_wave1_test_ok', status: 'authenticated' }),
      });
    });
    await page3.fill('#wizard-api-key', 'atlas_tenant_valid_key_12345');
    await page3.click('#wizard-validate-key-btn');
    await page3.waitForTimeout(100);

    const validKeyCheck = await page3.evaluate(() => {
      const statusEl = document.getElementById('wizard-key-status');
      const nextBtn = document.getElementById('wizard-step2-next');
      return {
        hasOkClass: statusEl.classList.contains('atlas-status-ok'),
        text: statusEl.textContent,
        nextDisabled: nextBtn.disabled,
      };
    });

    record('WIZ-KEY-06: Valid API key returns ✓ Valid API key and unlocks Step 2 advancement',
      validKeyCheck.hasOkClass &&
      validKeyCheck.text.includes('✓ Valid API key') &&
      validKeyCheck.nextDisabled === false);

    // Advance to Step 3
    await page3.click('#wizard-step2-next');
    await page3.waitForTimeout(50);

    // Test 3.12: Step 3 Preference Selection & Completion Flow
    const step3Check = await page3.evaluate(() => {
      const step3Pane = document.getElementById('wizard-step-3');
      const ttsStatus = document.getElementById('wizard-tts-status');
      return {
        step3Visible: step3Pane && window.getComputedStyle(step3Pane).display !== 'none',
        hasTtsStatus: ttsStatus && ttsStatus.textContent.length > 0,
      };
    });

    record('WIZ-ST3-01: Step 3 Preference pane renders with bilingual voice diagnostic',
      step3Check.step3Visible && step3Check.hasTtsStatus);

    // Select Arabic language and complete wizard
    await page3.click('#wizard-lang-ar');
    await page3.click('#wizard-complete-btn');
    await page3.waitForTimeout(100);

    const completionCheck = await page3.evaluate(() => {
      const completeView = document.getElementById('wizard-complete-view');
      const summaryBox = document.getElementById('wizard-summary-box');
      const stored = window.__mockStorage;
      return {
        completeVisible: completeView && window.getComputedStyle(completeView).display !== 'none',
        summaryHasBackend: summaryBox && summaryBox.textContent.includes('http://localhost:8000'),
        summaryHasKey: summaryBox && summaryBox.textContent.includes('atlas_te••••'),
        summaryHasLang: summaryBox && summaryBox.textContent.includes('Arabic (ar-EG)'),
        storedKey: stored.atlasApiKey,
        storedUrl: stored.atlasBaseUrl,
        storedLang: stored.atlas_voice_lang,
        storedCompleted: stored.atlas_wizard_completed,
      };
    });

    record('WIZ-FIN-01: Completing wizard persists verified credentials and preferences to chrome.storage.local',
      completionCheck.completeVisible &&
      completionCheck.summaryHasKey &&
      completionCheck.storedKey === 'atlas_tenant_valid_key_12345' &&
      completionCheck.storedUrl === 'http://localhost:8000' &&
      completionCheck.storedLang === 'ar-EG' &&
      completionCheck.storedCompleted === true,
      `stored: key=${completionCheck.storedKey}, lang=${completionCheck.storedLang}, completed=${completionCheck.storedCompleted}`);

    // Click Finish to return to standard settings
    await page3.click('#wizard-finish-btn');
    await page3.waitForTimeout(50);

    const finishDismissCheck = await page3.evaluate(() => {
      const wizardContainer = document.getElementById('atlas-wizard-container');
      const standardSettings = document.getElementById('atlas-standard-settings');
      const apiKeyInput = document.getElementById('api-key');
      const baseUrlInput = document.getElementById('base-url');

      return {
        wizardHidden: wizardContainer && window.getComputedStyle(wizardContainer).display === 'none',
        standardVisible: standardSettings && window.getComputedStyle(standardSettings).display !== 'none',
        apiKeyPopulated: apiKeyInput && apiKeyInput.value === 'atlas_tenant_valid_key_12345',
        baseUrlPopulated: baseUrlInput && baseUrlInput.value === 'http://localhost:8000',
      };
    });

    record('WIZ-FIN-02: Finishing wizard transitions cleanly to standard settings populated with saved settings',
      finishDismissCheck.wizardHidden &&
      finishDismissCheck.standardVisible &&
      finishDismissCheck.apiKeyPopulated &&
      finishDismissCheck.baseUrlPopulated);

    // =========================================================================
    // DOMAIN 4: Confirmation Safeguard Protection
    // =========================================================================
    console.log('\n[Domain 4: Confirmation Safeguard Protection]');

    // Test 4.1: API Key Clear Safeguard — User Dismisses Confirm Dialog
    let dialogMessageSeen = null;
    page3.once('dialog', async dialog => {
      dialogMessageSeen = dialog.message();
      await dialog.dismiss();
    });

    await page3.click('#clear-btn');
    await page3.waitForTimeout(50);

    const dismissApiKeyCheck = await page3.evaluate(() => {
      return {
        keyInStorage: window.__mockStorage.atlasApiKey,
        keyInInput: document.getElementById('api-key').value,
      };
    });

    record('SAFE-KEY-01: Dismissing confirm() dialog preserves stored API key and input field',
      dialogMessageSeen && dialogMessageSeen.includes('clear your stored Atlas API key') &&
      dismissApiKeyCheck.keyInStorage === 'atlas_tenant_valid_key_12345' &&
      dismissApiKeyCheck.keyInInput === 'atlas_tenant_valid_key_12345',
      `Dialog msg: "${dialogMessageSeen}", stored: "${dismissApiKeyCheck.keyInStorage}"`);

    // Test 4.2: API Key Clear Safeguard — User Accepts Confirm Dialog
    page3.once('dialog', async dialog => {
      await dialog.accept();
    });

    await page3.click('#clear-btn');
    await page3.waitForTimeout(50);

    const acceptApiKeyCheck = await page3.evaluate(() => {
      return {
        keyInStorage: window.__mockStorage.atlasApiKey,
        keyInInput: document.getElementById('api-key').value,
      };
    });

    record('SAFE-KEY-02: Accepting confirm() dialog executes safe purge of API key from storage and UI',
      acceptApiKeyCheck.keyInStorage === undefined &&
      acceptApiKeyCheck.keyInInput === '',
      `stored: "${acceptApiKeyCheck.keyInStorage}", input: "${acceptApiKeyCheck.keyInInput}"`);

    // Test 4.3: Clear All Secrets Safeguard (Dismiss vs Accept)
    await page3.evaluate(async () => {
      window.__secretClearAllCalled = false;
      window.__profileClearCalled = false;

      window.AtlasSecretVault = {
        listEntries: async () => [
          { origin: 'https://demo.bank.com', token: '{bank.token}', category: 'session', createdAt: Date.now() },
        ],
        clearAll: async () => { window.__secretClearAllCalled = true; },
        getProfile: async () => ({ email: 'test@example.com' }),
        clearProfile: async () => { window.__profileClearCalled = true; },
        clearOrigin: async () => {},
      };

      const btn = document.getElementById('clear-all-secrets-btn');
      if (btn) btn.style.display = 'inline-block';
    });

    // Test clear-all-secrets button with dialog dismissal
    page3.once('dialog', async dialog => {
      await dialog.dismiss();
    });
    await page3.click('#clear-all-secrets-btn');
    await page3.waitForTimeout(50);

    const secretDismissCheck = await page3.evaluate(() => window.__secretClearAllCalled);
    record('SAFE-SEC-01: Dismissing confirm() dialog prevents execution of vault.clearAll()',
      secretDismissCheck === false);

    // Test clear-all-secrets button with dialog acceptance
    page3.once('dialog', async dialog => {
      await dialog.accept();
    });
    await page3.click('#clear-all-secrets-btn');
    await page3.waitForTimeout(50);

    const secretAcceptCheck = await page3.evaluate(() => window.__secretClearAllCalled);
    record('SAFE-SEC-02: Accepting confirm() dialog executes vault.clearAll()',
      secretAcceptCheck === true);

    // Test 4.4: Clear Profile Safeguard (Dismiss vs Accept)
    // Test clear-profile button with dialog dismissal
    page3.once('dialog', async dialog => {
      await dialog.dismiss();
    });
    await page3.click('#clear-profile-btn');
    await page3.waitForTimeout(50);

    const profileDismissCheck = await page3.evaluate(() => window.__profileClearCalled);
    record('SAFE-PRF-01: Dismissing confirm() dialog prevents execution of vault.clearProfile()',
      profileDismissCheck === false);

    // Test clear-profile button with dialog acceptance
    page3.once('dialog', async dialog => {
      await dialog.accept();
    });
    await page3.click('#clear-profile-btn');
    await page3.waitForTimeout(50);

    const profileAcceptCheck = await page3.evaluate(() => window.__profileClearCalled);
    record('SAFE-PRF-02: Accepting confirm() dialog executes vault.clearProfile()',
      profileAcceptCheck === true);

    await page3.close();

    // =========================================================================
    // DOMAIN 5: Missing DOM Elements Resilience & Universal Rule Audit
    // =========================================================================
    console.log('\n[Domain 5: Missing DOM Elements Resilience & Universal Rule Audit]');

    const page4 = await browser.newPage({ viewport: { width: 800, height: 600 } });

    // Load stripped / foreign HTML page missing wizard and options containers
    await page4.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Stripped Environment</title></head>
      <body>
        <div id="unrelated-page">No Atlas DOM elements present</div>
        <script>
          // Empty chrome storage shim
          window.chrome = { storage: { local: { get: (k, cb) => cb({}), set: (i, cb) => cb && cb() } } };
        </script>
        <script>${optionsJs}</script>
      </body>
      </html>
    `);

    const missingDomResilienceCheck = await page4.evaluate(() => {
      // Execute exported functions in absent DOM environment
      let initWizardThrows = false;
      let loadThrows = false;
      let renderSecretsThrows = false;
      let renderProfileThrows = false;

      try {
        if (typeof initWizard === 'function') initWizard();
      } catch (e) {
        initWizardThrows = e.message;
      }

      try {
        if (typeof load === 'function') load();
      } catch (e) {
        loadThrows = e.message;
      }

      try {
        if (typeof renderSecrets === 'function') renderSecrets();
      } catch (e) {
        renderSecretsThrows = e.message;
      }

      try {
        if (typeof renderProfile === 'function') renderProfile();
      } catch (e) {
        renderProfileThrows = e.message;
      }

      return {
        initWizardThrows,
        loadThrows,
        renderSecretsThrows,
        renderProfileThrows,
      };
    });

    record('DEF-DOM-01: initWizard() degrades safely when #atlas-wizard-container is absent from DOM',
      missingDomResilienceCheck.initWizardThrows === false,
      `Error: ${missingDomResilienceCheck.initWizardThrows}`);

    record('DEF-DOM-02: renderSecrets() degrades safely when #secrets-container is absent from DOM',
      missingDomResilienceCheck.renderSecretsThrows === false,
      `Error: ${missingDomResilienceCheck.renderSecretsThrows}`);

    record('DEF-DOM-03: renderProfile() degrades safely when #atlas-profile-form is absent from DOM',
      missingDomResilienceCheck.renderProfileThrows === false,
      `Error: ${missingDomResilienceCheck.renderProfileThrows}`);

    // Note empirical finding on setStatus:
    empiricalFindings.push({
      component: 'options.js: setStatus',
      type: 'Defensive Observation',
      detail: 'In options.js line 17, setStatus() assumes statusEl (#atlas-status) is always present. While options.html contains this element, if foreign wrappers omit #atlas-status, calling setStatus directly throws TypeError. Recommended future refinement: add if (!statusEl) return; to setStatus().',
    });

    await page4.close();
    await browser.close();

    // Test 5.2: Universal Rule Compliance (Zero Domain/Site Hardcoding)
    const filesToAudit = [
      path.join(clientDir, 'sidebar.js'),
      path.join(clientDir, 'sidebar.css'),
      path.join(clientDir, 'dom-serializer.js'),
      path.join(clientDir, 'options.html'),
      path.join(clientDir, 'options.js'),
    ];

    const forbiddenDomains = [
      'google.com',
      'drive.google',
      'amazon.com',
      'github.com',
      'facebook.com',
      'twitter.com',
      'salesforce.com',
    ];

    let foundDomainViolations = [];
    for (const file of filesToAudit) {
      const content = fs.readFileSync(file, 'utf8');
      for (const domain of forbiddenDomains) {
        if (content.toLowerCase().includes(domain)) {
          foundDomainViolations.push(`${path.basename(file)}: contains "${domain}"`);
        }
      }
    }

    record('UNI-AUD-01: Wave 1 client scripts contain strictly 0 domain or website-specific hardcodings',
      foundDomainViolations.length === 0,
      `Violations found: ${foundDomainViolations.join('; ')}`);

    console.log('\n===============================================================');
    console.log(`Wave 1 Challenger Stress Tests Complete: ${passed} passed, ${failed} failed.`);
    console.log('===============================================================\n');

    if (empiricalFindings.length > 0) {
      console.log('CHALLENGER EMPIRICAL FINDINGS:');
      empiricalFindings.forEach((f, i) => {
        console.log(` ${i + 1}. [${f.type}] ${f.component}: ${f.detail}`);
      });
      console.log('');
    }

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Test Harness Exception:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runWave1ChallengerStress();

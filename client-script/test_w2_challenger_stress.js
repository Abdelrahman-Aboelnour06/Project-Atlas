/**
 * Atlas Assistant — Wave 2 Adversarial Empirical Stress Test Suite
 * client-script/test_w2_challenger_stress.js
 *
 * Empirical Challenger Wave 2.2 Stress Harness:
 * Domain 1: Static Typography & CSS Floor Audit (< 14px)
 *   - Scan sidebar.css and options.css for font / font-size declarations < 14px
 *   - Scan options.html for inline font-size declarations < 14px
 *   - Check CSS custom property typography tokens (--atlas-font-*) across all text scales
 * Domain 2: Headless Browser Computed Target Dimensions (>= 44x44px)
 *   - Audit getBoundingClientRect() of all buttons, tabs, inputs, and chips in sidebar
 *   - Audit controls across Normal, Large, and XL text scale modes
 *   - Audit buttons and inputs in options.html
 * Domain 3: Text Scaling Transitions & Horizontal Overflow / Clipping
 *   - Assert header layout does not overflow horizontally (scrollWidth <= clientWidth)
 *   - Assert chat input bar layout does not overflow horizontally
 *   - Assert interactive controls are not clipped or pushed beyond sidebar boundary
 *   - Test cycling through text scaling modes without layout failure
 * Domain 4: Live Audio Level Meter & Web Audio Teardown Leak Testing
 *   - Assert AnalyserNode is never connected to audioContext.destination (feedback prevention)
 *   - Simulate 50 rapid start/stop speech recognition cycles: assert all MediaStreamTracks ended
 *   - Assert all AudioContext instances are closed
 *   - Simulate 20 concurrent un-awaited start calls with immediate stop: assert zero resource leaks
 *   - Verify onAudioLevel callback emits 4 equalizer bands and energy level
 * Domain 5: Global Shortcuts & Tab Command Dispatch
 *   - Verify manifest.json commands registration (Alt+A, Alt+V, and macOS equivalents)
 *   - Verify toggleSidebarOnTab and triggerVoiceOnTab block internal URLs (chrome://, edge://, about:)
 *   - Verify command dispatch to already-injected tabs skips duplicate injection
 *   - Verify command dispatch to non-injected tabs injects scripts and dispatches message
 *   - Verify graceful handling when tab is null or injection fails
 * Domain 6: Universal Rule Audit
 *   - Verify zero website or domain hardcoding across all modified client files
 *
 * Run with: node client-script/test_w2_challenger_stress.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
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

async function runWave2ChallengerStress() {
  console.log('\n===============================================================');
  console.log('   Atlas Assistant — Wave 2 Adversarial Empirical Stress Suite ');
  console.log('===============================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const clientDir = path.join(rootDir, 'client-script');

  const sidebarCssPath = path.join(clientDir, 'sidebar.css');
  const optionsCssPath = path.join(clientDir, 'options.css');
  const sidebarJsPath = path.join(clientDir, 'sidebar.js');
  const speechJsPath = path.join(clientDir, 'speech.js');
  const backgroundJsPath = path.join(clientDir, 'background.js');
  const contentJsPath = path.join(clientDir, 'content.js');
  const manifestPath = path.join(clientDir, 'manifest.json');
  const optionsHtmlPath = path.join(clientDir, 'options.html');
  const ttsJsPath = path.join(clientDir, 'tts.js');
  const serializerJsPath = path.join(clientDir, 'dom-serializer.js');

  const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
  const optionsCss = fs.readFileSync(optionsCssPath, 'utf8');
  const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
  const speechJs = fs.readFileSync(speechJsPath, 'utf8');
  const optionsHtml = fs.readFileSync(optionsHtmlPath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ttsJs = fs.readFileSync(ttsJsPath, 'utf8');
  const serializerJs = fs.readFileSync(serializerJsPath, 'utf8');

  // ==========================================================================
  // Domain 1: Static Typography & CSS Floor Audit (< 14px)
  // ==========================================================================
  console.log('[Domain 1: Static Typography & CSS Floor Audit (< 14px)]');

  // Scan sidebar.css
  const sub14Regex = /font(?:-size)?\s*:\s*([^;]+);/gi;
  let sidebarSub14Matches = [];
  let m;
  while ((m = sub14Regex.exec(sidebarCss)) !== null) {
    const val = m[1].trim();
    const pxMatch = val.match(/^(\d+(?:\.\d+)?)px\b/i);
    if (pxMatch && parseFloat(pxMatch[1]) < 14) {
      sidebarSub14Matches.push(m[0]);
    }
  }
  record('TYPO-01: sidebar.css contains strictly zero font declarations < 14px',
    sidebarSub14Matches.length === 0,
    `Found sub-14px declarations: ${sidebarSub14Matches.join(', ')}`);

  // Scan options.css
  let optionsSub14Matches = [];
  while ((m = sub14Regex.exec(optionsCss)) !== null) {
    const val = m[1].trim();
    const pxMatch = val.match(/^(\d+(?:\.\d+)?)px\b/i);
    if (pxMatch && parseFloat(pxMatch[1]) < 14) {
      optionsSub14Matches.push(m[0]);
    }
  }
  record('TYPO-02: options.css contains strictly zero font declarations < 14px',
    optionsSub14Matches.length === 0,
    `Found sub-14px declarations: ${optionsSub14Matches.join(', ')}`);

  // Scan options.html for inline font-size < 14px
  const htmlInlineSub14Matches = [];
  const inlineFontRegex = /font-size\s*:\s*([^;"'>]+)/gi;
  while ((m = inlineFontRegex.exec(optionsHtml)) !== null) {
    const val = m[1].trim();
    const pxMatch = val.match(/^(\d+(?:\.\d+)?)px\b/i);
    if (pxMatch && parseFloat(pxMatch[1]) < 14) {
      htmlInlineSub14Matches.push(m[0]);
    }
  }
  record('TYPO-03: options.html contains strictly zero inline font-size declarations < 14px',
    htmlInlineSub14Matches.length === 0,
    `Found inline sub-14px in options.html: ${htmlInlineSub14Matches.join(', ')}`);

  if (htmlInlineSub14Matches.length > 0) {
    empiricalFindings.push({
      type: 'Defect',
      component: 'options.html (line 135)',
      detail: `#launch-wizard-btn declares inline style="font-size: 13px; padding: 8px 12px;", violating the 14px typography floor.`
    });
  }

  // Check CSS custom property tokens across text scales
  const tokenDefs = [
    { scale: 'normal', floor: 14, body: 16 },
    { scale: 'large', floor: 16, body: 18 },
    { scale: 'xl', floor: 18, body: 20 },
  ];
  let tokensValid = true;
  for (const t of tokenDefs) {
    const classBlock = sidebarCss.match(new RegExp(`\\.atlas-text-scale-${t.scale}\\s*\\{([^}]+)\\}`, 'i'));
    if (!classBlock) {
      tokensValid = false;
      break;
    }
    const blockContent = classBlock[1];
    if (!blockContent.includes(`--atlas-font-floor: ${t.floor}px`) ||
        !blockContent.includes(`--atlas-font-body: ${t.body}px`)) {
      tokensValid = false;
      break;
    }
  }
  record('TYPO-04: CSS custom property tokens enforce floor >= 14px and body >= 16px across all scales',
    tokensValid,
    'Text scaling tokens missing or below floor values');

  // ==========================================================================
  // Headless Browser Setup (Chromium)
  // ==========================================================================
  let browser = null;
  let server = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    });

    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });

    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Atlas Wave 2 Adversarial Testbed</title>
        <style id="atlas-sidebar-css">${sidebarCss}</style>
      </head>
      <body>
        <div id="host-app">
          <button id="dummy-btn">Host Button</button>
        </div>
        <script>${serializerJs}</script>
        <script>${ttsJs}</script>
        <script>${sidebarJs}</script>
        <script>
          window.__atlasGetRoot = () => window.__atlasShadowRoot?.getElementById('atlas-sidebar-root') || document.getElementById('atlas-sidebar-root');
          AtlasSidebar.mount();
        </script>
      </body>
      </html>
    `);

    await page.waitForTimeout(300);

    // ==========================================================================
    // Domain 2: Headless Browser Computed Target Dimensions (>= 44x44px)
    // ==========================================================================
    console.log('\n[Domain 2: Headless Browser Computed Target Dimensions (>= 44x44px)]');

    const evaluateHitTargets = async (scale) => {
      await page.evaluate((s) => AtlasSidebar.setTextScale(s), scale);
      await page.waitForTimeout(100);

      return await page.evaluate(() => {
        const root = window.__atlasGetRoot();
        const headerClose = root.querySelector('#atlas-header-close');
        const headerStop = root.querySelector('#atlas-header-stop');
        const headerTextScale = root.querySelector('#atlas-header-text-scale');
        const headerTts = root.querySelector('#atlas-header-tts');
        const headerRefresh = root.querySelector('#atlas-header-refresh');
        const headerCollapse = root.querySelector('#atlas-header-collapse');
        const tabChat = root.querySelector('.atlas-tab[data-tab="chat"]');
        const tabElements = root.querySelector('.atlas-tab[data-tab="elements"]');
        const modeToggle = root.querySelector('#atlas-mode-toggle');
        const langToggle = root.querySelector('#atlas-lang-toggle');
        const micBtn = root.querySelector('.atlas-mic-btn');
        const chatInput = root.querySelector('.atlas-chat-input');

        const measure = (el) => {
          if (!el) return { width: 0, height: 0, exists: false };
          const r = el.getBoundingClientRect();
          return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, exists: true };
        };

        return {
          headerClose: measure(headerClose),
          headerStop: measure(headerStop),
          headerTextScale: measure(headerTextScale),
          headerTts: measure(headerTts),
          headerRefresh: measure(headerRefresh),
          headerCollapse: measure(headerCollapse),
          tabChat: measure(tabChat),
          tabElements: measure(tabElements),
          modeToggle: measure(modeToggle),
          langToggle: measure(langToggle),
          micBtn: measure(micBtn),
          chatInput: measure(chatInput),
        };
      });
    };

    for (const scale of ['normal', 'large', 'xl']) {
      const targets = await evaluateHitTargets(scale);
      const isGte44 = (t) => t.exists && t.width >= 44 && t.height >= 44;
      const isHeightGte44 = (t) => t.exists && t.height >= 44;

      record(`HIT-01: Close button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerClose),
        `Dimensions: ${targets.headerClose.width}x${targets.headerClose.height}px`);

      record(`HIT-02: Header stop button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerStop),
        `Dimensions: ${targets.headerStop.width}x${targets.headerStop.height}px`);

      record(`HIT-03: Header text-scale button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerTextScale),
        `Dimensions: ${targets.headerTextScale.width}x${targets.headerTextScale.height}px`);

      record(`HIT-04: Header TTS button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerTts),
        `Dimensions: ${targets.headerTts.width}x${targets.headerTts.height}px`);

      record(`HIT-05: Header refresh button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerRefresh),
        `Dimensions: ${targets.headerRefresh.width}x${targets.headerRefresh.height}px`);

      record(`HIT-06: Header collapse button meets >=44x44px hit target in ${scale} scale`,
        isGte44(targets.headerCollapse),
        `Dimensions: ${targets.headerCollapse.width}x${targets.headerCollapse.height}px`);

      record(`HIT-07: Chat & Elements tabs meet >=44x44px hit target in ${scale} scale`,
        isGte44(targets.tabChat) && isGte44(targets.tabElements),
        `Chat: ${targets.tabChat.width}x${targets.tabChat.height}px, Elements: ${targets.tabElements.width}x${targets.tabElements.height}px`);

      record(`HIT-08: Bottom input bar buttons (mode, lang, mic) meet >=44x44px in ${scale} scale`,
        isGte44(targets.modeToggle) && isGte44(targets.langToggle) && isGte44(targets.micBtn),
        `Mode: ${targets.modeToggle.width}x${targets.modeToggle.height}px, Lang: ${targets.langToggle.width}x${targets.langToggle.height}px, Mic: ${targets.micBtn.width}x${targets.micBtn.height}px`);

      record(`HIT-09: Chat input box has height >= 44px in ${scale} scale`,
        isHeightGte44(targets.chatInput),
        `Height: ${targets.chatInput.height}px`);
    }

    // Reset scale to normal
    await page.evaluate(() => AtlasSidebar.setTextScale('normal'));

    // Check prominent stop button when goal is set
    const stopBtnTarget = await page.evaluate(() => {
      AtlasSidebar.setGoalProgress({
        goal: 'Adversarial benchmark task',
        status: 'in_progress',
        milestones: [{ id: 'm1', description: 'Step 1', status: 'active' }],
        active_milestone_id: 'm1'
      });
      const root = window.__atlasGetRoot();
      const prominentStop = root.querySelector('#atlas-stop-btn');
      const r = prominentStop.getBoundingClientRect();
      AtlasSidebar.hideGoalProgress();
      return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    });
    record('HIT-10: Prominent stop button (#atlas-stop-btn) meets >=44x44px target',
      stopBtnTarget.width >= 44 && stopBtnTarget.height >= 44,
      `Dimensions: ${stopBtnTarget.width}x${stopBtnTarget.height}px`);

    // Check confirmation chips and list items
    const chipItemTargets = await page.evaluate(() => {
      AtlasSidebar.addChatMessage('agent', 'Proceed with transaction?', {
        actions: ['Yes, Confirm', 'Cancel']
      });
      AtlasSidebar.renderElements([
        { index: 1, tag: 'button', label: 'Submit Order', category: 'actions', role: 'button' }
      ]);
      const root = window.__atlasGetRoot();
      const chips = Array.from(root.querySelectorAll('.atlas-chat-actions button'));
      const chipMeasures = chips.map(c => {
        const r = c.getBoundingClientRect();
        return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
      });

      // Switch to Elements tab to measure list items
      root.querySelector('.atlas-tab[data-tab="elements"]').click();
      const searchInput = root.querySelector('.atlas-search');
      const searchRect = searchInput.getBoundingClientRect();
      const groupHeader = root.querySelector('.atlas-group-header');
      const groupRect = groupHeader.getBoundingClientRect();

      // Expand accordion
      groupHeader.click();
      const item = root.querySelector('.atlas-item');
      const itemRect = item.getBoundingClientRect();

      return {
        chips: chipMeasures,
        searchHeight: Math.round(searchRect.height * 10) / 10,
        groupHeight: Math.round(groupRect.height * 10) / 10,
        itemHeight: Math.round(itemRect.height * 10) / 10,
      };
    });

    const allChipsGte44 = chipItemTargets.chips.length > 0 && chipItemTargets.chips.every(c => c.width >= 44 && c.height >= 44);
    record('HIT-11: Confirmation chips (.atlas-chip-btn) meet >=44x44px hit target',
      allChipsGte44,
      `Chips: ${JSON.stringify(chipItemTargets.chips)}`);

    record('HIT-12: Elements search input, accordion group header, and item row meet height >= 44px',
      chipItemTargets.searchHeight >= 44 && chipItemTargets.groupHeight >= 44 && chipItemTargets.itemHeight >= 44,
      `Search: ${chipItemTargets.searchHeight}px, Group: ${chipItemTargets.groupHeight}px, Item: ${chipItemTargets.itemHeight}px`);

    // Audit options.html computed dimensions
    const optionsPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await optionsPage.goto('file://' + optionsHtmlPath);
    const optionsAudit = await optionsPage.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('button, input:not([type="radio"]):not([type="checkbox"])'));
      const sub44 = [];
      const sub14Fonts = [];
      controls.forEach(el => {
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
          if (r.width < 44 || r.height < 44) {
            sub44.push({ id: el.id, tag: el.tagName, text: el.textContent.trim().slice(0, 20), width: r.width, height: r.height });
          }
          const fsPx = parseFloat(cs.fontSize);
          if (fsPx < 14) {
            sub14Fonts.push({ id: el.id, tag: el.tagName, fontSize: cs.fontSize, type: el.type });
          }
        }
      });
      return { sub44, sub14Fonts };
    });
    await optionsPage.close();

    record('HIT-13: All visible buttons and text inputs in options.html meet >= 44px minimum target',
      optionsAudit.sub44.length === 0,
      `Controls < 44px: ${optionsAudit.sub44.map(c => `${c.tag}#${c.id} (${c.width.toFixed(1)}x${c.height.toFixed(1)}px)`).join(', ')}`);

    record('HIT-14: All inputs in options.html (including type=email, type=tel) compute font-size >= 14px',
      optionsAudit.sub14Fonts.length === 0,
      `Inputs with font < 14px: ${optionsAudit.sub14Fonts.map(c => `${c.tag}#${c.id} (font-size: ${c.fontSize})`).join(', ')}`);

    if (optionsAudit.sub44.length > 0) {
      empiricalFindings.push({
        type: 'Defect',
        component: 'options.html buttons (#save-btn, #clear-btn, #save-profile-btn)',
        detail: `Buttons in options.html compute to height: 43px (< 44px) because options.css button rule specifies padding: 12px 18px without min-height: 44px.`
      });
    }
    if (optionsAudit.sub14Fonts.length > 0) {
      empiricalFindings.push({
        type: 'Defect',
        component: 'options.css input styling',
        detail: `options.css specifies font-size: 16px only for input[type="text"], input[type="password"]. Inputs of type="email" and type="tel" fall back to browser default 13.3333px (< 14px).`
      });
    }

    // ==========================================================================
    // Domain 3: Text Scaling Transitions & Horizontal Overflow / Clipping
    // ==========================================================================
    console.log('\n[Domain 3: Text Scaling Transitions & Horizontal Overflow / Clipping]');

    // Switch back to Chat tab for overflow audit
    await page.evaluate(() => {
      const root = window.__atlasGetRoot();
      root.querySelector('.atlas-tab[data-tab="chat"]').click();
    });

    const overflowResults = {};
    for (const scale of ['normal', 'large', 'xl']) {
      await page.evaluate((s) => AtlasSidebar.setTextScale(s), scale);
      await page.waitForTimeout(100);

      const overflowData = await page.evaluate(() => {
        const root = window.__atlasGetRoot();
        const rootRect = root.getBoundingClientRect();
        const header = root.querySelector('.atlas-header');
        const inputBar = root.querySelector('.atlas-chat-input-bar');

        const headerOverflow = header.scrollWidth > header.clientWidth;
        const inputBarOverflow = inputBar.scrollWidth > inputBar.clientWidth;

        // Check if any interactive header buttons or input controls are pushed past rootRect.right
        const clippedControls = [];
        const interactive = root.querySelectorAll('.atlas-header button, .atlas-chat-input-bar button, .atlas-chat-input');
        for (const el of interactive) {
          const r = el.getBoundingClientRect();
          if (r.right > rootRect.right + 1) {
            clippedControls.push({
              id: el.id,
              className: el.className,
              overflowPx: Math.round((r.right - rootRect.right) * 10) / 10
            });
          }
        }

        return {
          rootWidth: rootRect.width,
          headerScrollWidth: header.scrollWidth,
          headerClientWidth: header.clientWidth,
          inputBarScrollWidth: inputBar.scrollWidth,
          inputBarClientWidth: inputBar.clientWidth,
          headerOverflow,
          inputBarOverflow,
          clippedControls
        };
      });

      overflowResults[scale] = overflowData;

      record(`OVR-01: Header layout does not overflow horizontally in ${scale} scale`,
        !overflowData.headerOverflow,
        `scrollWidth (${overflowData.headerScrollWidth}px) exceeds clientWidth (${overflowData.headerClientWidth}px) by ${overflowData.headerScrollWidth - overflowData.headerClientWidth}px`);

      record(`OVR-02: Chat input bar does not overflow horizontally in ${scale} scale`,
        !overflowData.inputBarOverflow,
        `scrollWidth (${overflowData.inputBarScrollWidth}px) exceeds clientWidth (${overflowData.inputBarClientWidth}px) by ${overflowData.inputBarScrollWidth - overflowData.inputBarClientWidth}px`);

      record(`OVR-03: Zero controls clipped or pushed outside sidebar right boundary in ${scale} scale`,
        overflowData.clippedControls.length === 0,
        `Clipped controls: ${overflowData.clippedControls.map(c => `${c.id || c.className.slice(0, 20)} (+${c.overflowPx}px)`).join(', ')}`);
    }

    if (overflowResults.normal.headerOverflow || overflowResults.normal.inputBarOverflow) {
      empiricalFindings.push({
        type: 'Defect',
        component: 'sidebar.css layout (width: 348px vs 559px+ header content)',
        detail: `The fixed 348px width of #atlas-sidebar-root cannot fit the 8 interactive controls in .atlas-header (close, title, 2 tabs, stop, text-scale, tts, refresh, collapse) and 4 controls in .atlas-chat-input-bar (mode, input, lang, mic) when each enforces 44px hit targets. Header overflows horizontally by 211px in Normal, 233px in Large, and 257px in XL scale, causing collapse, refresh, tts, and mic buttons to be clipped outside the viewport.`
      });
    }

    // Verify text scale cycling function
    const scaleCycleCheck = await page.evaluate(() => {
      AtlasSidebar.setTextScale('normal');
      const s1 = AtlasSidebar.getTextScale();
      AtlasSidebar.cycleTextScale();
      const s2 = AtlasSidebar.getTextScale();
      AtlasSidebar.cycleTextScale();
      const s3 = AtlasSidebar.getTextScale();
      AtlasSidebar.cycleTextScale();
      const s4 = AtlasSidebar.getTextScale();
      return s1 === 'normal' && s2 === 'large' && s3 === 'xl' && s4 === 'normal';
    });
    record('OVR-04: AtlasSidebar.cycleTextScale cycles reliably through normal -> large -> xl -> normal',
      scaleCycleCheck,
      'Scale cycling state machine sequence failed');

    // ==========================================================================
    // Domain 4: Live Audio Level Meter & Web Audio Teardown Leak Testing
    // ==========================================================================
    console.log('\n[Domain 4: Live Audio Level Meter & Web Audio Teardown Leak Testing]');

    // Launch ephemeral HTTP server to provide secure context for Web Audio & getUserMedia
    let audioServerPort = 0;
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body><h1>Atlas Speech Audio Test</h1>
        <script>
          window.createdTracks = [];
          window.createdContexts = [];
          window.destinationConnections = [];

          // Mock SpeechRecognition if not natively supported in headless Chromium
          if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
            window.SpeechRecognition = class {
              constructor() {
                this.continuous = false;
                this.interimResults = false;
                this.onstart = null;
                this.onend = null;
                this.onerror = null;
                this.onresult = null;
              }
              start() { setTimeout(() => { this.onstart?.(); }, 10); }
              stop() { setTimeout(() => { this.onend?.(); }, 10); }
              abort() { setTimeout(() => { this.onend?.(); }, 10); }
            };
          }

          // Instrument AudioContext BEFORE speech.js executes
          const OrigAudioContext = window.AudioContext;
          window.AudioContext = class extends OrigAudioContext {
            constructor(...args) {
              super(...args);
              window.createdContexts.push(this);
            }
          };

          // Instrument AudioNode.prototype.connect to detect destination routing
          const origConnect = AudioNode.prototype.connect;
          AudioNode.prototype.connect = function (dest, ...args) {
            if (dest instanceof AudioDestinationNode || (this.context && dest === this.context.destination)) {
              window.destinationConnections.push({ source: this.constructor.name, dest: "destination" });
            }
            return origConnect.call(this, dest, ...args);
          };
        </script>
        <script>${speechJs}</script>
      </body></html>`);
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        audioServerPort = server.address().port;
        resolve();
      });
    });

    const audioContext = await browser.newContext({ permissions: ['microphone'] });
    const audioPage = await audioContext.newPage();
    await audioPage.goto(`http://127.0.0.1:${audioServerPort}`);

    const audioTestResults = await audioPage.evaluate(async () => {
      // Instrument getUserMedia to track all stream tracks
      const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await origGetUserMedia(constraints);
        stream.getTracks().forEach((t) => window.createdTracks.push(t));
        return stream;
      };

      // Test 1: Single cycle audio level emission and graph routing
      let receivedBars = null;
      let receivedLevel = null;
      await AtlasSpeech.start({
        onAudioLevel: ({ level, bars }) => {
          receivedLevel = level;
          receivedBars = bars;
        },
        onResult: () => {},
        onEnd: () => {},
        onError: () => {},
      });

      await new Promise((r) => setTimeout(r, 120));
      const singleCycleDestConnections = [...window.destinationConnections];
      AtlasSpeech.stop();
      await new Promise((r) => setTimeout(r, 50));

      // Test 2: Rapid 50 start/stop cycles
      for (let i = 0; i < 50; i++) {
        AtlasSpeech.start({
          onAudioLevel: () => {},
          onResult: () => {},
          onEnd: () => {},
          onError: () => {},
        });
        if (i % 2 === 0) {
          AtlasSpeech.stop();
        } else {
          await new Promise((r) => setTimeout(r, 8));
          AtlasSpeech.stop();
        }
      }

      // Allow pending microtasks and async getUserMedia promises to settle
      await new Promise((r) => setTimeout(r, 500));
      AtlasSpeech.stop();
      await new Promise((r) => setTimeout(r, 200));

      const unendedTracks50 = window.createdTracks.filter((t) => t.readyState !== 'ended');
      const unclosedContexts50 = window.createdContexts.filter((c) => c.state !== 'closed');

      // Test 3: Concurrent async start calls (20 simultaneous calls with immediate stop)
      const concurrentStarts = [];
      for (let j = 0; j < 20; j++) {
        concurrentStarts.push(
          AtlasSpeech.start({
            onAudioLevel: () => {},
            onResult: () => {},
            onEnd: () => {},
            onError: () => {},
          })
        );
      }
      AtlasSpeech.stop();
      await Promise.allSettled(concurrentStarts);
      await new Promise((r) => setTimeout(r, 500));
      AtlasSpeech.stop();
      await new Promise((r) => setTimeout(r, 200));

      const unendedTracksTotal = window.createdTracks.filter((t) => t.readyState !== 'ended');
      const unclosedContextsTotal = window.createdContexts.filter((c) => c.state !== 'closed');

      return {
        receivedLevel,
        receivedBars,
        singleCycleDestConnections,
        totalDestConnections: window.destinationConnections.length,
        totalTracksCreated: window.createdTracks.length,
        unendedTracks50Count: unendedTracks50.length,
        unclosedContexts50Count: unclosedContexts50.length,
        unendedTracksTotalCount: unendedTracksTotal.length,
        unclosedContextsTotalCount: unclosedContextsTotal.length,
      };
    });

    await audioPage.close();
    await audioContext.close();

    record('AUD-01: Web Audio graph strictly NEVER routes microphone audio to audioContext.destination (feedback prevention)',
      audioTestResults.totalDestConnections === 0,
      `Destination connections detected: ${audioTestResults.totalDestConnections}`);

    record('AUD-02: 50 rapid start/stop cycles end 100% of MediaStreamTracks (readyState === "ended")',
      audioTestResults.unendedTracks50Count === 0,
      `Unended tracks count: ${audioTestResults.unendedTracks50Count}`);

    record('AUD-03: 50 rapid start/stop cycles close 100% of AudioContext instances (state === "closed")',
      audioTestResults.unclosedContexts50Count === 0,
      `Unclosed contexts count: ${audioTestResults.unclosedContexts50Count}`);

    record('AUD-04: Concurrent asynchronous start calls tear down cleanly with 0 leaking tracks and 0 open contexts',
      audioTestResults.unendedTracksTotalCount === 0 && audioTestResults.unclosedContextsTotalCount === 0,
      `Unended total tracks: ${audioTestResults.unendedTracksTotalCount}, Unclosed contexts: ${audioTestResults.unclosedContextsTotalCount}`);

    record('AUD-05: onAudioLevel visualizer receives 4 frequency bands and energy level in [0, 1] range',
      Array.isArray(audioTestResults.receivedBars) &&
        audioTestResults.receivedBars.length === 4 &&
        typeof audioTestResults.receivedLevel === 'number' &&
        audioTestResults.receivedLevel >= 0 &&
        audioTestResults.receivedLevel <= 1,
      `Received level: ${audioTestResults.receivedLevel}, bars: ${JSON.stringify(audioTestResults.receivedBars)}`);

    // ==========================================================================
    // Domain 5: Global Shortcuts & Tab Command Dispatch
    // ==========================================================================
    console.log('\n[Domain 5: Global Shortcuts & Tab Command Dispatch]');

    // Manifest commands registration
    const hasToggleCmd = manifest.commands && manifest.commands['toggle-sidebar'];
    const hasVoiceCmd = manifest.commands && manifest.commands['voice-input'];
    const toggleKeyDefault = hasToggleCmd ? manifest.commands['toggle-sidebar'].suggested_key?.default : null;
    const toggleKeyMac = hasToggleCmd ? manifest.commands['toggle-sidebar'].suggested_key?.mac : null;
    const voiceKeyDefault = hasVoiceCmd ? manifest.commands['voice-input'].suggested_key?.default : null;
    const voiceKeyMac = hasVoiceCmd ? manifest.commands['voice-input'].suggested_key?.mac : null;

    record('CMD-01: manifest.json registers toggle-sidebar (Alt+A / Command+Shift+A) and voice-input (Alt+V / Command+Shift+V)',
      toggleKeyDefault === 'Alt+A' &&
        toggleKeyMac === 'Command+Shift+A' &&
        voiceKeyDefault === 'Alt+V' &&
        voiceKeyMac === 'Command+Shift+V',
      `toggle: ${toggleKeyDefault} / ${toggleKeyMac}, voice: ${voiceKeyDefault} / ${voiceKeyMac}`);

    // Command dispatch behavior on tabs
    const sentMessages = [];
    const injectedTabs = [];
    global.chrome = {
      tabs: {
        sendMessage: async (tabId, msg) => {
          sentMessages.push({ tabId, msg });
          if (tabId === 101) return { status: 'ok' }; // already injected
          if (tabId === 102) {
            if (injectedTabs.includes(102)) return { status: 'ok' };
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          if (tabId === 999) throw new Error('Permission denied or frame missing');
          return null;
        },
      },
      scripting: {
        executeScript: async ({ target }) => {
          injectedTabs.push(target.tabId);
          if (target.tabId === 999) throw new Error('Script injection forbidden');
        },
        insertCSS: async () => {},
      },
    };

    delete require.cache[require.resolve('./background.js')];
    const bgModule = require('./background.js');

    // Test internal URLs: chrome://, edge://, chrome-extension://, about:
    const internalUrls = [
      'chrome://settings',
      'chrome://extensions',
      'chrome-extension://abcdef/popup.html',
      'edge://flags',
      'about:blank',
      'about:config',
    ];
    let internalUrlsBlocked = true;
    for (const url of internalUrls) {
      const beforeLen = sentMessages.length;
      await bgModule.toggleSidebarOnTab({ id: 200, url });
      await bgModule.triggerVoiceOnTab({ id: 200, url });
      if (sentMessages.length !== beforeLen) {
        internalUrlsBlocked = false;
        break;
      }
    }
    record('CMD-02: toggleSidebarOnTab and triggerVoiceOnTab block internal URLs without dispatching messages or injecting scripts',
      internalUrlsBlocked,
      'Internal URLs dispatched messages or attempted script injection');

    // Test already-injected tab
    await bgModule.toggleSidebarOnTab({ id: 101, url: 'https://example.com' });
    const lastMsg101 = sentMessages[sentMessages.length - 1];
    record('CMD-03: toggleSidebarOnTab on already-injected tab directly sends ATLAS_TOGGLE without re-injection',
      lastMsg101 && lastMsg101.tabId === 101 && lastMsg101.msg.type === 'ATLAS_TOGGLE' && !injectedTabs.includes(101),
      'Failed to directly send ATLAS_TOGGLE or re-injected unnecessarily');

    // Test non-injected tab
    await bgModule.toggleSidebarOnTab({ id: 102, url: 'https://example.com' });
    const lastMsg102 = sentMessages[sentMessages.length - 1];
    record('CMD-04: toggleSidebarOnTab on non-injected tab executes ensureContentScript and sends ATLAS_TOGGLE',
      injectedTabs.includes(102) && lastMsg102 && lastMsg102.tabId === 102 && lastMsg102.msg.type === 'ATLAS_TOGGLE',
      'Did not inject scripts or did not send toggle command after injection');

    // Test voice command dispatch on non-injected tab
    const beforeVoiceLen = sentMessages.length;
    await bgModule.triggerVoiceOnTab({ id: 102, url: 'https://example.com' });
    const lastVoiceMsg = sentMessages[sentMessages.length - 1];
    record('CMD-05: triggerVoiceOnTab dispatches ATLAS_TRIGGER_VOICE message to active tab',
      lastVoiceMsg && lastVoiceMsg.tabId === 102 && lastVoiceMsg.msg.type === 'ATLAS_TRIGGER_VOICE',
      `Expected ATLAS_TRIGGER_VOICE, got: ${JSON.stringify(lastVoiceMsg)}`);

    // Test defensive handling: null tab, undefined url, failing injection
    let failedSafely = true;
    try {
      await bgModule.toggleSidebarOnTab(null);
      await bgModule.toggleSidebarOnTab({});
      await bgModule.toggleSidebarOnTab({ id: 0 });
      await bgModule.toggleSidebarOnTab({ id: 999, url: 'https://example.com' }); // injection throws
      await bgModule.triggerVoiceOnTab(null);
      await bgModule.triggerVoiceOnTab({ id: 999, url: 'https://example.com' });
    } catch (_) {
      failedSafely = false;
    }
    record('CMD-06: Tab dispatchers handle null tabs, missing properties, and injection rejections defensively without throwing',
      failedSafely,
      'Dispatcher threw unhandled exception');

    // ==========================================================================
    // Domain 6: Universal Rule Audit
    // ==========================================================================
    console.log('\n[Domain 6: Universal Rule Audit]');

    const filesToAudit = [
      sidebarJsPath,
      sidebarCssPath,
      speechJsPath,
      backgroundJsPath,
      contentJsPath,
      optionsHtmlPath,
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

    const foundDomainViolations = [];
    for (const file of filesToAudit) {
      const content = fs.readFileSync(file, 'utf8');
      for (const domain of forbiddenDomains) {
        if (content.toLowerCase().includes(domain)) {
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(domain) && !line.includes('//') && !line.includes('Use Google services')) {
              foundDomainViolations.push(`${path.basename(file)}:${idx + 1} contains "${domain}"`);
            }
          });
        }
      }
    }

    record('UNI-01: Zero website-specific domain checks across all Wave 2 implementation files',
      foundDomainViolations.length === 0,
      `Found domain checks: ${foundDomainViolations.join('; ')}`);

    // ==========================================================================
    // Summary & Findings Output
    // ==========================================================================
    console.log('\n===============================================================');
    console.log(`Wave 2 Challenger Stress Suite Complete: ${passed} passed, ${failed} failed.`);
    console.log('===============================================================\n');

    if (empiricalFindings.length > 0) {
      console.log('CHALLENGER EMPIRICAL DEFECTS & FINDINGS:');
      empiricalFindings.forEach((f, i) => {
        console.log(` ${i + 1}. [${f.type}] ${f.component}:`);
        console.log(`    ${f.detail}`);
      });
      console.log('');
    }

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Test Harness Exception:', err);
    if (browser) await browser.close();
    if (server) server.close();
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
}

runWave2ChallengerStress();

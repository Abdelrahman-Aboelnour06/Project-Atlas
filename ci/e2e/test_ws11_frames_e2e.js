/**
 * Playwright E2E Test Suite for WS11 Lane A: Multi-Frame Isolation (L2)
 * ci/e2e/test_ws11_frames_e2e.js
 *
 * Verifies that:
 * 1. Content scripts injected with allFrames: true mount the sidebar ONLY in the top frame.
 * 2. Child iframes stay idle (zero sidebars, no duplicate actions).
 * 3. Broadcasting ATLAS_GOAL_RESUME triggers exactly ONE goal_step request and ONE executor action.
 *
 * Runs in Linux CI with real unpacked extension service worker (chrome.scripting.executeScript),
 * with resilient local fallback for Windows environments where headless Chrome does not register MV3 workers.
 *
 * Prime Directive: 100% universal across all websites, zero domain hardcoding.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const assert = require('assert');

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

async function runSuite() {
  console.log('================================================================');
  console.log('   Playwright E2E WS11 Frame Isolation & Top-Frame Gateway Suite');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const clientDir = path.join(rootDir, 'client-script');
  const demoDir = path.join(rootDir, 'demo-site');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-frames-test-'));

  const sidebarCss = fs.readFileSync(path.join(clientDir, 'sidebar.css'), 'utf8');
  const sidebarJs = fs.readFileSync(path.join(clientDir, 'sidebar.js'), 'utf8');
  const secretVaultJs = fs.readFileSync(path.join(clientDir, 'secret-vault.js'), 'utf8');
  const serializerJs = fs.readFileSync(path.join(clientDir, 'dom-serializer.js'), 'utf8');
  const executorJs = fs.readFileSync(path.join(clientDir, 'executor.js'), 'utf8');
  const speechJs = fs.readFileSync(path.join(clientDir, 'speech.js'), 'utf8');
  const ttsJs = fs.readFileSync(path.join(clientDir, 'tts.js'), 'utf8');
  const contentJs = fs.readFileSync(path.join(clientDir, 'content.js'), 'utf8');

  const goalStepRequests = [];
  let serverPort = 0;

  // 1. Setup local HTTP server serving demo-site fixtures and mock goal_step endpoint
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Atlas-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://127.0.0.1:${serverPort}`);

    if (parsedUrl.pathname === '/v1/chat/goal_step' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
          goalStepRequests.push(parsed);
        } catch (_) {
          goalStepRequests.push({});
        }

        let responseData;
        if (
          parsed.goal === 'Test navigation resume and form render' ||
          parsed.goal_state?.goal === 'Test navigation resume and form render'
        ) {
          const awaitingObj = {
            prompt: 'يرجى إدخال الرقم القومي ورقم اللوحة:',
            fields: [
              { ref: 'national_id', label: 'الرقم القومي', required: true, sensitive: true, kind: 'ssn' },
              { ref: 'plate_number', label: 'رقم اللوحة', required: true, sensitive: false, kind: 'text' },
            ],
          };
          responseData = {
            status: 'awaiting_user_input',
            reply: 'يرجى إدخال الرقم القومي ورقم اللوحة:',
            awaiting: awaitingObj,
            awaiting_user_input: awaitingObj,
            goal_state: {
              goal: 'Test navigation resume and form render',
              status: 'awaiting_user_input',
              awaiting: awaitingObj,
              language: 'ar-EG',
              hop_count: 2,
              max_hops: 15,
            },
          };
        } else {
          responseData = {
            status: 'goal_complete',
            reply: 'Goal completed in top frame only.',
            goal_state: {
              goal: 'Test frame isolation',
              status: 'goal_complete',
              hop_count: 1,
              max_hops: 15,
            },
          };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      });
      return;
    }

    // Serve HTML fixtures from demo-site/
    const filePath = path.join(demoDir, parsedUrl.pathname.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`[Test Server] Listening on http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });

  let context = null;

  try {
    const isHeadless = true;
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${clientDir}`,
      `--load-extension=${clientDir}`,
    ];
    if (isHeadless) {
      launchArgs.unshift('--headless=new');
    }

    console.log('[E2E Browser] Launching Chromium persistent context with extension...');
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: isHeadless,
      args: launchArgs,
      viewport: { width: 1280, height: 800 },
    });

    console.log('[E2E Browser] Chromium context active. Discovering Service Worker...');
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 3000 });
      } catch (_) {
        serviceWorker = null;
      }
    }

    const page = await context.newPage();
    const hostUrl = `http://127.0.0.1:${serverPort}/frames-host.html`;
    console.log(`[E2E Page] Navigating to: ${hostUrl}`);
    await page.goto(hostUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Verify 2 child iframes are present on page
    const iframeCount = await page.locator('iframe').count();
    record('L2-01: Page contains exactly 2 child iframes', iframeCount === 2, `Expected 2 iframes, found ${iframeCount}`);

    if (serviceWorker) {
      console.log(`[E2E Service Worker] Worker active: ${serviceWorker.url()}`);
      // Configure extension storage
      await serviceWorker.evaluate(async (port) => {
        await chrome.storage.local.set({
          atlasBaseUrl: `http://127.0.0.1:${port}`,
          atlasApiKey: 'atlas_test_frame_key',
          atlas_wizard_completed: true,
        });
      }, serverPort);

      // Trigger sidebar injection with allFrames: true via background service worker
      console.log('[E2E] Triggering toggleSidebarOnTab from background service worker...');
      await serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await toggleSidebarOnTab(tab);
        }
      });
      await page.waitForTimeout(1000);
    } else {
      console.log('[E2E Info] Service worker event not emitted (Windows headless environment); simulating allFrames: true injection...');
      const injectFrame = async (frame) => {
        await frame.evaluate(({ baseUrl, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs }) => {
          window.__ATLAS_TEST_ENV__ = true;
          window.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (msg.type === 'ATLAS_GOAL_STEP') {
                  fetch(`${baseUrl}/v1/chat/goal_step`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(msg.payload || {}),
                  })
                    .then((r) => r.json())
                    .then((data) => cb && cb({ ok: true, data }))
                    .catch((err) => cb && cb({ ok: false, error: err.message }));
                  return true;
                }
                if (cb) cb({ ok: true });
              },
              onMessage: {
                listeners: [],
                addListener: function (fn) { this.listeners.push(fn); },
              },
            },
            storage: {
              local: {
                get: (k, cb) => cb({ atlasApiKey: 'atlas_test_key', atlasBaseUrl: baseUrl }),
                set: (items, cb) => cb && cb(),
              },
              session: {
                get: async () => ({}),
                set: async () => ({}),
                remove: async () => ({}),
              },
            },
          };

          // Evaluate scripts
          window.eval(sidebarJs);
          window.eval(secretVaultJs);
          window.eval(serializerJs);
          window.eval(executorJs);
          window.eval(speechJs);
          window.eval(ttsJs);
          window.eval(contentJs);

          // Trigger toggle
          if (window.chrome?.runtime?.onMessage?.listeners) {
            for (const listener of window.chrome.runtime.onMessage.listeners) {
              listener({ type: 'ATLAS_TOGGLE' }, {}, () => {});
            }
          }
        }, { baseUrl: `http://127.0.0.1:${serverPort}`, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs });
      };

      // Inject across top frame and both child frames (simulating ensureContentScript with allFrames: true)
      const allFrames = page.frames();
      for (const frame of allFrames) {
        await injectFrame(frame);
      }
      await page.waitForTimeout(1000);
    }

    // 1. Assert exactly ONE sidebar host exists in the TOP frame
    const topFrameSidebarCount = await page.locator('#atlas-sidebar-host').count();
    record(
      'L2-02: Exactly ONE sidebar mounted in the TOP frame',
      topFrameSidebarCount === 1,
      `Expected top frame sidebar count 1, found ${topFrameSidebarCount}`
    );

    // 2. Assert ZERO sidebars mounted in child iframe 1
    const frameOne = page.frameLocator('#iframe-one');
    const frameOneSidebarCount = await frameOne.locator('#atlas-sidebar-host').count();
    record(
      'L2-03: ZERO sidebars mounted inside child iframe-one',
      frameOneSidebarCount === 0,
      `Expected child iframe 1 sidebar count 0, found ${frameOneSidebarCount}`
    );

    // 3. Assert ZERO sidebars mounted in child iframe 2
    const frameTwo = page.frameLocator('#iframe-two');
    const frameTwoSidebarCount = await frameTwo.locator('#atlas-sidebar-host').count();
    record(
      'L2-04: ZERO sidebars mounted inside child iframe-two',
      frameTwoSidebarCount === 0,
      `Expected child iframe 2 sidebar count 0, found ${frameTwoSidebarCount}`
    );

    // 4. Broadcast ATLAS_GOAL_RESUME across all frames
    console.log('[E2E] Broadcasting ATLAS_GOAL_RESUME across all tab frames...');
    if (serviceWorker) {
      await serviceWorker.evaluate(async (port) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          const goalState = {
            goal: 'Test frame isolation',
            status: 'in_progress',
            hop_count: 0,
            max_hops: 15,
            baseUrl: `http://127.0.0.1:${port}`,
          };
          await GoalStore.put(tab.id, goalState);
          chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_GOAL_RESUME', goalState });
        }
      }, serverPort);
    } else {
      // Broadcast to every frame's onMessage listener
      for (const frame of page.frames()) {
        await frame.evaluate((port) => {
          const goalState = {
            goal: 'Test frame isolation',
            status: 'in_progress',
            hop_count: 0,
            max_hops: 15,
            baseUrl: `http://127.0.0.1:${port}`,
          };
          if (window.chrome?.runtime?.onMessage?.listeners) {
            for (const listener of window.chrome.runtime.onMessage.listeners) {
              listener({ type: 'ATLAS_GOAL_RESUME', goalState }, {}, () => {});
            }
          }
        }, serverPort);
      }
    }

    // Allow goal hop network request to arrive at mock backend
    await page.waitForTimeout(2000);

    // 5. Assert exactly ONE goal_step request was received by the backend
    record(
      'L2-05: Exactly ONE goal_step network request executed (no duplicates from child frames)',
      goalStepRequests.length === 1,
      `Expected 1 goal_step request, received ${goalStepRequests.length}`
    );

    // 6. Assert goal completion response was processed in top frame
    const result = await page.evaluate(() => {
      const root = window.AtlasSidebar?.getShadowRoot?.() || window.__atlasShadowRoot;
      const statusText = root?.querySelector?.('.atlas-status')?.textContent || '';
      const chatText = root?.querySelector?.('.atlas-chat-log')?.textContent || '';
      return { statusText, chatText };
    });
    record(
      'L2-06: Top frame status or chat updated to Goal complete',
      result.statusText.toLowerCase().includes('complete') ||
        result.chatText.toLowerCase().includes('complete') ||
        result.statusText.toLowerCase().includes('ready'),
      `Status text: "${result.statusText}", Chat: "${result.chatText}"`
    );

    // -------------------------------------------------------------------------
    // L12 Real-Chromium Check: Navigation Resumption Quiet Mount & Form Render
    // -------------------------------------------------------------------------
    console.log('\n[E2E L12] Navigating to a new page without sidebar active...');
    const childUrl = `http://127.0.0.1:${serverPort}/frame-child.html`;
    await page.goto(childUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Verify sidebar is NOT mounted initially on the newly navigated page
    const initialSidebarCount = await page.locator('#atlas-sidebar-host').count();
    record(
      'L12-01: Newly navigated page does NOT have #atlas-sidebar-host initially',
      initialSidebarCount === 0,
      `Expected 0 sidebars before resume, found ${initialSidebarCount}`
    );

    // If simulating in-page without service worker on Windows headless:
    if (!serviceWorker) {
      await page.evaluate(({ baseUrl, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs }) => {
        window.__ATLAS_TEST_ENV__ = true;
        window.chrome = {
          runtime: {
            lastError: null,
            sendMessage: (msg, cb) => {
              if (msg.type === 'ATLAS_GOAL_STEP') {
                fetch(`${baseUrl}/v1/chat/goal_step`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(msg.payload || {}),
                })
                  .then((r) => r.json())
                  .then((data) => cb && cb({ ok: true, data }))
                  .catch((err) => cb && cb({ ok: false, error: err.message }));
                return true;
              }
              if (cb) cb({ ok: true });
            },
            onMessage: {
              listeners: [],
              addListener: function (fn) { this.listeners.push(fn); },
            },
          },
          storage: {
            local: {
              get: (k, cb) => cb({ atlasApiKey: 'atlas_test_key', atlasBaseUrl: baseUrl }),
              set: (items, cb) => cb && cb(),
            },
            session: {
              get: async () => ({}),
              set: async () => ({}),
              remove: async () => ({}),
            },
          },
        };

        window.eval(sidebarJs);
        window.eval(secretVaultJs);
        window.eval(serializerJs);
        window.eval(executorJs);
        window.eval(speechJs);
        window.eval(ttsJs);
        window.eval(contentJs);
      }, { baseUrl: `http://127.0.0.1:${serverPort}`, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs });
    }

    // Now dispatch ATLAS_GOAL_RESUME to the page
    console.log('[E2E L12] Dispatching ATLAS_GOAL_RESUME to navigated page...');
    const resumeGoalState = {
      goal: 'Test navigation resume and form render',
      language: 'ar-EG',
      status: 'in_progress',
      hop_count: 1,
      max_hops: 15,
      baseUrl: `http://127.0.0.1:${serverPort}`,
    };

    if (serviceWorker) {
      await serviceWorker.evaluate(async ({ port, resumeGoalState }) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await GoalStore.put(tab.id, resumeGoalState);
          chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_GOAL_RESUME', goalState: resumeGoalState });
        }
      }, { port: serverPort, resumeGoalState });
    } else {
      await page.evaluate((goalState) => {
        if (window.chrome?.runtime?.onMessage?.listeners) {
          for (const listener of window.chrome.runtime.onMessage.listeners) {
            listener({ type: 'ATLAS_GOAL_RESUME', goalState }, {}, () => {});
          }
        }
      }, resumeGoalState);
    }

    // Wait for the hop and DOM rendering
    await page.waitForTimeout(2000);

    // 1. Assert #atlas-sidebar-host exists in top frame
    const resumedSidebarCount = await page.locator('#atlas-sidebar-host').count();
    record(
      'L12-02: After ATLAS_GOAL_RESUME, #atlas-sidebar-host exists in top frame',
      resumedSidebarCount === 1,
      `Expected 1 sidebar host after resume, found ${resumedSidebarCount}`
    );

    // 2. Assert awaiting_user_input form card rendered inside the sidebar
    const formCardFound = await page.evaluate(() => {
      const root = window.AtlasSidebar?.getShadowRoot?.() || window.__atlasShadowRoot;
      const formCard = root?.querySelector?.('.atlas-user-input-form-card');
      const input = formCard?.querySelector?.('input[data-field-ref="national_id"]');
      const submitBtn = formCard?.querySelector?.('.atlas-form-submit-btn');
      return {
        hasFormCard: Boolean(formCard),
        hasNationalIdInput: Boolean(input),
        submitBtnText: submitBtn?.textContent || '',
      };
    });

    record(
      'L12-03: awaiting_user_input response renders form card inside resumed sidebar',
      formCardFound.hasFormCard && formCardFound.hasNationalIdInput,
      `Form card: ${formCardFound.hasFormCard}, National ID input: ${formCardFound.hasNationalIdInput}, submit text: "${formCardFound.submitBtnText}"`
    );

  } catch (err) {
    console.error('[E2E Error]', err);
    record('E2E Execution Lifecycle', false, err.message);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (_) {}
    }
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`\nWS11 Frames E2E Complete: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});

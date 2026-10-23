/**
 * Playwright E2E Test Suite for WS5: Router & Closed Goal Loop
 * ci/e2e/test_ws5_portal_router_e2e.js
 *
 * Real Chromium Browser Automated Verification:
 * 1. Drives portal fixture: demo-site/portal-inquiry.html.
 * 2. Injects Atlas extension runtime (sidebar, vault, serializer, executor, content.js).
 * 3. Classifies incoming Arabic service inquiry as 'goal'.
 * 4. Verifies flow stops at 'awaiting_user_input' with fields rendered in closed shadow root (dir="auto").
 * 5. Asserts sensitive national ID has type="password".
 * 6. Fills fields and submits.
 * 7. Intercepts goal_step request: asserts sensitive field is tokenized with {vault:...}
 *    and ZERO raw national ID digits appear in the network payload or chat logs.
 * 8. Completes goal and asserts localized completion reply.
 * 9. Prime Directive: 100% universal across all websites, zero domain hardcoding.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
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
  console.log('   Playwright E2E WS5 Portal Router & Goal Loop Acceptance Suite');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const clientDir = path.join(rootDir, 'client-script');
  const demoDir = path.join(rootDir, 'demo-site');

  const sidebarCss = fs.readFileSync(path.join(clientDir, 'sidebar.css'), 'utf8');
  const sidebarJs = fs.readFileSync(path.join(clientDir, 'sidebar.js'), 'utf8');
  const secretVaultJs = fs.readFileSync(path.join(clientDir, 'secret-vault.js'), 'utf8');
  const serializerJs = fs.readFileSync(path.join(clientDir, 'dom-serializer.js'), 'utf8');
  const executorJs = fs.readFileSync(path.join(clientDir, 'executor.js'), 'utf8');
  const speechJs = fs.readFileSync(path.join(clientDir, 'speech.js'), 'utf8');
  const ttsJs = fs.readFileSync(path.join(clientDir, 'tts.js'), 'utf8');
  const contentJs = fs.readFileSync(path.join(clientDir, 'content.js'), 'utf8');

  // 1. Setup local HTTP server serving portal-inquiry.html and mock backend routes
  let interceptedChatPayload = null;
  const interceptedGoalSteps = [];
  const RAW_NATIONAL_ID = "29801011234567";
  const RAW_PLATE_DIGITS = "1234";

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Atlas-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, 'http://127.0.0.1');

    if (parsedUrl.pathname === '/v1/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        interceptedChatPayload = JSON.parse(body);
        const responseData = {
          intent_route: 'goal',
          answer: 'أنا بدأت معاك الخطوات لتحقيق هدفك: الاستفسار عن مخالفات المركبات.',
          goal_state: {
            goal: 'الاستفسار عن مخالفات المركبات',
            status: 'in_progress',
            hop_count: 0,
            max_hops: 15,
            language: 'ar-EG',
          },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      });
      return;
    }

    if (parsedUrl.pathname === '/v1/chat/goal_step' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body);
        interceptedGoalSteps.push({ rawBody: body, payload });

        if (interceptedGoalSteps.length === 1) {
          // Hop 1: Returns awaiting_user_input
          const responseData = {
            status: 'awaiting_user_input',
            reply: 'يرجى إدخال الرقم القومي ورقم اللوحة للاستعلام عن المخالفات',
            goal_state: {
              goal: 'الاستفسار عن مخالفات المركبات',
              status: 'awaiting_user_input',
              hop_count: 1,
              awaiting: {
                prompt: 'يرجى إدخال الرقم القومي ورقم اللوحة للاستعلام عن المخالفات',
                fields: [
                  {
                    ref: 'national_id',
                    label: 'الرقم القومي (14 رقماً)',
                    kind: 'text',
                    sensitive: true,
                    pattern: '[0-9]{14}',
                    required: true,
                  },
                  {
                    ref: 'plate_digits',
                    label: 'أرقام اللوحة',
                    kind: 'text',
                    sensitive: false,
                    required: true,
                  },
                ],
              },
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseData));
        } else {
          // Hop 2: Submits user inputs and completes goal
          const responseData = {
            status: 'goal_complete',
            reply: 'بيان المخالفات: إجمالي 350 جنيهاً مصرياً.',
            goal_state: {
              goal: 'الاستفسار عن مخالفات المركبات',
              status: 'goal_complete',
              hop_count: 2,
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseData));
        }
      });
      return;
    }

    // Serve demo-site static files
    let filePath = path.join(demoDir, parsedUrl.pathname);
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
      filePath = path.join(demoDir, 'portal-inquiry.html');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeMap = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.txt': 'text/plain',
      };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`[1] Test server active at ${baseUrl}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.newContext({
      locale: 'ar-EG',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // 2. Navigate to portal-inquiry fixture
    await page.goto(`${baseUrl}/portal-inquiry.html`, { waitUntil: 'domcontentloaded' });
    console.log('[2] Loaded portal-inquiry.html fixture');

    // 3. Inject Atlas Client Stack with mock chrome runtime
    await page.evaluate(({ baseUrl, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs }) => {
      window.__ATLAS_TEST_ENV__ = true;

      // Mock chrome extension runtime
      const storageState = {
        atlas_lang: 'ar-EG',
        atlas_voice_lang: 'ar-EG',
        atlasApiKey: 'dev_test_key',
        atlasBaseUrl: baseUrl,
      };

      window.chrome = {
        runtime: {
          lastError: null,
          sendMessage: (msg, callback) => {
            if (msg.type === 'ATLAS_CHAT') {
              fetch(`${baseUrl}/v1/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msg.payload || {}),
              })
                .then(r => r.json())
                .then(data => callback && callback({ ok: true, data }))
                .catch(err => callback && callback({ ok: false, error: err.message }));
              return true;
            }
            if (msg.type === 'ATLAS_GOAL_STEP') {
              fetch(`${baseUrl}/v1/chat/goal_step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msg.payload || {}),
              })
                .then(r => r.json())
                .then(data => callback && callback({ ok: true, data }))
                .catch(err => callback && callback({ ok: false, error: err.message }));
              return true;
            }
            if (callback) callback({ ok: true });
          },
        },
        storage: {
          sync: {
            get: (keys, cb) => {
              if (typeof keys === 'string') return cb({ [keys]: storageState[keys] });
              if (Array.isArray(keys)) {
                const res = {};
                keys.forEach(k => { res[k] = storageState[k]; });
                return cb(res);
              }
              cb(storageState);
            },
          },
          local: {
            get: (keys, cb) => {
              if (typeof keys === 'string') return cb({ [keys]: storageState[keys] });
              if (Array.isArray(keys)) {
                const res = {};
                keys.forEach(k => { res[k] = storageState[k]; });
                return cb(res);
              }
              cb(storageState);
            },
            set: (items, cb) => {
              Object.assign(storageState, items);
              if (cb) cb();
            },
          },
          session: {
            get: (keys, cb) => cb({}),
            set: (items, cb) => cb && cb(),
            remove: (keys, cb) => cb && cb(),
          },
        },
      };

      // Inject sidebar styles
      const styleEl = document.createElement('style');
      styleEl.id = 'atlas-sidebar-css';
      styleEl.textContent = sidebarCss;
      document.head.appendChild(styleEl);

      // Inject scripts in order
      const scripts = [secretVaultJs, serializerJs, executorJs, speechJs, ttsJs, sidebarJs, contentJs];
      scripts.forEach(code => {
        const s = document.createElement('script');
        s.textContent = code;
        document.body.appendChild(s);
      });
    }, { baseUrl, sidebarCss, secretVaultJs, sidebarJs, serializerJs, executorJs, speechJs, ttsJs, contentJs });

    console.log('[3] Atlas extension stack injected and initialized');

    // 4. Ensure Extension is activated and Sidebar opened
    await page.evaluate(async () => {
      await window.AtlasMultiTabOrchestration?.activate?.();
      window.AtlasSidebar?.expand?.();
    });

    // 5. Submit chat inquiry: "اريد الاستفسار عن مخالفات المركبات"
    await page.evaluate(async () => {
      const handler = window.AtlasMultiTabOrchestration?.handleChatInput;
      if (handler) await handler('اريد الاستفسار عن مخالفات المركبات');
    });

    // 6. Wait for awaiting_user_input form to render in Sidebar closed shadow root
    console.log('[4] Verifying execution pauses at awaiting_user_input with form rendered');

    await page.waitForFunction(() => {
      const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
      const formCard = shadowRoot?.querySelector?.('.atlas-user-input-form-card');
      const passInput = formCard?.querySelector?.('input[type="password"]');
      const textInput = formCard?.querySelector?.('input[type="text"]');
      return formCard && passInput && textInput;
    }, { timeout: 10000 });

    const formDetails = await page.evaluate(() => {
      const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
      const formCard = shadowRoot?.querySelector?.('.atlas-user-input-form-card');
      const status = window.AtlasSidebar?.getStatus?.();
      const nationalIdEl = formCard?.querySelector?.('[data-field-ref="national_id"]');
      const plateDigitsEl = formCard?.querySelector?.('[data-field-ref="plate_digits"]');

      return {
        cardExists: Boolean(formCard),
        cardDir: formCard?.getAttribute('dir'),
        status,
        nationalIdType: nationalIdEl?.type,
        nationalIdSensitive: nationalIdEl?.dataset?.sensitive,
        plateDigitsType: plateDigitsEl?.type,
        plateDigitsSensitive: plateDigitsEl?.dataset?.sensitive,
      };
    });

    record('Form rendered inside sidebar shadow root', formDetails.cardExists);
    record('Form card has dir="auto"', formDetails.cardDir === 'auto');
    record('Sensitive national ID input has type="password"', formDetails.nationalIdType === 'password');
    record('Sensitive attribute marked sensitive=true', formDetails.nationalIdSensitive === 'true');
    record('Non-sensitive plate input has type="text"', formDetails.plateDigitsType === 'text');

    // 7. Fill form inside Shadow DOM
    console.log('[5] Filling form inputs with national ID and plate digits');
    await page.evaluate(({ RAW_NATIONAL_ID, RAW_PLATE_DIGITS }) => {
      const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
      const formCard = shadowRoot?.querySelector?.('.atlas-user-input-form-card');
      const nationalIdEl = formCard?.querySelector?.('[data-field-ref="national_id"]');
      const plateDigitsEl = formCard?.querySelector?.('[data-field-ref="plate_digits"]');

      nationalIdEl.value = RAW_NATIONAL_ID;
      plateDigitsEl.value = RAW_PLATE_DIGITS;

      // Submit form
      const submitBtn = formCard?.querySelector?.('button[type="submit"]');
      submitBtn?.click();
    }, { RAW_NATIONAL_ID, RAW_PLATE_DIGITS });

    // 8. Wait for Hop 2 to be dispatched and goal to complete
    console.log('[6] Waiting for Hop 2 dispatch and verification');
    await page.waitForFunction(() => {
      const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
      const chatLog = shadowRoot?.querySelector?.('.atlas-chat-log');
      return chatLog && chatLog.textContent.includes('بيان المخالفات');
    }, { timeout: 10000 });

    // 9. Verify Hop 2 Network Security Invariants
    record('Second goal_step hop was dispatched', interceptedGoalSteps.length >= 2);

    const hop2 = interceptedGoalSteps[1];
    const hop2Payload = hop2?.payload || {};
    const rawRequestBody = hop2?.rawBody || '';

    record('Hop 2 carries user_inputs dictionary', typeof hop2Payload.user_inputs === 'object');

    const vaultToken = hop2Payload.user_inputs?.national_id || '';
    record('Sensitive national ID tokenized as vault token', /^\{(vault:.*|secret|password|ssn|otp|pin)(_\d+)?\}$/.test(vaultToken), `Got: ${vaultToken}`);

    record('Plaintext plate digits passed unchanged', hop2Payload.user_inputs?.plate_digits === RAW_PLATE_DIGITS);

    record('CRITICAL DEFENSE: Raw national ID never in request body', !rawRequestBody.includes(RAW_NATIONAL_ID));

    // Verify chat messages in sidebar do not leak raw national ID
    const chatLogContent = await page.evaluate(() => {
      const shadowRoot = window.AtlasSidebar?.getShadowRoot?.();
      return shadowRoot?.querySelector?.('.atlas-chat-log')?.textContent || '';
    });

    record('CRITICAL DEFENSE: Raw national ID never visible in chat history', !chatLogContent.includes(RAW_NATIONAL_ID));
    record('Goal completion message displayed in chat', chatLogContent.includes('بيان المخالفات'));

    // 10. Universal Prime Directive Audit
    console.log('[7] Universal Prime Directive Compliance Audit');
    for (const forbidden of ['google.com', 'amazon.com', 'drive.google.com', 'github.com', 'wikipedia.org']) {
      assert(!contentJs.includes(forbidden), `Prime Directive violation in content.js: ${forbidden}`);
    }
    record('Universal Prime Directive: Zero hardcoded production domains in content.js', true);

  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log('\n================================================================');
  console.log(`WS5 Portal Router E2E Results: ${passed} passed, ${failed} failed.`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch(err => {
  console.error('Fatal E2E Error:', err);
  process.exit(1);
});

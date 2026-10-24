/**
 * WS12 Lane E: Live-Run Fixes Round 2 Real-Browser E2E Suite
 * ci/e2e/test_ws12_live_round2_e2e.js
 *
 * Validates in real headless Chromium with real FastAPI backend (LLM_PROVIDER=mock):
 * - Flow A (N2, N3): Scoped submit selection & 3-field requirement discovery ('*' marker).
 *   Clicks "استعلام", NEVER clicks "رجوع", "☰", or "English".
 * - Flow B (N3): Validation error recovery after submit. Re-asks ONLY errored plate fields.
 * - Flow C (N6, N5): Generic CTA boost ("ابدأ الخدمة") over nav links ("الأخبار") &
 *   Auth wall non-dismissal (login modal stays open, credential card requested).
 * - Flow D (N5): Saved login credential fill from vault_hints with single confirmation.
 * - Flow E (N5): Login failure handling: emits vault_clear, re-asks once, then hands off on 2nd failure.
 * - Flow F (N5): Sign-up modal fieldless handoff with empty options and "done"/"تم" resumption.
 *
 * Adheres strictly to AGENTS.md Prime Directive: universal across all websites, zero site/domain checks.
 */

const { chromium } = require('playwright');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DEMO_DIR = path.join(ROOT_DIR, 'demo-site');
const CLIENT_DIR = path.join(ROOT_DIR, 'client-script');
const DEMO_KEY = 'atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } catch (_) {}
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (_) {
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    }
  }
}

async function waitForBackendHealth(port, maxWaitMs = 20000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const isUp = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/openapi.json`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (isUp) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Backend failed to respond on port ${port} within ${maxWaitMs}ms`);
}

function createFixtureServer(port) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    let safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/portal-form-marked-required.html';

    const filePath = path.join(DEMO_DIR, safePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8',
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function postGoalStep(backendPort, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: backendPort,
      path: '/v1/chat/goal_step',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-key': DEMO_KEY,
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runSuite() {
  console.log('================================================================');
  console.log('  WS12 Live-Run Round 2 E2E Suite (N2 - N6 Real Browser)');
  console.log('================================================================\n');

  const backendPort = await getFreePort();
  const fixturePort = await getFreePort();

  console.log(`[E2E] Spawning backend on port ${backendPort}...`);
  const pyExe = process.platform === 'win32'
    ? (fs.existsSync(path.join(ROOT_DIR, 'backend', 'venv', 'Scripts', 'python.exe'))
        ? path.join(ROOT_DIR, 'backend', 'venv', 'Scripts', 'python.exe')
        : 'python')
    : (fs.existsSync(path.join(ROOT_DIR, 'backend', 'venv', 'bin', 'python'))
        ? path.join(ROOT_DIR, 'backend', 'venv', 'bin', 'python')
        : 'python3');

  const uvicornProc = spawn(pyExe, [
    '-m', 'uvicorn',
    'app.main:app',
    '--host', '127.0.0.1',
    '--port', String(backendPort),
  ], {
    cwd: path.join(ROOT_DIR, 'backend'),
    env: {
      ...process.env,
      LLM_PROVIDER: 'mock',
      RATE_LIMIT_MAX_REQUESTS: '1000',
      ALLOW_ORIGIN_REGEX: '.*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let uvicornLogs = '';
  uvicornProc.stdout.on('data', (d) => { uvicornLogs += d.toString(); });
  uvicornProc.stderr.on('data', (d) => { uvicornLogs += d.toString(); });

  let fixtureServer = null;
  let browser = null;

  try {
    await waitForBackendHealth(backendPort, 20000);
    console.log(`[E2E] Backend healthy at http://127.0.0.1:${backendPort}/health`);

    fixtureServer = await createFixtureServer(fixturePort);
    const fixtureBase = `http://127.0.0.1:${fixturePort}`;
    console.log(`[E2E] Fixture server running at ${fixtureBase}\n`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.newContext({
      locale: 'ar-EG',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    async function injectClient() {
      await page.addScriptTag({ path: path.join(CLIENT_DIR, 'dom-serializer.js') });
      await page.addScriptTag({ path: path.join(CLIENT_DIR, 'executor.js') });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW A: Scoped submit selection & Asterisk requirement discovery (N2, N3)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('[Flow A] Testing scoped submit selection & asterisk requirement discovery...');
    await page.goto(`${fixtureBase}/portal-form-marked-required.html`, { waitUntil: 'domcontentloaded' });
    await injectClient();

    const domA1 = await page.evaluate(() => window.AtlasSerializer.serialize());
    const goalA = 'الاستعلام عن مخالفات المرور للرقم القومي';

    // Hop A.1: Discovers all 3 required fields
    const resA1 = await postGoalStep(backendPort, {
      goal: goalA,
      current_url: `${fixtureBase}/portal-form-marked-required.html`,
      dom_map: domA1,
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow A.1: Returns awaiting_user_input status', resA1.status === 200 && resA1.data.status === 'awaiting_user_input');
    const awaitingA = resA1.data.goal_state.awaiting;
    record('Flow A.2: Discovered exactly 3 required fields (ID, plate digits, plate letters)', awaitingA && awaitingA.fields.length === 3);

    const hasDigits = awaitingA.fields.some((f) => (f.label || '').includes('أرقام'));
    const hasLetters = awaitingA.fields.some((f) => (f.label || '').includes('حروف'));
    const hasNid = awaitingA.fields.some((f) => (f.label || '').includes('الرقم القومي'));
    record('Flow A.3: Required fields contain ID, plate digits, and plate letters', hasDigits && hasLetters && hasNid);

    const nidField = awaitingA.fields.find((f) => (f.label || '').includes('الرقم القومي'));
    const digitsField = awaitingA.fields.find((f) => (f.label || '').includes('أرقام'));
    const lettersField = awaitingA.fields.find((f) => (f.label || '').includes('حروف'));

    // Hop A.2: Provide user inputs with tokenized vault national_id
    const resA2 = await postGoalStep(backendPort, {
      goal: goalA,
      goal_state: resA1.data.goal_state,
      current_url: `${fixtureBase}/portal-form-marked-required.html`,
      dom_map: domA1,
      language: 'ar-EG',
      user_inputs: {
        [nidField.ref]: '{vault:nid_token_12345}',
        [digitsField.ref]: '1234',
        [lettersField.ref]: 'أبج',
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow A.4: Inputs supplied returns in_progress fill steps', resA2.status === 200 && resA2.data.status === 'in_progress');
    const fillStepsA = resA2.data.steps || [];
    record('Flow A.5: Returns 3 fill steps for ID, digits, letters', fillStepsA.length === 3);

    // Client fills the form inputs in browser (using AtlasExecutor / token simulation)
    await page.evaluate(() => {
      const nidEl = document.querySelector('#national_id');
      nidEl.value = '00000000000000';
      nidEl.setAttribute('data-atlas-token', '{vault:nid_token_12345}');
    });
    await page.fill('#plate_numbers', '1234');
    await page.fill('#plate_letters', 'أبج');
    await page.waitForTimeout(200);

    // Hop A.3: Filled DOM perception sent to backend -> requires submit confirmation
    const domAFilled = await page.evaluate(() => window.AtlasSerializer.serialize());
    const resA3 = await postGoalStep(backendPort, {
      goal: goalA,
      goal_state: resA2.data.goal_state,
      current_url: `${fixtureBase}/portal-form-marked-required.html`,
      dom_map: domAFilled,
      page_text: 'نيابات المرور - الاستعلام عن مخالفات المركبات',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow A.6: Prompts submit confirmation before executing', resA3.status === 200 && resA3.data.status === 'requires_confirmation');

    // Hop A.4: Confirm submit: "أيوة" -> backend returns click step on submit button
    const resA4 = await postGoalStep(backendPort, {
      goal: goalA,
      goal_state: resA3.data.goal_state,
      current_url: `${fixtureBase}/portal-form-marked-required.html`,
      dom_map: domAFilled,
      language: 'ar-EG',
      user_response: 'أيوة',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow A.7: Confirm submit returns in_progress with click step', resA4.status === 200 && resA4.data.status === 'in_progress');
    const stepsA4 = resA4.data.steps || [];
    const clickStepA = stepsA4.find((s) => s.action === 'click');

    const backBtnNode = domA1.find((n) => (n.resolved_label || '').includes('رجوع'));
    const menuBtnNode = domA1.find((n) => (n.resolved_label || '').includes('☰') || (n.resolved_label || '').includes('القائمة'));
    const submitBtnNode = domA1.find((n) => (n.resolved_label || '').includes('استعلام'));

    record('Flow A.8: Click target is submit button "استعلام"', clickStepA && clickStepA.element_id === submitBtnNode.id);
    record('Flow A.9: Click target is NEVER back button "رجوع"', clickStepA && (!backBtnNode || clickStepA.element_id !== backBtnNode.id));
    record('Flow A.10: Click target is NEVER menu button "☰"', clickStepA && (!menuBtnNode || clickStepA.element_id !== menuBtnNode.id));

    // Execute submit click in browser
    await page.click('#btn-submit');
    await page.waitForTimeout(300);
    const tableVisible = await page.isVisible('#results-table');
    record('Flow A.11: Results table successfully displayed on submit', tableVisible);

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW B: Validation error recovery (N3)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Flow B] Testing validation error recovery after confirmed submit...');
    await page.goto(`${fixtureBase}/portal-form-marked-required.html`, { waitUntil: 'domcontentloaded' });
    await injectClient();

    // Trigger validation error: fill only national_id and submit
    await page.fill('#national_id', '00000000000000');
    await page.click('#btn-submit');
    await page.waitForTimeout(200);

    const domB = await page.evaluate(() => window.AtlasSerializer.serialize());
    const digitsInvalid = domB.find((n) => n.id && n.name === 'plate_numbers' && n.invalid === true);
    const lettersInvalid = domB.find((n) => n.id && n.name === 'plate_letters' && n.invalid === true);
    record('Flow B.1: Serializer perceives invalid=true on errored plate fields', Boolean(digitsInvalid && lettersInvalid));

    // Send to backend with last_step_was_submit = True
    const resB = await postGoalStep(backendPort, {
      goal: goalA,
      goal_state: {
        goal: goalA,
        status: 'in_progress',
        current_url: `${fixtureBase}/portal-form-marked-required.html`,
        hop_count: 3,
        max_hops: 8,
        dom_state: {
          last_step_was_submit: true,
        },
      },
      current_url: `${fixtureBase}/portal-form-marked-required.html`,
      dom_map: domB,
      page_text: 'يرجى إدخال أرقام اللوحة\nيرجى إدخال حروف اللوحة',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow B.2: Validation recovery returns awaiting_user_input', resB.status === 200 && resB.data.status === 'awaiting_user_input');
    const reaskFields = resB.data.goal_state.awaiting.fields || [];
    record('Flow B.3: Re-asks ONLY the 2 errored fields', reaskFields.length === 2);
    const reaskDigits = reaskFields.some((f) => (f.label || '').includes('أرقام'));
    const reaskLetters = reaskFields.some((f) => (f.label || '').includes('حروف'));
    const reaskNid = reaskFields.some((f) => (f.label || '').includes('الرقم القومي'));
    record('Flow B.4: Re-asks digits and letters, but NOT national ID', reaskDigits && reaskLetters && !reaskNid);

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW C: Generic CTA boost over nav links & Auth modal non-dismissal (N6, N5)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Flow C] Testing generic CTA boost ("ابدأ الخدمة") over nav links & auth modal non-dismissal...');
    await page.goto(`${fixtureBase}/portal-service-login.html`, { waitUntil: 'domcontentloaded' });
    await injectClient();

    const domC = await page.evaluate(() => window.AtlasSerializer.serialize());
    const ctaNode = domC.find((n) => (n.resolved_label || '').includes('ابدأ الخدمة'));
    const newsLinkNode = domC.find((n) => (n.resolved_label || '').includes('الأخبار'));
    const goalC = 'الاستعلام عن مخالفات رخص المركبات';

    const resC1 = await postGoalStep(backendPort, {
      goal: goalC,
      current_url: `${fixtureBase}/portal-service-login.html`,
      dom_map: domC,
      page_text: 'الاستعلام عن مخالفات رخص المركبات\nخدمة فورية تمكّنك من معرفة مخالفات المرور المستحقة على مركبتك وسدادها إلكترونياً.',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow C.1: Returns in_progress for CTA action', resC1.status === 200 && resC1.data.status === 'in_progress');
    const firstStepC = resC1.data.steps?.[0];

    record('Flow C.2: Generic CTA "ابدأ الخدمة" is clicked', firstStepC && firstStepC.element_id === ctaNode.id);
    record('Flow C.3: Nav link "الأخبار" is NOT clicked', firstStepC && (!newsLinkNode || firstStepC.element_id !== newsLinkNode.id));

    // Click CTA to toggle login overlay open
    await page.click('#start-service-btn');
    await page.waitForTimeout(200);
    const modalVisible = await page.isVisible('#login-modal');
    record('Flow C.4: Login modal is now open in browser', modalVisible);

    // Serializer perceives login modal
    const domCModal = await page.evaluate(() => window.AtlasSerializer.serialize());
    const closeBtnNode = domCModal.find((n) => (n.resolved_label || '') === 'إغلاق');

    const resC2 = await postGoalStep(backendPort, {
      goal: goalC,
      goal_state: resC1.data.goal_state,
      current_url: `${fixtureBase}/portal-service-login.html`,
      dom_map: domCModal,
      page_text: 'تسجيل الدخول إلى بوابة الخدمات',
      language: 'ar-EG',
      vault_hints: [],
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow C.5: Login modal prompts for credentials, NOT dismissed', resC2.status === 200 && resC2.data.status === 'awaiting_user_input');
    const awaitingC = resC2.data.goal_state.awaiting;
    record('Flow C.6: Awaiting kind is credential', awaitingC && awaitingC.kind === 'credential');
    record('Flow C.7: Credential fields include login_id and password', awaitingC && awaitingC.fields.some((f) => f.kind === 'login_id') && awaitingC.fields.some((f) => f.kind === 'password'));
    record('Flow C.8: Option is [auth_no_account_option] ("معنديش حساب")', awaitingC && awaitingC.options.length === 1);

    const stepsDismiss = resC2.data.steps || [];
    const closeClicked = stepsDismiss.some((s) => closeBtnNode && s.element_id === closeBtnNode.id);
    const escPressed = stepsDismiss.some((s) => s.action === 'press_key' && s.value === 'Escape');
    record('Flow C.9: Modal close button was NOT clicked and Escape was NOT pressed', !closeClicked && !escPressed);

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW D: Vault hints fill & single confirmation (N5)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Flow D] Testing vault hints fill & single confirmation...');
    const resD1 = await postGoalStep(backendPort, {
      goal: goalC,
      current_url: `${fixtureBase}/portal-service-login.html`,
      dom_map: domCModal,
      language: 'ar-EG',
      vault_hints: ['login_id', 'password'],
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow D.1: Vault hints present triggers requires_confirmation', resD1.status === 200 && resD1.data.status === 'requires_confirmation');

    // Confirm: "أيوة"
    const resD2 = await postGoalStep(backendPort, {
      goal: goalC,
      goal_state: resD1.data.goal_state,
      current_url: `${fixtureBase}/portal-service-login.html`,
      dom_map: domCModal,
      user_response: 'أيوة',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow D.2: Confirmation proceeds to in_progress fill', resD2.status === 200 && resD2.data.status === 'in_progress');
    const stepsD = resD2.data.steps || [];
    record('Flow D.3: Emits batch fill of {login_id} and {password}', stepsD.length === 3 && stepsD[0].value === '{login_id}' && stepsD[1].value === '{password}');
    record('Flow D.4: Emits click on login submit button', stepsD.length === 3 && stepsD[2].action === 'click');

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW E: Login failure vault clear & manual handoff (N5)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Flow E] Testing login failure vault clear & manual handoff...');
    await page.fill('#login-id', '00000000000000');
    await page.fill('#login-pass', 'wrong_pass');
    await page.click('#login-submit');
    await page.waitForTimeout(200);

    const domE = await page.evaluate(() => window.AtlasSerializer.serialize());

    // 1st failure after login submit
    const resE1 = await postGoalStep(backendPort, {
      goal: goalC,
      goal_state: {
        goal: goalC,
        status: 'in_progress',
        current_url: `${fixtureBase}/portal-service-login.html`,
        hop_count: 3,
        max_hops: 8,
        dom_state: {
          last_step_was_login_submit: true,
        },
      },
      dom_map: domE,
      current_url: `${fixtureBase}/portal-service-login.html`,
      page_text: 'اسم المستخدم أو كلمة المرور غير صحيحة',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow E.1: 1st login failure emits vault_clear for login_id & password', resE1.status === 200 && JSON.stringify(resE1.data.vault_clear) === JSON.stringify(['login_id', 'password']));
    record('Flow E.2: 1st login failure re-prompts credentials card', resE1.data.status === 'awaiting_user_input' && resE1.data.goal_state.dom_state.auth_attempts === 1);

    // 2nd failure after login submit
    const stateE2 = resE1.data.goal_state;
    stateE2.dom_state.last_step_was_login_submit = true;

    const resE2 = await postGoalStep(backendPort, {
      goal: goalC,
      goal_state: stateE2,
      dom_map: domE,
      current_url: `${fixtureBase}/portal-service-login.html`,
      page_text: 'اسم المستخدم أو كلمة المرور غير صحيحة',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow E.3: 2nd login failure hands off manually with empty options', resE2.status === 200 && resE2.data.status === 'awaiting_user_input' && resE2.data.goal_state.awaiting.options.length === 0);

    // ──────────────────────────────────────────────────────────────────────────
    // FLOW F: Sign-up modal fieldless handoff & resume (N5)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Flow F] Testing sign-up modal fieldless handoff & resume...');
    await page.goto(`${fixtureBase}/portal-service-signup.html`, { waitUntil: 'domcontentloaded' });
    await injectClient();

    const domF = await page.evaluate(() => window.AtlasSerializer.serialize());

    const resF1 = await postGoalStep(backendPort, {
      goal: goalC,
      current_url: `${fixtureBase}/portal-service-signup.html`,
      dom_map: domF,
      page_text: 'إنشاء حساب جديد',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow F.1: Sign-up wall yields fieldless handoff', resF1.status === 200 && resF1.data.status === 'awaiting_user_input');
    record('Flow F.2: Sign-up handoff has empty options (enables default continue chip in Lane D)', resF1.data.goal_state.awaiting.options.length === 0);

    // User resumes with "تم"
    const resF2 = await postGoalStep(backendPort, {
      goal: goalC,
      goal_state: resF1.data.goal_state,
      current_url: `${fixtureBase}/portal-service-signup.html`,
      dom_map: domF,
      user_response: 'تم',
      language: 'ar-EG',
      api_key: DEMO_KEY,
      contract_version: 3,
    });

    record('Flow F.3: Resumes goal execution after user registration', resF2.status === 200 && resF2.data.status === 'in_progress');

    await context.close();
  } finally {
    if (browser) await browser.close();
    if (fixtureServer) fixtureServer.close();
    if (uvicornProc && uvicornProc.pid) {
      killProcessTree(uvicornProc.pid);
    }
  }

  console.log('\n================================================================');
  console.log(`WS12 Live-Run Round 2 E2E Summary: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('[E2E Fatal Error]:', err);
  process.exit(1);
});

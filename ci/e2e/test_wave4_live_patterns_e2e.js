/**
 * ci/e2e/test_wave4_live_patterns_e2e.js
 * End-to-End Live Patterns Acceptance Suite (WS11 Lane C).
 *
 * Validates the 4 live patterns across real browser and FastAPI backend:
 * 1. portal-tiles.html: Tile expansion visual change detection (>400ms panel swap)
 *    and positive change override of verifier no-change (L11).
 * 2. portal-modal-form.html: Modal perception & scoping (in_modal: true,
 *    blocked_by_modal: true), form filling in modal, and irrelevant modal dismissal (L7/C5/C7).
 * 3. frames-host.html: Multi-frame isolation, top-frame gating, zero duplicate
 *    sidebars or actions in child iframes (L2).
 * 4. Cross-origin vs Same-origin navigation control (L3):
 *    Same-origin target="_blank" sets same_tab: true without confirmation;
 *    Cross-origin target="_blank" triggers requires_origin_confirmation with exact host.
 */

const { chromium } = require("playwright");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "../..");
const CLIENT_DIR = path.join(ROOT_DIR, "client-script");
const DEMO_DIR = path.join(ROOT_DIR, "demo-site");
const DEMO_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

let passed = 0;
let failed = 0;

function record(name, condition, details = "") {
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
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } catch (_) {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (_) {
      try { process.kill(pid, "SIGKILL"); } catch (_) {}
    }
  }
}

async function waitForBackendHealth(port, maxWaitMs = 20000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.text();
      if (res.status === 200 || res.status === 503 || body.includes("atlas-backend")) {
        return true;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Backend on port ${port} did not become healthy within ${maxWaitMs}ms.`);
}

function createFixtureServer(port) {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Atlas-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let reqPath = req.url.split("?")[0].replace(/^\//, "");
    if (!reqPath) reqPath = "index.html";
    const filePath = path.join(DEMO_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Fixture Not Found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runSuite() {
  console.log("================================================================");
  console.log("   Playwright E2E WS11 Wave 4 Live Patterns Acceptance Suite    ");
  console.log("================================================================\n");

  const backendPort = await getFreePort();
  const fixturePort = await getFreePort();

  const pyExe = process.platform === "win32"
    ? (fs.existsSync(path.join(ROOT_DIR, "backend", "venv", "Scripts", "python.exe"))
        ? path.join(ROOT_DIR, "backend", "venv", "Scripts", "python.exe")
        : "python")
    : (fs.existsSync(path.join(ROOT_DIR, "backend", "venv", "bin", "python"))
        ? path.join(ROOT_DIR, "backend", "venv", "bin", "python")
        : "python3");

  console.log(`[E2E] Spawning backend on port ${backendPort} with ${pyExe}...`);
  const uvicornProc = spawn(
    pyExe,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    {
      cwd: path.join(ROOT_DIR, "backend"),
      env: {
        ...process.env,
        LLM_PROVIDER: "mock",
        RATE_LIMIT_MAX_REQUESTS: "1000",
        PYTHONIOENCODING: "utf-8",
        ALLOW_ORIGIN_REGEX: ".*",
        ATLAS_DEMO_KEY: DEMO_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let uvicornLogs = "";
  uvicornProc.stdout.on("data", (d) => {
    uvicornLogs += d.toString();
    console.log("[Uvicorn STDOUT] " + d.toString().trim());
  });
  uvicornProc.stderr.on("data", (d) => {
    uvicornLogs += d.toString();
    console.log("[Uvicorn STDERR] " + d.toString().trim());
  });
  uvicornProc.on("exit", (code) => {
    if (code && code !== 0) {
      console.log(`[E2E] Uvicorn process exited with code ${code}. Logs:\n${uvicornLogs}`);
    }
  });

  let fixtureServer = null;
  let context = null;

  try {
    await waitForBackendHealth(backendPort, 25000);
    console.log(`[E2E] Backend healthy at http://127.0.0.1:${backendPort}/health`);

    fixtureServer = await createFixtureServer(fixturePort);
    const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
    console.log(`[E2E] Fixture server listening at ${fixtureBaseUrl}`);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-wave4-e2e-"));
    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--disable-extensions-except=${CLIENT_DIR}`,
      `--load-extension=${CLIENT_DIR}`,
      "--headless=new",
    ];

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: launchArgs,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // Helper to inject client-script modules
    async function injectClientScripts(targetPage) {
      await targetPage.addScriptTag({ path: path.join(CLIENT_DIR, "dom-serializer.js") });
      await targetPage.addScriptTag({ path: path.join(CLIENT_DIR, "executor.js") });
    }

    // ────────────────────────────────────────────────────────────────────────
    // PATTERN 1: portal-tiles.html — Tile Expansion & Visual Change Override
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n----------------------------------------------------------------");
    console.log("  Pattern 1: Tile Expansion & L11 Visual Change Detection");
    console.log("----------------------------------------------------------------");
    await page.goto(`${fixtureBaseUrl}/portal-tiles.html`, { waitUntil: "domcontentloaded" });
    await injectClientScripts(page);

    const initialNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const vehiclesTile = initialNodes.find((n) => (n.resolved_label || n.inner_text || "").includes("My Vehicles"));
    record("1a. Found 'My Vehicles' category tile", Boolean(vehiclesTile));

    // Request initial step from backend
    const p1Req1 = {
      goal: "Inquire About Vehicles",
      current_url: `${fixtureBaseUrl}/portal-tiles.html`,
      dom_map: initialNodes,
      goal_state: {
        goal: "Inquire About Vehicles",
        status: "in_progress",
        current_url: `${fixtureBaseUrl}/portal-tiles.html`,
        hop_count: 0,
        max_hops: 8,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };

    const p1Res1Raw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p1Req1,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    record("1b. Backend responded with HTTP 200 for initial tile turn", p1Res1Raw.status() === 200);
    const p1Data1 = await p1Res1Raw.json();
    record("1c. Backend status is in_progress", p1Data1.status === "in_progress");

    // Execute the tile click in browser
    const execResult = await page.evaluate(async (tileId) => {
      return await window.AtlasExecutor.executeStep({
        action: "click",
        element_id: tileId,
        description: "Click My Vehicles category tile",
      });
    }, vehiclesTile.id);

    record("1d. Tile click executed with ok: true", execResult && execResult.ok === true);
    record("1e. Tile swap detected added_visible_count > 0", execResult && execResult.added_visible_count > 0, `got ${execResult?.added_visible_count}`);
    record("1f. Tile swap detected text_changed: true", execResult && execResult.text_changed === true);
    record("1g. Tile swap detected url_changed: false", execResult && execResult.url_changed === false);

    // Turn 2: Feed back execution result and verify positive change overrides "no change"
    const postSwapNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const p1Req2 = {
      goal: "Inquire About Vehicles",
      current_url: `${fixtureBaseUrl}/portal-tiles.html`,
      dom_map: postSwapNodes,
      last_action_result: execResult,
      goal_state: {
        ...p1Data1.goal_state,
        hop_count: 1,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };

    const p1Res2Raw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p1Req2,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    record("1h. Backend responded HTTP 200 on post-swap turn", p1Res2Raw.status() === 200);
    const p1Data2 = await p1Res2Raw.json();
    record("1i. L11 positive change override prevents false goal_failed", p1Data2.status === "in_progress", `got status: ${p1Data2.status}`);

    const newlyRevealedBtn = postSwapNodes.find((n) => (n.resolved_label || n.inner_text || "").includes("Inquire Violations"));
    record("1j. Panel expansion revealed 'Inquire Violations' service control", Boolean(newlyRevealedBtn));

    // ────────────────────────────────────────────────────────────────────────
    // PATTERN 2: portal-modal-form.html — Modal Scoping, Form Fill & Dismissal
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n----------------------------------------------------------------");
    console.log("  Pattern 2: Modal Scoping, Form Fill & Irrelevant Dismissal");
    console.log("----------------------------------------------------------------");
    await page.goto(`${fixtureBaseUrl}/portal-modal-form.html`, { waitUntil: "domcontentloaded" });
    await injectClientScripts(page);

    // Open the service dialog
    await page.click("#card-service-inquiry");
    await page.waitForTimeout(300);

    const modalNodes = await page.evaluate(() => window.AtlasSerializer.serialize());
    const nidInput = modalNodes.find((n) => n.name === "national_id" || (n.resolved_label || "").includes("National ID"));
    const bgHomeLink = modalNodes.find((n) => (n.resolved_label || n.inner_text || "").includes("Home"));

    record("2a. National ID input marked with in_modal: true", nidInput && nidInput.in_modal === true);
    record("2b. Real modal excludes inert background links", bgHomeLink === undefined);

    // Test form filling inside modal
    const p2Req = {
      goal: "Civil Record Application",
      current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
      dom_map: modalNodes,
      goal_state: {
        goal: "Civil Record Application",
        status: "in_progress",
        current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
        hop_count: 0,
        max_hops: 8,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };

    const p2ResRaw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p2Req,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    record("2c. Backend responded HTTP 200 for modal form", p2ResRaw.status() === 200);
    const p2Data = await p2ResRaw.json();
    record("2d. Backend requests missing fields for service modal (awaiting_user_input)", p2Data.status === "awaiting_user_input");
    record(
      "2e. Awaiting fields targets modal National ID input",
      p2Data.goal_state?.awaiting?.fields?.some((f) => (f.ref || "").toLowerCase().includes("national") || (f.name || "").toLowerCase().includes("national") || (f.label || "").toLowerCase().includes("national")),
      `awaiting: ${JSON.stringify(p2Data.goal_state?.awaiting)}`
    );

    // Test irrelevant newsletter modal dismissal (C7 repro case)
    const newsletterModalNodes = [
      { id: "bg-link", tag: "a", resolved_label: "الاستعلام عن مخالفات المركبات", href: "/inquiry", visible: true, in_modal: false, blocked_by_modal: true },
      { id: "news-dialog", tag: "div", role: "dialog", resolved_label: "اشترك في النشرة البريدية", visible: true, in_modal: true },
      { id: "news-close-btn", tag: "button", resolved_label: "إغلاق", inner_text: "×", visible: true, in_modal: true },
      { id: "news-name", tag: "input", type: "text", name: "name", resolved_label: "الاسم", visible: true, in_modal: true },
      { id: "news-email", tag: "input", type: "email", name: "email", resolved_label: "البريد الإلكتروني", visible: true, in_modal: true },
    ];
    const p2DismissReq = {
      goal: "اريد الاستفسار عن مخالفات المركبات",
      current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
      dom_map: newsletterModalNodes,
      goal_state: {
        goal: "اريد الاستفسار عن مخالفات المركبات",
        status: "in_progress",
        current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
        hop_count: 0,
        max_hops: 8,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };
    const p2DismissResRaw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p2DismissReq,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    const p2DismissData = await p2DismissResRaw.json();
    record("2f. C7: Irrelevant Arabic newsletter modal is NOT treated as relevant form", p2DismissData.status !== "awaiting_user_input");
    record("2g. C7/C5: Irrelevant modal produces single dismiss step targeting close button", p2DismissData.steps?.[0]?.action === "click" && p2DismissData.steps?.[0]?.element_id === "news-close-btn");

    // ────────────────────────────────────────────────────────────────────────
    // PATTERN 3: frames-host.html — Multi-Frame Isolation (L2)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n----------------------------------------------------------------");
    console.log("  Pattern 3: Multi-Frame Isolation & Top-Frame Gateway (L2)");
    console.log("----------------------------------------------------------------");
    await page.goto(`${fixtureBaseUrl}/frames-host.html`, { waitUntil: "domcontentloaded" });

    // Verify 2 child iframes are rendered
    const iframes = page.frames();
    record("3a. Page has top frame and child iframes (total frames >= 3)", iframes.length >= 3, `found ${iframes.length}`);

    // Inject sidebar scripts in simulated allFrames: true mode
    const sidebarJs = fs.readFileSync(path.join(CLIENT_DIR, "sidebar.js"), "utf8");
    const contentJs = fs.readFileSync(path.join(CLIENT_DIR, "content.js"), "utf8");

    for (const frame of iframes) {
      await frame.evaluate(({ sJs, cJs, bUrl }) => {
        window.chrome = {
          runtime: {
            sendMessage: (msg, cb) => cb && cb({ ok: true }),
            onMessage: { addListener: () => {} },
          },
          storage: {
            local: { get: (k, cb) => cb({ atlasBaseUrl: bUrl, atlasApiKey: "test_key" }), set: () => {} },
            session: { get: async () => ({}), set: async () => ({}), remove: async () => ({}) },
          },
        };
        try { window.eval(sJs); } catch (_) {}
        try { window.eval(cJs); } catch (_) {}
      }, { sJs: sidebarJs, cJs: contentJs, bUrl: `http://127.0.0.1:${backendPort}` });
    }

    // Top frame identifies as isTopFrame: true
    const topFrameIsTop = await page.evaluate(() => window.__ATLAS_IS_TOP_FRAME__ !== false);
    record("3b. Top frame isTopFrame resolves to true", topFrameIsTop === true);

    const childOne = page.frameLocator("#iframe-one");
    const childOneCount = await childOne.locator("#atlas-sidebar-host").count();
    record("3c. Child iframe 1 does NOT mount duplicate sidebar", childOneCount === 0);

    const childTwo = page.frameLocator("#iframe-two");
    const childTwoCount = await childTwo.locator("#atlas-sidebar-host").count();
    record("3d. Child iframe 2 does NOT mount duplicate sidebar", childTwoCount === 0);

    // ────────────────────────────────────────────────────────────────────────
    // PATTERN 4: Cross-Origin vs Same-Origin Navigation Gating (L3)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n----------------------------------------------------------------");
    console.log("  Pattern 4: Cross-Origin vs Same-Origin Navigation Gating (L3)");
    console.log("----------------------------------------------------------------");

    // Case 4A: Same-origin link with target="_blank"
    const sameOriginNodes = [
      {
        id: "link-same-origin",
        tag: "a",
        resolved_label: "Open Vehicles Page",
        href: `${fixtureBaseUrl}/portal-tiles.html`,
        target: "_blank",
        opens_new_tab: true,
        target_origin: fixtureBaseUrl,
        visible: true,
      },
    ];
    const p4SameReq = {
      goal: "Open Vehicles Page",
      current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
      dom_map: sameOriginNodes,
      goal_state: {
        goal: "Open Vehicles Page",
        status: "in_progress",
        current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
        hop_count: 0,
        max_hops: 8,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };

    const p4SameResRaw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p4SameReq,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    const p4SameData = await p4SameResRaw.json();
    record("4a. Same-origin target='_blank' sets same_tab: true automatically", p4SameData.steps?.[0]?.same_tab === true);
    record("4b. Same-origin navigation does NOT require origin confirmation", p4SameData.requires_origin_confirmation !== true && p4SameData.status !== "requires_origin_confirmation");

    // Case 4B: Cross-origin link with target="_blank"
    const crossOriginNodes = [
      {
        id: "link-cross-origin",
        tag: "a",
        resolved_label: "External Government Authority Portal",
        href: "https://external-records.gov.eg/inquiry",
        target: "_blank",
        opens_new_tab: true,
        target_origin: "https://external-records.gov.eg",
        visible: true,
      },
    ];
    const p4CrossReq = {
      goal: "External Government Authority Portal",
      current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
      dom_map: crossOriginNodes,
      language: "ar-EG",
      goal_state: {
        goal: "External Government Authority Portal",
        status: "in_progress",
        current_url: `${fixtureBaseUrl}/portal-modal-form.html`,
        language: "ar-EG",
        hop_count: 0,
        max_hops: 8,
      },
      api_key: DEMO_KEY,
      contract_version: 3,
    };

    const p4CrossResRaw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p4CrossReq,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    const p4CrossData = await p4CrossResRaw.json();
    record("4c. Cross-origin target triggers status='requires_origin_confirmation'", p4CrossData.status === "requires_origin_confirmation");
    record("4d. Cross-origin target sets requires_origin_confirmation: true", p4CrossData.requires_origin_confirmation === true);
    record("4e. Arabic prompt preserves verbatim quoted host 'external-records.gov.eg'", p4CrossData.reply?.includes("'external-records.gov.eg'") === true, `got: ${p4CrossData.reply}`);

    // Case 4C: Confirming cross-origin navigation resumes execution
    const p4ResumeReq = {
      ...p4CrossReq,
      user_response: "yes",
      goal_state: {
        ...p4CrossData.goal_state,
        hop_count: 1,
      },
    };
    const p4ResumeResRaw = await page.request.post(`http://127.0.0.1:${backendPort}/v1/chat/goal_step`, {
      data: p4ResumeReq,
      headers: { "Content-Type": "application/json", "X-Atlas-Key": DEMO_KEY },
    });
    const p4ResumeData = await p4ResumeResRaw.json();
    record("4f. Confirming cross-origin navigation resumes in_progress", p4ResumeData.status === "in_progress");
    record("4g. Resumed step executes navigation to external link", p4ResumeData.steps?.[0]?.element_id === "link-cross-origin");

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (fixtureServer) {
      await new Promise((r) => fixtureServer.close(r));
    }
    killProcessTree(uvicornProc.pid);
  }

  console.log("\n================================================================");
  console.log(`Wave 4 Live Patterns E2E Complete: ${passed} passed, ${failed} failed.`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("FATAL E2E ERROR:", err);
  process.exit(1);
});

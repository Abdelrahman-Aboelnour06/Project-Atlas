/**
 * ci/e2e/test_ws7_slots_e2e.js
 * Real-Browser Playwright E2E Suite for WS7 Slots and Forms (Contract v3 & Secret Vault Tokenization).
 *
 * Verifies in real headless Chromium on demo-site/portal-inquiry.html:
 * 1. Store placeholder national ID (00000000000000) in Secret Vault -> returns token.
 * 2. Fill form inputs using AtlasExecutor.executeStep (token on national-id, non-tokens on plates).
 * 3. Serialize DOM using AtlasSerializer.serialize().
 * 4. Invariants:
 *    - Zero 14-digit runs anywhere in the serialized JSON.
 *    - The national-id input current_value equals the token and sensitive is true.
 *    - Passing the serialized dom_map to backend goal_step returns requires_confirmation (not a re-ask).
 */

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const PORT = 5595;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, "../..");
const CLIENT_DIR = path.join(ROOT_DIR, "client-script");
const DEMO_DIR = path.join(ROOT_DIR, "demo-site");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function runTest(name, fn) {
  return fn()
    .then(() => {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
      failed++;
    });
}

// ── Static File Server for Fixtures ──────────────────────────────────────────
function createFixtureServer(port) {
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    let safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "/" || safePath === "\\") safePath = "/portal-inquiry.html";

    const filePath = path.join(DEMO_DIR, safePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runSuite() {
  console.log("================================================================");
  console.log("   Playwright E2E WS7 Slots, Tokens & Serializer Integrity Suite");
  console.log("================================================================\n");

  const server = await createFixtureServer(PORT);
  console.log(`[E2E] Fixture server running at ${BASE_URL}`);

  const secretVaultSrc = fs.readFileSync(path.join(CLIENT_DIR, "secret-vault.js"), "utf8");
  const serializerSrc = fs.readFileSync(path.join(CLIENT_DIR, "dom-serializer.js"), "utf8");
  const executorSrc = fs.readFileSync(path.join(CLIENT_DIR, "executor.js"), "utf8");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const context = await browser.newContext({
    locale: "ar-EG",
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();

    // Mock chrome.storage.local in page before extensions scripts run
    await page.addInitScript(() => {
      const store = {};
      window.chrome = {
        storage: {
          local: {
            get: (keys, cb) => {
              const res = {};
              if (!keys) Object.assign(res, store);
              else if (Array.isArray(keys)) {
                for (const k of keys) if (k in store) res[k] = store[k];
              } else if (typeof keys === "string") {
                if (keys in store) res[keys] = store[keys];
              }
              if (cb) cb(res);
              return Promise.resolve(res);
            },
            set: (items, cb) => {
              Object.assign(store, items);
              if (cb) cb();
              return Promise.resolve();
            },
            remove: (keys, cb) => {
              const arr = Array.isArray(keys) ? keys : [keys];
              for (const k of arr) delete store[k];
              if (cb) cb();
              return Promise.resolve();
            },
          },
        },
      };
    });

    await page.goto(`${BASE_URL}/portal-inquiry.html`, { waitUntil: "domcontentloaded" });

    // Inject Atlas client modules
    await page.addScriptTag({ content: secretVaultSrc });
    await page.addScriptTag({ content: serializerSrc });
    await page.addScriptTag({ content: executorSrc });

    let token = null;
    let serializedDomMap = null;

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Initial State & Identity Field Sensitivity Discovery
    // ──────────────────────────────────────────────────────────────────────────
    await runTest("Initial serialization marks national-id as sensitive with null current_value", async () => {
      const initialDom = await page.evaluate(() => window.AtlasSerializer.serialize());
      const nidNode = initialDom.find(
        (n) => n.name === "national_id" || (n.resolved_label && n.resolved_label.includes("الرقم القومي"))
      );
      assert(nidNode != null, "National ID field detected in initial DOM map");
      assert(nidNode.sensitive === true, "Unfilled National ID marked sensitive: true");
      assert(nidNode.current_value === null, "Unfilled National ID has current_value: null");
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Secret Vault Store & Executor Tokenized Fill
    // ──────────────────────────────────────────────────────────────────────────
    await runTest("Store placeholder ID in vault and fill form via executor", async () => {
      const origin = await page.evaluate(() => window.location.origin);
      token = await page.evaluate(async (orig) => {
        return await window.AtlasSecretVault.store(orig, "secret", "national_id", "00000000000000");
      }, origin);

      assert(typeof token === "string" && token.startsWith("{") && token.endsWith("}"), `Stored token valid: ${token}`);

      // Perform fills using AtlasExecutor
      await page.evaluate(async ({ nidToken }) => {
        const dom = window.AtlasSerializer.serialize();
        const nidNode = dom.find(
          (n) => n.name === "national_id" || (n.resolved_label && n.resolved_label.includes("الرقم القومي"))
        );
        const digitsNode = dom.find(
          (n) => n.name === "plate_digits" || (n.resolved_label && n.resolved_label.includes("أرقام اللوحة"))
        );
        const lettersNode = dom.find(
          (n) => n.name === "plate_letters" || (n.resolved_label && n.resolved_label.includes("حروف اللوحة"))
        );

        const nidEl = document.querySelector("#national-id");
        const digitsEl = document.querySelector("#plate-digits");
        const lettersEl = document.querySelector("#plate-letters");

        // Fill token into national-id
        await window.AtlasExecutor.executeStep(
          { action: "fill", element_id: nidNode.ref, value: nidToken },
          nidEl,
          { skipConfirmation: true }
        );

        // Fill plate digits and letters
        await window.AtlasExecutor.executeStep(
          { action: "fill", element_id: digitsNode.ref, value: "1234" },
          digitsEl,
          { skipConfirmation: true }
        );
        await window.AtlasExecutor.executeStep(
          { action: "fill", element_id: lettersNode.ref, value: "أ ب ج" },
          lettersEl,
          { skipConfirmation: true }
        );
      }, { nidToken: token });

      // Verify DOM input has plaintext value and data-atlas-token attribute
      const inputDetails = await page.evaluate(() => {
        const el = document.querySelector("#national-id");
        return {
          value: el.value,
          tokenAttr: el.getAttribute("data-atlas-token"),
        };
      });

      assert(inputDetails.value === "00000000000000", `Input value in DOM matches resolved plaintext: ${inputDetails.value}`);
      assert(inputDetails.tokenAttr === token, `Input has data-atlas-token attribute set to "${token}"`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Serializer Privacy Invariant & Token current_value
    // ──────────────────────────────────────────────────────────────────────────
    await runTest("AtlasSerializer emits token as current_value and zero raw digits in JSON", async () => {
      serializedDomMap = await page.evaluate(() => window.AtlasSerializer.serialize());
      const serializedJson = JSON.stringify(serializedDomMap);

      // Invariant A: No 14-digit run anywhere in the JSON
      assert(
        !/\b00000000000000\b/.test(serializedJson),
        "Invariant violated: 14-digit placeholder run found in serialized JSON!"
      );
      assert(
        !serializedJson.includes("00000000000000"),
        "Invariant violated: raw placeholder digits present anywhere in serialized JSON!"
      );

      // Invariant B: national-id current_value is the token and sensitive: true
      const filledNid = serializedDomMap.find(
        (n) => n.name === "national_id" || (n.resolved_label && n.resolved_label.includes("الرقم القومي"))
      );
      assert(filledNid != null, "National ID node present in filled DOM map");
      assert(filledNid.current_value === token, `national-id current_value is the token: "${filledNid.current_value}"`);
      assert(filledNid.sensitive === true, "national-id sensitive remains true");

      // Invariant C: plate fields have plain values
      const filledDigits = serializedDomMap.find(
        (n) => n.name === "plate_digits" || (n.resolved_label && n.resolved_label.includes("أرقام اللوحة"))
      );
      assert(filledDigits.current_value === "1234", `plate_digits current_value is "1234"`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Backend goal_step with Filled DOM Returns requires_confirmation
    // ──────────────────────────────────────────────────────────────────────────
    await runTest("Backend goal_step with token-filled dom_map returns requires_confirmation", async () => {
      const tempJsonFile = path.join(os.tmpdir(), `dom_map_${Date.now()}.json`);
      fs.writeFileSync(tempJsonFile, JSON.stringify(serializedDomMap), "utf8");

      const pyCode = `
import asyncio, json, sys, os
from unittest.mock import AsyncMock, patch

# Add backend directory to sys.path
repo_root = r"${ROOT_DIR.replace(/\\/g, "\\\\")}"
backend_dir = os.path.join(repo_root, "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.models.goal import GoalState, GoalStepRequest, Milestone
from app.routes.chat import goal_step_endpoint

async def main():
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        dom_map = json.load(f)

    state = GoalState(
        goal="اريد الاستعلام عن المخالفات",
        status="in_progress",
        page_kind="form",
        language="ar-EG",
        milestones=[Milestone(id="m1", description="submit form", status="active")],
        active_milestone_id="m1",
    )
    req = GoalStepRequest(
        goal=state.goal,
        current_url="${BASE_URL}/portal-inquiry.html",
        dom_map=dom_map,
        goal_state=state,
        api_key="valid_test_key",
        contract_version=3,
    )
    with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \\
         patch("app.routes.chat.rate_limiter.check", return_value=True):
        mock_auth.return_value = "tenant-1"
        resp = await goal_step_endpoint(payload=req, db=AsyncMock())
        result = {
            "status": resp.status,
            "requires_confirmation": bool(resp.requires_confirmation),
            "pending_step_element_id": resp.pending_step.element_id if resp.pending_step else None,
            "reply": resp.reply,
            "steps": [s.dict() for s in resp.steps],
        }
        print("__RESULT_JSON__" + json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
`;

      const pyExe = process.platform === "win32"
        ? path.join(ROOT_DIR, "backend", "venv", "Scripts", "python.exe")
        : path.join(ROOT_DIR, "backend", "venv", "bin", "python");
      const pythonCmd = fs.existsSync(pyExe) ? pyExe : "python";

      const res = spawnSync(pythonCmd, ["-c", pyCode, tempJsonFile], {
        cwd: path.join(ROOT_DIR, "backend"),
        encoding: "utf-8",
        env: { ...process.env, LLM_PROVIDER: "mock" },
      });

      try {
        fs.unlinkSync(tempJsonFile);
      } catch (_) {}

      if (res.status !== 0) {
        throw new Error(`Python execution failed (code ${res.status}):\n${res.stderr || res.stdout}`);
      }

      const match = res.stdout.match(/__RESULT_JSON__([\s\S]+)$/);
      assert(match != null, `Failed to parse Python result from output:\n${res.stdout}`);

      const backendResult = JSON.parse(match[1].trim());
      for (const step of backendResult.steps || []) {
        const found = serializedDomMap.find(n => n.ref === step.element_id || n.id === step.element_id);
        console.log("STEP TARGET NODE:", JSON.stringify(found));
      }
      assert(
        backendResult.status === "requires_confirmation",
        `Expected status="requires_confirmation", got "${backendResult.status}". Reply: "${backendResult.reply}"`
      );
      assert(backendResult.requires_confirmation === true, "Expected requires_confirmation=true");
      assert(backendResult.pending_step_element_id != null, "Expected pending_step targeting submit button");
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\nWS7 Slots E2E Complete: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error("Unhandled error during WS7 E2E suite:", err);
  process.exit(1);
});

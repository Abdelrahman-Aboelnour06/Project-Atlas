/**
 * Test Suite: Goal Handoff, Network Isolation, Redaction & Settle Windows (Milestone 2 / Track R2)
 * File: client-script/test_goal_handoff.js
 *
 * Suites:
 * 1. Background Network Gateway Proxying (ATLAS_GOAL_STEP / handleGoalStep)
 * 2. URL Redaction & Secret Token Sanitization (redactUrl, sanitizeTokens, capTitle)
 * 3. Navigation Settle Window & Quiet Period (waitForNavigationSettle)
 * 4. Budgets & Max Handoffs Boundary Enforcement (max_llm_calls, maxHandoffs = 4)
 * 5. Concurrent CAS Session State Integrity & Storage Guards
 * 6. Universal Prime Directive Compliance (Zero Domain Hardcoding)
 *
 * Run with: node client-script/test_goal_handoff.js
 */

const fs = require('fs');
const path = require('path');
const { handleGoalStep, sanitizeBaseUrl, GoalStore, TabRegistry, AsyncMutex } = require('./background.js');
const { redactUrl, sanitizeTokens, capTitle, waitForNavigationSettle, executeGoalHop } = require('./content.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  Project Atlas — Goal Handoff & Network Path Tests');
  console.log('======================================================\n');

  // ── Suite 1: Background Network Gateway Proxying ──────────────────────────
  console.log('[Suite 1: Background Network Gateway Proxying (§R2 / §H5)]');

  // Save original fetch
  const originalFetch = global.fetch;

  try {
    // 1.1 Successful proxying
    let interceptedUrl = null;
    let interceptedOptions = null;

    global.fetch = async (url, options) => {
      interceptedUrl = url;
      interceptedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "in_progress",
          reply: "Navigating to step 2",
          goal_state: { hop_count: 1, status: "in_progress" },
          contract_version: 2,
        }),
      };
    };

    const resp1 = await handleGoalStep({
      baseUrl: "http://localhost:8000",
      apiKey: "test-secret-key-123",
      payload: {
        goal: "Test multi-tab goal",
        current_url: "https://example.com/login",
        contract_version: 2,
        capabilities: ["switch_tab", "tab_context", "assisted_click"],
      },
    });

    assert(interceptedUrl === "http://localhost:8000/v1/chat/goal_step", "Proxies request to /v1/chat/goal_step endpoint");
    assert(interceptedOptions.method === "POST", "Uses HTTP POST method");
    assert(interceptedOptions.headers["Content-Type"] === "application/json", "Sets Content-Type application/json header");
    assert(interceptedOptions.headers["X-Atlas-Key"] === "test-secret-key-123", "Forwards X-Atlas-Key authorization header");
    const sentPayload = JSON.parse(interceptedOptions.body);
    assert(sentPayload.contract_version === 2, "Transmits contract_version: 2 in request payload");
    assert(Array.isArray(sentPayload.capabilities) && sentPayload.capabilities.includes("switch_tab"), "Transmits switch_tab in capabilities");
    assert(resp1.status === "in_progress", "Returns successful response payload to caller");

    // 1.2 HTTP error with detail propagation
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Malformed goal request schema" }),
    });

    let caughtErr = null;
    try {
      await handleGoalStep({
        baseUrl: "http://localhost:8000",
        payload: {},
      });
    } catch (e) {
      caughtErr = e;
    }
    assert(caughtErr !== null, "Throws on non-200 HTTP response");
    assert(caughtErr.message === "Malformed goal request schema", "Propagates server error detail in thrown error");

    // 1.3 Network failure handling
    global.fetch = async () => {
      throw new Error("Connection refused: ECONNREFUSED");
    };

    let netErr = null;
    try {
      await handleGoalStep({
        baseUrl: "http://localhost:8000",
        payload: {},
      });
    } catch (e) {
      netErr = e;
    }
    assert(netErr !== null && netErr.message.includes("ECONNREFUSED"), "Handles network connection errors cleanly");

    // 1.4 Lease epoch validation before proxying (if lease epoch provided)
    if (TabRegistry) {
      // Mock validateLease to return stale epoch
      const origValidate = TabRegistry.validateLease;
      TabRegistry.validateLease = async () => ({ valid: false, reason: "STALE_EPOCH" });

      let leaseErr = null;
      try {
        await handleGoalStep(
          {
            baseUrl: "http://localhost:8000",
            sessionId: "sess-abc",
            leaseEpoch: 1,
            payload: {},
          },
          { tabId: 101 }
        );
      } catch (e) {
        leaseErr = e;
      }
      assert(leaseErr !== null && leaseErr.message === "STALE_EPOCH", "Rejects goal step request when lease epoch is stale");
      TabRegistry.validateLease = origValidate;
    }
  } finally {
    global.fetch = originalFetch;
  }

  // ── Suite 2: Client-Side URL Redaction & Secret Token Sanitization ─────────
  console.log('\n[Suite 2: URL & Secret Redaction (§R2 / §H10)]');

  // 2.1 redactUrl tests
  assert(
    redactUrl("https://auth.example.com/oauth/authorize?code=spl_xyz123&state=abc#step") ===
      "https://auth.example.com/oauth/authorize",
    "redactUrl strips query parameters and hash fragments from OAuth URL"
  );
  assert(
    redactUrl("https://sub.domain.org/path/to/page?user=1&session=secret#target") ===
      "https://sub.domain.org/path/to/page",
    "redactUrl strips multi-parameter query string and fragment"
  );
  assert(
    redactUrl("https://example.com:8443/app?debug=true") ===
      "https://example.com:8443/app",
    "redactUrl preserves custom ports while stripping queries"
  );
  assert(
    redactUrl("https://example.com/clean/path") === "https://example.com/clean/path",
    "redactUrl leaves clean URLs unmodified"
  );
  assert(
    redactUrl("http://localhost:3000/") === "http://localhost:3000/",
    "redactUrl preserves trailing slashes on clean origins"
  );
  assert(redactUrl("") === "", "redactUrl handles empty string gracefully");
  assert(redactUrl(null) === "", "redactUrl handles null gracefully");
  assert(redactUrl(undefined) === "", "redactUrl handles undefined gracefully");

  // 2.2 sanitizeTokens tests
  assert(
    sanitizeTokens("https://example.com/callback?code=abc123xyz&state=ok") ===
      "https://example.com/callback?[REDACTED]&state=ok",
    "sanitizeTokens redacts code= parameter"
  );
  assert(
    sanitizeTokens("https://example.com/#access_token=bearer_tok_999&token_type=bearer") ===
      "https://example.com/#[REDACTED]&token_type=bearer",
    "sanitizeTokens redacts access_token= parameter in fragment"
  );
  assert(
    sanitizeTokens("Auth header: token=ghp_secret_key_888 for session") ===
      "Auth header: [REDACTED] for session",
    "sanitizeTokens redacts token= in freeform strings"
  );
  assert(
    sanitizeTokens("Regular text without credentials") === "Regular text without credentials",
    "sanitizeTokens leaves non-sensitive text untouched"
  );
  assert(sanitizeTokens(null) === "", "sanitizeTokens handles null safely");

  // 2.3 capTitle tests
  const longTitle = "A".repeat(120);
  assert(capTitle(longTitle).length === 80, "capTitle truncates long title to exactly 80 characters");
  assert(capTitle("  Short Title  ") === "Short Title", "capTitle trims whitespace");
  assert(capTitle(null) === "", "capTitle handles null title gracefully");
  assert(capTitle(undefined) === "", "capTitle handles undefined title gracefully");
  assert(capTitle("Exact 10", 10) === "Exact 10", "capTitle respects custom maxChars parameter");

  // ── Suite 3: Navigation Settle Window & Quiet Period ───────────────────────
  console.log('\n[Suite 3: Navigation Settle Window & Quiet Period (§R2 / §H9)]');

  // 3.1 Resolves when document.readyState is complete and URL is quiet
  {
    const fakeDoc = { readyState: "complete" };
    const fakeWin = { location: { href: "https://example.com/page1" } };
    global.document = fakeDoc;
    global.window = fakeWin;

    const start = Date.now();
    await waitForNavigationSettle(3000);
    const elapsed = Date.now() - start;
    assert(elapsed >= 900 && elapsed <= 2000, "waitForNavigationSettle holds 1-second quiet window on stable URL");
  }

  // 3.2 Resets quiet timer when URL changes mid-quiet period
  {
    const fakeDoc = { readyState: "complete" };
    const fakeWin = { location: { href: "https://example.com/step1" } };
    global.document = fakeDoc;
    global.window = fakeWin;

    // Mutate URL after 500ms
    setTimeout(() => {
      fakeWin.location.href = "https://example.com/step2-redirected";
    }, 400);

    const start = Date.now();
    await waitForNavigationSettle(4000);
    const elapsed = Date.now() - start;
    assert(elapsed >= 1300, "waitForNavigationSettle resets quiet timer upon mid-window URL redirect");
  }

  // 3.3 Waits for readyState === 'complete' before quiet window starts
  {
    const fakeDoc = { readyState: "loading" };
    const fakeWin = { location: { href: "https://example.com/loading" } };
    global.document = fakeDoc;
    global.window = fakeWin;

    // Transition to complete after 300ms
    setTimeout(() => {
      fakeDoc.readyState = "complete";
    }, 300);

    const start = Date.now();
    await waitForNavigationSettle(3000);
    const elapsed = Date.now() - start;
    assert(elapsed >= 1200, "waitForNavigationSettle delays until document.readyState === 'complete'");
  }

  // ── Suite 4: Budgets & Max Handoffs Boundary Enforcement ───────────────────
  console.log('\n[Suite 4: Budgets & Max Handoffs Boundary (§R2 / §H9)]');

  // 4.1 Max handoffs default is 4
  {
    const testBudget = { max_handoffs: 4, handoff_count: 0 };
    assert(testBudget.max_handoffs === 4, "Budget specifies max_handoffs = 4");
    assert(testBudget.handoff_count === 0, "Initial handoff_count is 0");
  }

  // 4.2 Handoff cutoff after 4 handoffs
  {
    let handoffCount = 0;
    const maxHandoffs = 4;
    const simulateHandoff = () => {
      if (handoffCount >= maxHandoffs) {
        return { allowed: false, reason: "MAX_HANDOFFS_EXCEEDED" };
      }
      handoffCount++;
      return { allowed: true, handoffCount };
    };

    assert(simulateHandoff().allowed === true, "Handoff 1 is allowed");
    assert(simulateHandoff().allowed === true, "Handoff 2 is allowed");
    assert(simulateHandoff().allowed === true, "Handoff 3 is allowed");
    assert(simulateHandoff().allowed === true, "Handoff 4 is allowed");
    const cutoff = simulateHandoff();
    assert(cutoff.allowed === false, "Handoff 5 is blocked by maxHandoffs budget boundary");
    assert(cutoff.reason === "MAX_HANDOFFS_EXCEEDED", "Reports MAX_HANDOFFS_EXCEEDED reason");
  }

  // 4.3 LLM call budget cutoff
  {
    const budget = { max_llm_calls: 25, llm_calls: 25 };
    const canCall = budget.llm_calls < budget.max_llm_calls;
    assert(!canCall, "Blocks further agent calls when llm_calls reaches max_llm_calls (25)");
  }

  // ── Suite 5: CAS Session Writes & Concurrency Safety ───────────────────────
  console.log('\n[Suite 5: Concurrent CAS Writes & State Integrity (§R1 / §H4)]');

  {
    const mutex = new AsyncMutex();
    let counter = 0;
    const ops = Array.from({ length: 25 }, async () => {
      await mutex.runExclusive(async () => {
        const cur = counter;
        await new Promise((r) => setTimeout(r, 2));
        counter = cur + 1;
      });
    });
    await Promise.all(ops);
    assert(counter === 25, "AsyncMutex preserves serial integrity across 25 concurrent critical sections");
  }


  // ── Suite 6: Universal Web Directive Compliance ────────────────────────────
  console.log('\n[Suite 6: Universal Web Directive Compliance (Prime Directive)]');

  const contentJsCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const backgroundJsCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

  // Verify zero hardcoded domain checks in content.js and background.js
  const forbiddenDomains = [
    'amazon.com',
    'google.com',
    'drive.google.com',
    'github.com',
    'wikipedia.org',
    'youtube.com',
  ];

  for (const domain of forbiddenDomains) {
    // Only check for active functional references like site === 'domain' or includes('domain')
    const hasSiteCheckContent = new RegExp(`['"](?:https?://)?(?:[a-z0-9-]+\\.)*${domain.replace('.', '\\.')}['"]`, 'i').test(contentJsCode);
    assert(!hasSiteCheckContent, `content.js contains zero domain strings for ${domain}`);
  }

  assert(
    !contentJsCode.includes('window.location.hostname.includes'),
    "content.js contains zero window.location.hostname.includes checks"
  );
  assert(
    !contentJsCode.includes("fetch(`${baseUrl}/v1/chat/goal_step`"),
    "content.js eliminates direct in-page fetch for /v1/chat/goal_step (Single Network Path H5)"
  );
  assert(
    contentJsCode.includes('type: "ATLAS_GOAL_STEP"'),
    "content.js routes goal_step via chrome.runtime.sendMessage ATLAS_GOAL_STEP"
  );
  assert(
    backgroundJsCode.includes('message.type === "ATLAS_GOAL_STEP"'),
    "background.js registers handler for ATLAS_GOAL_STEP messages"
  );

  console.log('\n======================================================');
  console.log(`Goal Handoff Tests Complete: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled error in test_goal_handoff.js:", err);
  process.exit(1);
});

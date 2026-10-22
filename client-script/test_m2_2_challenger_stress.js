/**
 * Milestone 2.2 Challenger Stress & Resilience Test Suite
 * File: client-script/test_m2_2_challenger_stress.js
 *
 * Empirical Challenger M2.2 Harness attacking:
 * 1. Handoff & Budget Stress (maxHandoffs=4, runaway handoff loops)
 * 2. Navigation Settle Window Quiet Period (DOM mutation vs URL settle, abort signals)
 * 3. CORS & Network Path Audit (direct fetch in content scripts, lease epoch enforcement)
 * 4. Contract Schema & Universal Compliance
 *
 * Run with: node client-script/test_m2_2_challenger_stress.js
 */

const fs = require('fs');
const path = require('path');
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

function noteFinding(id, title, details) {
  empiricalFindings.push({ id, title, details });
}

// ── Mock Helper for Storage Session ──────────────────────────────────────────
class MockStorageSession {
  constructor(initialData = {}) {
    this._data = new Map(Object.entries(initialData));
  }
  async get(keys) {
    const res = {};
    const keyArr = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
    for (const k of keyArr) {
      if (this._data.has(k)) {
        res[k] = JSON.parse(JSON.stringify(this._data.get(k)));
      }
    }
    return res;
  }
  async set(items) {
    for (const [k, v] of Object.entries(items)) {
      this._data.set(k, JSON.parse(JSON.stringify(v)));
    }
  }
  async remove(keys) {
    const keyArr = Array.isArray(keys) ? keys : [keys];
    for (const k of keyArr) {
      this._data.delete(k);
    }
  }
}

async function runMilestone2_2ChallengerSuite() {
  console.log('\n===============================================================');
  console.log('  MILESTONE 2.2 EMPIRICAL CHALLENGER STRESS HARNESS  ');
  console.log('===============================================================\n');

  // Load modules
  const { handleGoalStep, sanitizeBaseUrl } = require('./background.js');
  const { TabRegistry, TabRegistryImpl } = require('./tab-registry.js');
  const { redactUrl, sanitizeTokens, capTitle, waitForNavigationSettle, executeGoalHop } = require('./content.js');

  // =========================================================================
  // DOMAIN 1: Handoff & Budget Boundary Stress (maxHandoffs=4)
  // =========================================================================
  console.log('[Domain 1: Handoff & Budget Boundary Stress (maxHandoffs=4)]');

  // 1.1: Direct boundary check at handoff_count >= maxHandoffs
  {
    let sendMessageCalls = 0;
    const mockChrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          sendMessageCalls++;
          if (cb) cb({ ok: true, data: { status: 'in_progress' } });
        },
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ atlas_api_key: 'test_key', atlas_backend_url: 'http://localhost:8000' }),
        },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    };

    const mockSidebar = {
      setExecuting: () => {},
      setGoalProgress: () => {},
      hideGoalProgress: () => {},
      removeThinking: () => {},
      setStatus: () => {},
      addChatMessage: () => {},
    };

    global.chrome = mockChrome;
    global.window = {
      AtlasSidebar: mockSidebar,
      AtlasSerializer: { serialize: () => ({ nodes: {}, count: 0 }) },
      AtlasExecutor: { executeStep: async () => {} },
      AtlasTTS: { stop: () => {} },
      AtlasSpeech: { stop: () => {} },
      location: { href: 'http://example.com/page' },
      addEventListener: () => {},
    };
    global.document = {
      readyState: 'complete',
      addEventListener: () => {},
      querySelectorAll: () => [],
    };

    delete require.cache[require.resolve('./content.js')];
    const freshContent = require('./content.js');

    const exhaustedGoal = {
      goal: 'Order items across multiple tabs',
      status: 'in_progress',
      budget: {
        max_handoffs: 4,
        handoff_count: 4, // Budget already exhausted
      },
    };

    sendMessageCalls = 0;
    await freshContent.executeGoalHop(exhaustedGoal);

    // If maxHandoffs halts execution, it must NOT send ATLAS_GOAL_STEP
    const haltedImmediately = sendMessageCalls === 0;
    record(
      'M2.2-STRESS-01: executeGoalHop halts immediately when handoff_count >= maxHandoffs (0 messages sent)',
      haltedImmediately,
      `Sent ${sendMessageCalls} messages despite handoff_count=4 >= max_handoffs=4`
    );

    if (!haltedImmediately) {
      noteFinding(
        'FINDING-01',
        'executeGoalHop does not halt when handoff_count >= max_handoffs',
        'client-script/content.js:197-199 logs console.warn("Atlas: Maximum tab handoffs reached") but does NOT return or set isExecuting=false. It proceeds to serialize DOM and send ATLAS_GOAL_STEP.'
      );
    }
  }

  // 1.2: Rapid succession of 5 tab handoffs terminating runaway handoff loops
  {
    let hopCount = 0;
    let maxHopsReached = false;
    const maxAllowedHops = 10; // Safety threshold

    const mockChrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          if (msg.type === 'ATLAS_GOAL_STEP') {
            hopCount++;
            if (hopCount > maxAllowedHops) {
              maxHopsReached = true;
              if (cb) cb({ ok: false, error: 'ABORT_INFINITE_LOOP' });
              return;
            }
            // Backend returns switch_tab_id with in_progress status
            if (cb) {
              cb({
                ok: true,
                data: {
                  switch_tab_id: 100 + hopCount,
                  reply: `Switching to tab ${100 + hopCount}`,
                  goal_state: {
                    status: 'in_progress',
                    budget: {
                      max_handoffs: 4,
                      handoff_count: hopCount,
                    },
                  },
                },
              });
            }
          } else {
            if (cb) cb({ ok: true });
          }
        },
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ atlas_api_key: 'test_key', atlas_backend_url: 'http://localhost:8000' }),
        },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    };

    global.chrome = mockChrome;
    global.window = {
      AtlasSidebar: {
        setExecuting: () => {},
        setGoalProgress: () => {},
        hideGoalProgress: () => {},
        removeThinking: () => {},
        setStatus: () => {},
        addChatMessage: () => {},
      },
      AtlasSerializer: { serialize: () => ({ nodes: {}, count: 0 }) },
      AtlasExecutor: { executeStep: async () => {} },
      AtlasTTS: { stop: () => {} },
      AtlasSpeech: { stop: () => {} },
      location: { href: 'http://example.com/page' },
      addEventListener: () => {},
    };
    global.document = {
      readyState: 'complete',
      addEventListener: () => {},
      querySelectorAll: () => [],
    };

    delete require.cache[require.resolve('./content.js')];
    const freshContent = require('./content.js');

    const multiHandoffGoal = {
      goal: 'Navigate across 5 tabs',
      status: 'in_progress',
      budget: {
        max_handoffs: 4,
        handoff_count: 0,
      },
    };

    hopCount = 0;
    try {
      await freshContent.executeGoalHop(multiHandoffGoal);
    } catch (_) {}

    const terminatedCleanly = hopCount <= 5 && !maxHopsReached;
    record(
      'M2.2-STRESS-02: Rapid succession of tab handoffs cleanly terminates at maxHandoffs=4',
      terminatedCleanly,
      `Executed ${hopCount} hops (maxAllowed: 5 before cutoff). Infinite recursion triggered: ${maxHopsReached}`
    );

    if (!terminatedCleanly) {
      noteFinding(
        'FINDING-02',
        'Runaway handoff loop: maxHandoffs does not break the execution loop when status is in_progress',
        `When backend returns switch_tab_id and in_progress status, handoff_count increment stops at maxHandoffs in content.js:313, but line 325 unconditionally recurses: await executeGoalHop(data.goal_state). Total hops executed: ${hopCount}.`
      );
    }
  }

  // 1.3: LLM call budget cutoff
  {
    let messagesSent = 0;
    const mockChrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          messagesSent++;
          if (cb) cb({ ok: true, data: { status: 'in_progress' } });
        },
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ atlas_api_key: 'test_key', atlas_backend_url: 'http://localhost:8000' }),
        },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    };

    global.chrome = mockChrome;
    delete require.cache[require.resolve('./content.js')];
    const freshContent = require('./content.js');

    const budgetExceededGoal = {
      goal: 'Test LLM budget cutoff',
      status: 'in_progress',
      budget: {
        max_llm_calls: 10,
        llm_calls: 10,
      },
    };

    messagesSent = 0;
    await freshContent.executeGoalHop(budgetExceededGoal);
    record(
      'M2.2-STRESS-03: executeGoalHop halts cleanly when llm_calls reaches max_llm_calls',
      messagesSent === 0,
      `Messages sent: ${messagesSent}`
    );
  }

  // =========================================================================
  // DOMAIN 2: Navigation Settle Window Quiet Period & Mutation Stress
  // =========================================================================
  console.log('\n[Domain 2: Settle Window Quiet Period & Mutation Stress (§R2 / §H9)]');

  // 2.1: Settle window under continuous DOM mutations
  {
    let domMutations = 0;
    const fakeDoc = {
      readyState: 'complete',
      body: { innerHTML: '<div>Initial DOM</div>' },
    };
    const fakeWin = {
      location: { href: 'https://example.com/checkout' },
    };

    global.document = fakeDoc;
    global.window = fakeWin;

    // Simulate DOM mutations every 150ms for 2.5 seconds
    const mutationInterval = setInterval(() => {
      domMutations++;
      fakeDoc.body.innerHTML = `<div>Mutated ${domMutations}</div>`;
    }, 150);

    const start = Date.now();
    await waitForNavigationSettle(4000);
    const elapsed = Date.now() - start;
    clearInterval(mutationInterval);

    // If settle window observed DOM quiet period, it should have waited
    const waitedForDomQuiet = elapsed >= 3000;
    record(
      'M2.2-STRESS-04: Settle window quiet period tracks DOM mutations during navigation (waits for quiet period)',
      waitedForDomQuiet,
      `waitForNavigationSettle resolved after ${elapsed}ms while DOM was actively mutating (${domMutations} mutations). It only checks window.location.href.`
    );

    if (!waitedForDomQuiet) {
      noteFinding(
        'FINDING-03',
        'waitForNavigationSettle does not observe DOM mutations',
        `waitForNavigationSettle (content.js:159-182) only polls window.location.href for changes. If the URL is stable but the DOM is rapidly mutating during client-side hydration, it resolves after exactly 1000ms without waiting for DOM quiet.`
      );
    }
  }

  // 2.2: Settle window URL redirect reset stress (3 consecutive redirects)
  {
    const fakeDoc = { readyState: 'complete' };
    const fakeWin = { location: { href: 'https://auth.example.com/step1' } };
    global.document = fakeDoc;
    global.window = fakeWin;

    // 3 rapid redirects
    setTimeout(() => { fakeWin.location.href = 'https://auth.example.com/step2'; }, 200);
    setTimeout(() => { fakeWin.location.href = 'https://auth.example.com/step3'; }, 500);
    setTimeout(() => { fakeWin.location.href = 'https://auth.example.com/final'; }, 900);

    const start = Date.now();
    await waitForNavigationSettle(5000);
    const elapsed = Date.now() - start;

    const correctlyReset = elapsed >= 1850 && elapsed <= 2500;
    record(
      'M2.2-STRESS-05: Settle window quiet timer resets upon multiple rapid URL redirects (>=1900ms total)',
      correctlyReset,
      `Elapsed: ${elapsed}ms (expected >= 1850ms)`
    );
  }

  // 2.3: Settle window abort signal responsiveness
  {
    const fakeDoc = { readyState: 'loading' };
    const fakeWin = { location: { href: 'https://example.com/hang' } };
    global.document = fakeDoc;
    global.window = fakeWin;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const start = Date.now();
    await waitForNavigationSettle(5000, controller.signal);
    const elapsed = Date.now() - start;

    record(
      'M2.2-STRESS-06: Settle window aborts immediately on AbortSignal (<400ms)',
      elapsed < 400,
      `Elapsed: ${elapsed}ms`
    );
  }

  // 2.4: Settle window timeout fallback
  {
    const fakeDoc = { readyState: 'loading' };
    const fakeWin = { location: { href: 'https://example.com/never-completes' } };
    global.document = fakeDoc;
    global.window = fakeWin;

    const start = Date.now();
    await waitForNavigationSettle(800);
    const elapsed = Date.now() - start;

    record(
      'M2.2-STRESS-07: Settle window exits cleanly when readyState hangs after timeoutMs',
      elapsed >= 750 && elapsed <= 1100,
      `Elapsed: ${elapsed}ms (expected ~800ms)`
    );
  }

  // =========================================================================
  // DOMAIN 3: CORS & Network Path Audit
  // =========================================================================
  console.log('\n[Domain 3: CORS & Network Path Enforcement (§R2 / §H5)]');

  // 3.1: Static audit of content scripts for direct backend fetch calls
  {
    const contentJsPath = path.join(__dirname, 'content.js');
    const contentJs = fs.readFileSync(contentJsPath, 'utf8');

    // Audit for direct fetch to goal_step
    const hasDirectGoalStepFetch =
      /fetch\s*\(\s*`?\$\{baseUrl\}[^`)]*goal_step/i.test(contentJs) ||
      contentJs.includes('fallbackEndpoint = "/v1/chat" + "/goal_step"');

    record(
      'M2.2-STRESS-08: Zero direct fetch to /v1/chat/goal_step in content.js',
      !hasDirectGoalStepFetch,
      hasDirectGoalStepFetch
        ? 'content.js:284 contains fallback fetch using `const fallbackEndpoint = "/v1/chat" + "/goal_step"`'
        : 'None found'
    );

    if (hasDirectGoalStepFetch) {
      noteFinding(
        'FINDING-04',
        'Direct fetch to /v1/chat/goal_step exists in content.js fallback branch',
        'In client-script/content.js:284-295, when chrome.runtime.sendMessage is unavailable or in mock environment, content script executes direct fetch to `/v1/chat/goal_step` using string concatenation ("/v1/chat" + "/goal_step") to circumvent static checks.'
      );
    }
  }

  // 3.2: Fenced execution lease epoch validation in handleGoalStep
  {
    const originalFetch = global.fetch;
    let fetchCalled = false;
    let fetchUrl = null;

    global.fetch = async (url, options) => {
      fetchCalled = true;
      fetchUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', goal_state: { status: 'goal_complete' } }),
      };
    };

    try {
      const mockStorage = new MockStorageSession();
      const mockTabs = new Map();
      mockTabs.set(101, { id: 101, url: 'http://example.com/tab1' });
      mockTabs.set(102, { id: 102, url: 'http://example.com/tab2' });

      global.chrome = {
        storage: { session: mockStorage },
        tabs: {
          get: async (id) => mockTabs.get(id),
          reload: async () => {},
        },
      };

      const session = await TabRegistry.createSession({ rootTabId: 101, initialUrl: 'http://example.com/tab1' });
      const sessionId = session.sessionId;
      const initialEpoch = session.leaseEpoch;

      // Case 3.2.1: Valid lease epoch & lease holder tab -> Must allow network call
      fetchCalled = false;
      const res1 = await handleGoalStep(
        {
          baseUrl: 'http://localhost:8000',
          apiKey: 'key',
          sessionId,
          leaseEpoch: initialEpoch,
          payload: { goal: 'test' },
        },
        { tab: { id: 101 } }
      );
      record(
        'M2.2-STRESS-09: handleGoalStep allows network call for valid lease holder and matching epoch',
        fetchCalled && res1.status === 'success',
        `Fetch called: ${fetchCalled}`
      );

      // Case 3.2.2: Stale lease epoch -> Must reject before network call
      fetchCalled = false;
      let staleErr = null;
      try {
        await handleGoalStep(
          {
            baseUrl: 'http://localhost:8000',
            apiKey: 'key',
            sessionId,
            leaseEpoch: 999,
            payload: { goal: 'test' },
          },
          { tab: { id: 101 } }
        );
      } catch (e) {
        staleErr = e;
      }
      record(
        'M2.2-STRESS-10: handleGoalStep rejects stale epoch without making network call',
        !fetchCalled && staleErr !== null,
        `Fetch called: ${fetchCalled}, error: ${staleErr?.message}`
      );

      // Case 3.2.3: Non-lease-holder tab -> Must reject before network call
      fetchCalled = false;
      let nonHolderErr = null;
      try {
        await handleGoalStep(
          {
            baseUrl: 'http://localhost:8000',
            apiKey: 'key',
            sessionId,
            leaseEpoch: initialEpoch,
            payload: { goal: 'test' },
          },
          { tab: { id: 102 } }
        );
      } catch (e) {
        nonHolderErr = e;
      }
      record(
        'M2.2-STRESS-11: handleGoalStep rejects non-lease-holder tab without making network call',
        !fetchCalled && nonHolderErr !== null,
        `Fetch called: ${fetchCalled}, error: ${nonHolderErr?.message}`
      );

      // Case 3.2.4: Message with missing leaseEpoch on active session
      fetchCalled = false;
      let bypassErr = null;
      try {
        await handleGoalStep(
          {
            baseUrl: 'http://localhost:8000',
            apiKey: 'key',
            sessionId,
            // leaseEpoch omitted!
            payload: { goal: 'test' },
          },
          { tab: { id: 102 } }
        );
      } catch (e) {
        bypassErr = e;
      }

      const leaseValidationEnforced = !fetchCalled && bypassErr !== null;
      record(
        'M2.2-STRESS-12: handleGoalStep rejects message omitting leaseEpoch when sessionId is provided',
        leaseValidationEnforced,
        `Fetch called: ${fetchCalled} (Lease check was bypassed when leaseEpoch was omitted)`
      );

      if (!leaseValidationEnforced) {
        noteFinding(
          'FINDING-05',
          'handleGoalStep bypasses lease validation when leaseEpoch is omitted',
          'In background.js:359: `if (message?.leaseEpoch && message?.sessionId && TabRegistry)`. If a rogue tab sends sessionId but omits leaseEpoch (or passes leaseEpoch=0), the guard evaluates to false and lease validation is completely bypassed, making the backend network call.'
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  }

  // =========================================================================
  // DOMAIN 4: Contract Schema & Universal Compliance
  // =========================================================================
  console.log('\n[Domain 4: Contract Schema & Universal Compliance]');

  // 4.1: URL Redaction edge cases
  {
    const url1 = 'https://user:pass@example.com:8080/oauth/callback?code=SECRET123&state=abc#token=BEARER456';
    const redacted1 = redactUrl(url1);
    record(
      'M2.2-STRESS-13: redactUrl strips credentials, query tokens and hash tokens',
      !redacted1.includes('SECRET123') && !redacted1.includes('BEARER456') && !redacted1.includes('?'),
      `Result: ${redacted1}`
    );

    const textWithTokens = 'Error exchanging code=spl_xyz999 with access_token=tok_live_12345 in response';
    const sanitizedText = sanitizeTokens(textWithTokens);
    record(
      'M2.2-STRESS-14: sanitizeTokens masks code= and access_token= patterns',
      !sanitizedText.includes('spl_xyz999') && !sanitizedText.includes('tok_live_12345'),
      `Result: ${sanitizedText}`
    );

    const titleWithExcessiveLength = 'X'.repeat(300);
    const capped = capTitle(titleWithExcessiveLength);
    record(
      'M2.2-STRESS-15: capTitle caps arbitrary long strings to exactly 80 chars',
      capped.length === 80,
      `Length: ${capped.length}`
    );
  }

  // 4.2: Contract Schema Files on Disk
  {
    const reqSchemaPath = path.join(__dirname, '..', 'contracts', 'goal_step.request.schema.json');
    const resSchemaPath = path.join(__dirname, '..', 'contracts', 'goal_step.response.schema.json');

    const reqExists = fs.existsSync(reqSchemaPath);
    const resExists = fs.existsSync(resSchemaPath);

    record(
      'M2.2-STRESS-16: Schema contract files exist on disk in contracts/ directory',
      reqExists && resExists,
      `Request schema: ${reqExists}, Response schema: ${resExists}`
    );

    if (reqExists && resExists) {
      const reqSchema = JSON.parse(fs.readFileSync(reqSchemaPath, 'utf8'));
      const resSchema = JSON.parse(fs.readFileSync(resSchemaPath, 'utf8'));

      const reqHasTabContext = Boolean(reqSchema.properties?.tab_context);
      const reqHasVersion = Boolean(reqSchema.properties?.contract_version);
      const resHasSwitchTab = Boolean(resSchema.properties?.switch_tab_id);

      record(
        'M2.2-STRESS-17: Request & response schemas define v2 properties (tab_context, contract_version, switch_tab_id)',
        reqHasTabContext && reqHasVersion && resHasSwitchTab,
        `tab_context: ${reqHasTabContext}, contract_version: ${reqHasVersion}, switch_tab_id: ${resHasSwitchTab}`
      );
    }
  }

  // 4.3: Prime Directive Universal Rule Scan
  {
    const banned = [/amazon\.com/i, /google\.com/i, /wikipedia\.org/i, /window\.location\.hostname\.includes/i];
    const m2Files = [
      path.join(__dirname, 'background.js'),
      path.join(__dirname, 'content.js'),
      path.join(__dirname, '../backend/app/agent/sanitize.py'),
      path.join(__dirname, '../backend/app/models/goal.py'),
      path.join(__dirname, '../backend/app/models/action.py'),
    ];

    let violations = 0;
    for (const f of m2Files) {
      if (!fs.existsSync(f)) continue;
      const c = fs.readFileSync(f, 'utf8');
      for (const b of banned) {
        if (b.test(c)) violations++;
      }
    }
    record('M2.2-STRESS-18: Zero hardcoded domains across Milestone 2 production files', violations === 0);
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n===============================================================');
  console.log(`M2.2 Challenger Stress Suite: ${passed} passed, ${failed} failed.`);
  console.log(`Empirical Findings Discovered: ${empiricalFindings.length}`);
  console.log('===============================================================\n');

  if (empiricalFindings.length > 0) {
    console.log('--- EMPIRICAL FINDINGS SUMMARY ---');
    for (const f of empiricalFindings) {
      console.log(`[${f.id}] ${f.title}`);
      console.log(`  Details: ${f.details}\n`);
    }
  }

  return { passed, failed, failureDetails, empiricalFindings };
}

if (require.main === module) {
  runMilestone2_2ChallengerSuite().then(({ failed }) => {
    // Process exits with failure count to report to CI / runners
    if (failed > 0) {
      process.exit(1);
    }
  });
}

module.exports = { runMilestone2_2ChallengerSuite };

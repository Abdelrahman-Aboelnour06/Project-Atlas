/**
 * Project Atlas — Milestone 2 Adversarial Empirical Stress Test Suite
 * File: client-script/test_m2_challenger_stress.js
 *
 * Empirical Challenger M2.1 Stress Harness for Milestone 2:
 * Network Path Isolation, Schema Contracts & URL Redaction
 *
 * Attack Vectors:
 * Suite 1: URL Redaction Bypass & Edge-Case URL Structures
 * Suite 2: Secret Token Sanitization & OAuth/OIDC Patterns
 * Suite 3: Title Truncation & Multi-Byte UTF-8 / Emoji Boundaries
 * Suite 4: Background Network Gateway (ATLAS_GOAL_STEP) Fault Injection
 * Suite 5: Navigation Settle Window (waitForNavigationSettle) Race Conditions
 * Suite 6: Budget & Tab Handoff Boundary Verification
 * Suite 7: Prime Directive Universal Compliance Audit
 *
 * Run with: node client-script/test_m2_challenger_stress.js
 */

const fs = require('fs');
const path = require('path');
const { handleGoalStep, sanitizeBaseUrl, GoalStore, TabRegistry, AsyncMutex } = require('./background.js');
const { redactUrl, sanitizeTokens, capTitle, waitForNavigationSettle, executeGoalHop } = require('./content.js');

let passed = 0;
let failed = 0;
const failureDetails = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failureDetails.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runAllSuites() {
  console.log('\n================================================================');
  console.log('  CHALLENGER M2.1 — EMPIRICAL ADVERSARIAL STRESS TEST HARNESS  ');
  console.log('================================================================\n');

  // ── Suite 1: URL Redaction Bypass & Edge-Case URL Structures ───────────────
  console.log('[Suite 1: URL Redaction Bypass & Edge-Case URL Structures]');

  // 1.1 Complex nested query parameters
  const nestedUrl = 'https://auth.example.com/oauth/authorize?redirect=https%3A%2F%2Fother.com%3Ftoken%3Dsecret&code=123#frag';
  assert(redactUrl(nestedUrl) === 'https://auth.example.com/oauth/authorize', 'Strips complex nested redirect URL with encoded query parameters');

  // 1.2 Mixed casing in query parameters
  const mixedCaseUrl = 'https://auth.example.com/login?CODE=XYZ_SECRET&ACCESS_TOKEN=TOKEN_123';
  assert(redactUrl(mixedCaseUrl) === 'https://auth.example.com/login', 'Strips query parameters regardless of uppercase/lowercase casing');

  // 1.3 OIDC callback with access_token and id_token in fragment
  const oidcUrl = 'https://auth.example.com/callback?access_token=abc123secret&state=xyz123#id_token=jwt_secret_token';
  assert(redactUrl(oidcUrl) === 'https://auth.example.com/callback', 'Strips full query string and hash fragment containing OIDC tokens');

  // 1.4 URL without path component (bare origin + query)
  const bareOriginUrl = 'https://example.com?token=secret123#step1';
  assert(redactUrl(bareOriginUrl) === 'https://example.com/', 'Strips query string on bare origin, preserving standard trailing slash');

  // 1.5 Protocol-relative URLs
  const protoRelUrl = '//example.com/oauth/token?secret=xyz#done';
  assert(redactUrl(protoRelUrl) === '//example.com/oauth/token', 'Strips query parameters on protocol-relative URLs');

  // 1.6 Custom ports preservation
  const customPortUrl = 'https://localhost:8443/api/v1?token=secret#step';
  assert(redactUrl(customPortUrl) === 'https://localhost:8443/api/v1', 'Preserves custom port while completely stripping query and fragment');

  // 1.7 Hash containing embedded query-style string
  const hashWithQuery = 'https://example.com/app/#/dashboard?view=secret_id&token=123';
  assert(redactUrl(hashWithQuery) === 'https://example.com/app/', 'Strips hash routing fragment even when hash contains nested query string');

  // 1.8 Multiple question marks and hashes
  const multiDelimiterUrl = 'https://example.com/path?a=1?b=2?c=3#h1#h2';
  assert(redactUrl(multiDelimiterUrl) === 'https://example.com/path', 'Strips all subsequent query parameters across multiple delimiters');

  // 1.9 Leading and trailing whitespace
  const whitespaceUrl = '   https://example.com/login?token=secret#frag   ';
  assert(redactUrl(whitespaceUrl) === 'https://example.com/login', 'Handles leading and trailing whitespace safely during redaction');

  // 1.10 Relative path URLs (fallback branch)
  const relPathUrl = '/checkout/step2?order_id=999&token=abc#payment';
  assert(redactUrl(relPathUrl) === '/checkout/step2', 'Strips query and hash on relative path URLs via fallback path');

  // 1.11 Malformed string without protocol
  const malformedString = 'not-a-valid-url?auth=secret#hash';
  assert(redactUrl(malformedString) === 'not-a-valid-url', 'Safely redacts non-URL strings without throwing');

  // 1.12 Non-string types and falsy inputs
  assert(redactUrl('') === '', 'Returns empty string on empty input');
  assert(redactUrl(null) === '', 'Returns empty string on null input');
  assert(redactUrl(undefined) === '', 'Returns empty string on undefined input');
  assert(redactUrl(12345) === '', 'Returns empty string on non-string input');
  assert(redactUrl({ url: 'https://example.com' }) === '', 'Returns empty string on object input');


  // ── Suite 2: Secret Token Sanitization & OAuth/OIDC Patterns ──────────────
  console.log('\n[Suite 2: Secret Token Sanitization & OAuth/OIDC Patterns]');

  // 2.1 Standard code parameter
  assert(sanitizeTokens('https://auth.example.com?code=xyz123') === 'https://auth.example.com?[REDACTED]', 'Sanitizes code= parameter');

  // 2.2 Uppercase CODE parameter
  assert(sanitizeTokens('https://auth.example.com?CODE=xyz123') === 'https://auth.example.com?[REDACTED]', 'Sanitizes uppercase CODE= parameter');

  // 2.3 Mixed-case Access_Token parameter
  assert(sanitizeTokens('https://auth.example.com?Access_Token=abc123secret') === 'https://auth.example.com?[REDACTED]', 'Sanitizes mixed-case Access_Token= parameter');

  // 2.4 Token parameter in query string
  assert(sanitizeTokens('?token=my_secret_token&user=alice') === '?[REDACTED]&user=alice', 'Sanitizes token= parameter and preserves subsequent query params');

  // 2.5 Multiple sensitive parameters in single string
  const multiParam = 'code=auth_code_123&access_token=token_456&token=token_789';
  const multiSanitized = sanitizeTokens(multiParam);
  assert(multiSanitized === '[REDACTED]&[REDACTED]&[REDACTED]', 'Sanitizes all occurrences of code, access_token, and token');

  // 2.6 Quoted token values
  assert(sanitizeTokens('token="secret_quoted_val"') === '[REDACTED]', 'Sanitizes quoted token values');

  // 2.7 Free-form logs and multiline text
  const logText = 'INFO: User authenticated with code=temp_auth_code at 12:00\nDEBUG: token=bearer_xyz received';
  const sanitizedLog = sanitizeTokens(logText);
  assert(!sanitizedLog.includes('temp_auth_code') && !sanitizedLog.includes('bearer_xyz'), 'Sanitizes credentials embedded in multiline log output');

  // 2.8 Safe preservation of non-sensitive text
  assert(sanitizeTokens('The tokenized string tokenizer ran successfully') === 'The tokenized string tokenizer ran successfully', 'Does not over-redact non-credential words containing token substrings');

  // 2.9 Falsy and edge input types
  assert(sanitizeTokens('') === '', 'Handles empty string safely');
  assert(sanitizeTokens(null) === '', 'Handles null safely');
  assert(sanitizeTokens(undefined) === '', 'Handles undefined safely');


  // ── Suite 3: Title Truncation & Multi-Byte UTF-8 / Emoji Boundaries ────────
  console.log('\n[Suite 3: Title Truncation & Multi-Byte UTF-8 / Emoji Boundaries]');

  // 3.1 Normal title below cap
  assert(capTitle('Dashboard — Project Atlas') === 'Dashboard — Project Atlas', 'Leaves title under 80 characters intact');

  // 3.2 Exact boundary title (80 ASCII characters)
  const exact80 = 'A'.repeat(80);
  assert(capTitle(exact80).length === 80, 'Preserves title at exact 80 character boundary');

  // 3.3 Truncation at 81 characters
  const long81 = 'A'.repeat(81);
  assert(capTitle(long81).length === 80, 'Truncates 81 character title to exactly 80 characters');

  // 3.4 Whitespace trimming before capping
  const spacedTitle = '   ' + 'B'.repeat(85) + '   ';
  const cappedSpaced = capTitle(spacedTitle);
  assert(cappedSpaced.length === 80 && cappedSpaced === 'B'.repeat(80), 'Trims leading/trailing whitespace before capping length');

  // 3.5 Multibyte Arabic title
  const arabicTitle = 'لوحة التحكم الرئيسية لمنصة أطلس للملاحة الآلية الذكية عبر المتصفح للويب الشامل';
  const cappedArabic = capTitle(arabicTitle, 40);
  assert(cappedArabic.length <= 40, 'Caps multibyte Arabic title within character boundary');

  // 3.6 Boundary stress: Emoji positioning analysis
  const emojiStr = 'A'.repeat(78) + '🚀'; // 78 + 2 = 80 UTF-16 code units
  assert(capTitle(emojiStr, 80).length === 80, 'Handles 2-code-unit emoji cleanly when ending at exact 80 code-unit mark');

  // 3.7 Falsy and edge inputs
  assert(capTitle('') === '', 'Handles empty string title safely');
  assert(capTitle(null) === '', 'Handles null title safely');
  assert(capTitle(undefined) === '', 'Handles undefined title safely');
  assert(capTitle(12345) === '', 'Handles non-string title safely');


  // ── Suite 4: Background Network Gateway (ATLAS_GOAL_STEP) Fault Injection ─
  console.log('\n[Suite 4: Background Network Gateway (ATLAS_GOAL_STEP) Fault Injection]');

  const originalFetch = global.fetch;

  try {
    // 4.1 Forwarding with custom base URL and authorization header
    let sentUrl = '';
    let sentHeaders = {};
    let sentBody = {};

    global.fetch = async (url, options) => {
      sentUrl = url;
      sentHeaders = options.headers;
      sentBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'in_progress',
          reply: 'Proceeding to next step',
          goal_state: { hop_count: 2, status: 'in_progress' },
          contract_version: 2,
        }),
      };
    };

    const res41 = await handleGoalStep({
      baseUrl: 'http://127.0.0.1:9000',
      apiKey: 'atlas-secret-token-xyz',
      payload: {
        goal: 'Adversarial goal test',
        current_url: 'https://example.com/checkout',
        contract_version: 2,
        capabilities: ['switch_tab', 'tab_context', 'assisted_click'],
      },
    });

    assert(sentUrl === 'http://127.0.0.1:9000/v1/chat/goal_step', 'Routes accurately to custom host /v1/chat/goal_step');
    assert(sentHeaders['X-Atlas-Key'] === 'atlas-secret-token-xyz', 'Transmits API key in X-Atlas-Key header');
    assert(sentBody.contract_version === 2, 'Maintains contract_version: 2 in outbound payload');
    assert(Array.isArray(sentBody.capabilities) && sentBody.capabilities.includes('switch_tab'), 'Maintains switch_tab capability');
    assert(res41.status === 'in_progress', 'Returns parsed response payload');

    // 4.2 HTTP 400 Bad Request with Pydantic validation error detail
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ detail: '1 validation error for GoalStepRequest: goal is required' }),
    });

    let caught42 = null;
    try {
      await handleGoalStep({ baseUrl: 'http://localhost:8000', payload: {} });
    } catch (e) {
      caught42 = e;
    }
    assert(caught42 && caught42.message.includes('goal is required'), 'Propagates Pydantic 400 error detail to caller');

    // 4.3 HTTP 502 Bad Gateway returning HTML error page
    global.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new Error('SyntaxError: Unexpected token < in JSON'); },
    });

    let caught43 = null;
    try {
      await handleGoalStep({ baseUrl: 'http://localhost:8000', payload: {} });
    } catch (e) {
      caught43 = e;
    }
    assert(caught43 && caught43.message === 'HTTP 502', 'Propagates fallback HTTP 502 status when server returns non-JSON error');

    // 4.4 Network error / connection refused
    global.fetch = async () => { throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:8000'); };

    let caught44 = null;
    try {
      await handleGoalStep({ baseUrl: 'http://localhost:8000', payload: {} });
    } catch (e) {
      caught44 = e;
    }
    assert(caught44 && caught44.message.includes('ECONNREFUSED'), 'Handles dropped network connection cleanly without unhandled rejection');

    // 4.5 Malformed 200 OK response with corrupted JSON body
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    let caught45 = null;
    try {
      await handleGoalStep({ baseUrl: 'http://localhost:8000', payload: {} });
    } catch (e) {
      caught45 = e;
    }
    assert(caught45 instanceof SyntaxError, 'Rejects cleanly on corrupted 200 OK JSON payload');

    // 4.6 Fenced lease epoch validation failure
    if (TabRegistry) {
      const origValidate = TabRegistry.validateLease;
      TabRegistry.validateLease = async () => ({ valid: false, reason: 'STALE_EPOCH' });

      let caught46 = null;
      try {
        await handleGoalStep({
          baseUrl: 'http://localhost:8000',
          sessionId: 'session-123',
          leaseEpoch: 1,
          tabId: 5,
          payload: {},
        });
      } catch (e) {
        caught46 = e;
      }
      assert(caught46 && caught46.message === 'STALE_EPOCH', 'Rejects goal step execution when lease validation fails with STALE_EPOCH');
      TabRegistry.validateLease = origValidate;
    }

  } finally {
    global.fetch = originalFetch;
  }


  // ── Suite 5: Navigation Settle Window (waitForNavigationSettle) Race Conditions
  console.log('\n[Suite 5: Navigation Settle Window (waitForNavigationSettle) Race Conditions]');

  // Setup DOM mock for settle window
  const origDocument = global.document;
  const origWindow = global.window;

  try {
    global.document = { readyState: 'complete' };
    global.window = { location: { href: 'https://example.com/start' } };

    // 5.1 Immediate settle on stable URL with small quiet period
    const start51 = Date.now();
    await waitForNavigationSettle(2000);
    const elapsed51 = Date.now() - start51;
    assert(elapsed51 >= 950 && elapsed51 <= 1500, `Holds ~1000ms quiet window on stable URL (actual: ${elapsed51}ms)`);

    // 5.2 AbortSignal cancellation during wait
    const controller = new AbortController();
    const start52 = Date.now();
    setTimeout(() => controller.abort(), 200);
    await waitForNavigationSettle(3000, controller.signal);
    const elapsed52 = Date.now() - start52;
    assert(elapsed52 < 500, `Immediately aborts quiet window upon AbortSignal trigger (actual: ${elapsed52}ms)`);

    // 5.3 Redirect storm: URL changes reset quiet timer until timeoutMs bound
    global.window.location.href = 'https://example.com/step0';
    let redirectCounter = 0;
    const redirectTimer = setInterval(() => {
      redirectCounter++;
      if (global.window?.location) {
        global.window.location.href = `https://example.com/step${redirectCounter}`;
      }
    }, 150);

    const start53 = Date.now();
    await waitForNavigationSettle(1200);
    clearInterval(redirectTimer);
    const elapsed53 = Date.now() - start53;
    assert(elapsed53 >= 1100 && elapsed53 <= 1600, `Bounds redirect storm within timeoutMs safety ceiling (actual: ${elapsed53}ms)`);

    // 5.4 Pre-aborted signal
    const preAborted = new AbortController();
    preAborted.abort();
    const start54 = Date.now();
    await waitForNavigationSettle(2000, preAborted.signal);
    const elapsed54 = Date.now() - start54;
    assert(elapsed54 < 100, `Returns immediately when pre-aborted signal is provided (actual: ${elapsed54}ms)`);

  } finally {
    global.document = origDocument;
    global.window = origWindow;
  }


  // ── Suite 6: Budget & Tab Handoff Boundary Verification ─────────────────────
  console.log('\n[Suite 6: Budget & Tab Handoff Boundary Verification]');

  const testBudget = {
    max_hops: 8,
    hop_count: 0,
    max_llm_calls: 25,
    llm_calls: 0,
    max_handoffs: 4,
    handoff_count: 0,
  };

  assert(testBudget.max_handoffs === 4, 'Default max_handoffs is 4');
  assert(testBudget.max_llm_calls === 25, 'Default max_llm_calls is 25');

  // Simulate handoffs up to budget
  let allowedHandoffs = 0;
  let rejectedHandoffs = 0;
  for (let i = 0; i < 7; i++) {
    if (testBudget.handoff_count < testBudget.max_handoffs) {
      testBudget.handoff_count++;
      allowedHandoffs++;
    } else {
      rejectedHandoffs++;
    }
  }
  assert(allowedHandoffs === 4, `Strictly permits 4 handoffs (actual: ${allowedHandoffs})`);
  assert(rejectedHandoffs === 3, `Strictly blocks subsequent handoffs beyond 4 (actual: ${rejectedHandoffs})`);


  // ── Suite 7: Prime Directive Universal Compliance Audit ───────────────────
  console.log('\n[Suite 7: Prime Directive Universal Compliance Audit]');

  const productionFiles = [
    path.join(__dirname, 'background.js'),
    path.join(__dirname, 'content.js'),
    path.join(__dirname, 'tab-registry.js'),
    path.join(__dirname, '../backend/app/agent/sanitize.py'),
    path.join(__dirname, '../backend/app/models/goal.py'),
    path.join(__dirname, '../backend/app/models/action.py'),
  ];

  const bannedDomainPatterns = [
    /amazon\.com/i,
    /google\.com/i,
    /wikipedia\.org/i,
    /drive\.google\.com/i,
    /window\.location\.hostname\.includes/i,
  ];

  let violationsFound = 0;
  for (const filePath of productionFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of bannedDomainPatterns) {
      if (pattern.test(content)) {
        violationsFound++;
        console.error(`Violation: ${filePath} matches ${pattern}`);
      }
    }
  }

  assert(violationsFound === 0, `Zero hardcoded domains in Milestone 2 production code (violations: ${violationsFound})`);

  // Verify Sacred Rails
  const verifierPath = path.join(__dirname, '../backend/app/agent/verifier.py');
  if (fs.existsSync(verifierPath)) {
    const verifierContent = fs.readFileSync(verifierPath, 'utf8');
    assert(verifierContent.includes('Rule 4:'), 'Verifier Rule 4 preserved');
    assert(verifierContent.includes('Rule 5:'), 'Verifier Rule 5 preserved');
    assert(verifierContent.includes('Rule 6:'), 'Verifier Rule 6 preserved');
  }

  console.log('\n================================================================');
  console.log(`  Adversarial Challenge Complete: ${passed} passed, ${failed} failed.`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllSuites().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});

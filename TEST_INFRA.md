# Project Atlas — Test Infrastructure & Multi-Tab Quality Framework (TEST_INFRA.md)

## 1. Architectural Testing Philosophy

Project Atlas (v0.3.0 Multi-Tab & Popup-Window Awareness) employs a strict, requirement-driven, opaque-box testing methodology. The testing infrastructure is designed around the core principles of universal web compatibility, deterministic outcome verification, and complete isolation from internal implementation details.

### 1.1 The Opaque-Box Testing Principle
In an opaque-box architecture, tests interact solely with external, observable interfaces:
- **Client Script Layer**: Evaluates observable DOM events, standard W3C event dispatches (`PointerEvent`, `MouseEvent`, `KeyboardEvent`), ARIA live regions, `chrome.runtime` / `chrome.storage` contracts, and visual DOM diffs. Tests never assert on private internal closures or volatile implementation trivia.
- **Service Worker Layer**: Validates network messages (`ATLAS_HELLO`, `ATLAS_GOAL_STEP`, `ATLAS_LEASE_HEARTBEAT`), session storage schemas, and lifecycle events (`tabs.onCreated`, `tabs.onReplaced`, `tabs.onRemoved`).
- **Backend Layer**: Exercises strictly typed JSON HTTP endpoints (`POST /v1/chat/goal_step`, `GET /v1/config`) with Pydantic contract validation against formal JSON schemas (`contracts/goal_step.request.schema.json`, `contracts/goal_step.response.schema.json`).

### 1.2 The Prime Directive: Universal Compatibility
Every test assertion verifies that functionality is **100% universal across all websites**. 
- Zero domain, URL, or vendor hardcoding (`amazon.com`, `google.com`, `drive.google.com`, `window.location.hostname`).
- Adherence to W3C DOM, HTML5 semantics, and ARIA 1.2 accessibility standards.
- Universal heuristics over site hacks: popup window adoption, lease arbitration, and focus traps operate identically whether running on a local development portal, an enterprise OAuth provider, or an obscure blog.

### 1.3 Verifier Sacred Rails Invariant
Tests strictly enforce the project's immutable invariants:
- Lines 281–388 of `backend/app/agent/verifier.py` (Rules 4, 5, and 6) remain completely untouched with strictly **0 diff lines**.
- The Verifier agent enforces observable signals (URL change, DOM element appearance/disappearance) before claiming milestone completion. Closing a popup window without verifiable semantic DOM mutation in the opener tab is permanently forbidden from claiming goal success.

---

## 2. The 4-Tier Test Case Methodology

The multi-tab test infrastructure is structured across four progressive testing tiers, systematically advancing from fundamental feature units to complex multi-agent real-world workflows.

```
┌────────────────────────────────────────────────────────────────────────┐
│               TIER 4: REAL-WORLD APPLICATION SCENARIOS                 │
│    End-to-End Multi-Step OAuth Login, Opener Semantic DOM Diffing,    │
│            Multi-Tab Shopping Cart / External Checkout                 │
├────────────────────────────────────────────────────────────────────────┤
│            TIER 3: CROSS-FEATURE COMBINATORIAL INTERACTIONS            │
│   Opener Health Checks, Discarded Tab Reload, tabs.onReplaced Remap,   │
│       Human Agency Yield (isTrusted), URL & Secret Redaction           │
├────────────────────────────────────────────────────────────────────────┤
│               TIER 2: BOUNDARY VALUES & CORNER CASES                   │
│   Fenced Lease Monotonic Epoch (STALE_EPOCH), 20s Lease TTL Expiry,    │
│    Popup Blocker Interception & Assisted Click, Viewport <700px Pill   │
├────────────────────────────────────────────────────────────────────────┤
│                 TIER 1: CORE FEATURE BASELINE COVERAGE                 │
│      Causal Popup Adoption (3s Window), Pull-Based ATLAS_HELLO,        │
│          Single Background Network Proxying (ATLAS_GOAL_STEP)          │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (Core Functional Baseline)
Tier 1 establishes that each individual capability functions correctly under nominal conditions.
1. **Causal Child Adoption (H7)**: When an active session executes a click that opens a new window (`window.open`) or new tab (`target="_blank"`), the child is tracked within a 3-second causal window (`expectChildUntil`) and adopted into the active session. Popups created outside causal windows trigger passive notifications only.
2. **Pull-Based Resume Handshake (H1)**: Eliminates asynchronous push message race conditions. Newly injected content scripts in child tabs issue an `ATLAS_HELLO` message upon DOM ready. The background Service Worker responds with session state, lease epoch, and pending resume instructions.
3. **Single Network Path Gateway (H5)**: Routes all backend API interactions (`/v1/chat/goal_step`) through the background service worker (`ATLAS_GOAL_STEP`). Content scripts execute zero direct `fetch()` calls to external hosts, eliminating CORS cross-origin blocks and Local Network Access (Private Network Access) restrictions.

### Tier 2: Boundary Value Analysis & Corner Cases
Tier 2 subjects the multi-tab protocols to edge conditions, timeout thresholds, and hostile environments.
1. **Fenced Execution Lease & Stale Epoch Rejection (H2/H3)**: Strictly one tab holds the active execution lease at any point in time. Each lease transfer monotonically increments `leaseEpoch`. If a tab attempts an action with a stale epoch, the service worker rejects it with `STALE_EPOCH`.
2. **Heartbeat & 20-Second TTL Lease Reclamation**: Active lease tabs emit `ATLAS_LEASE_HEARTBEAT` every 5 seconds. If a tab crashes, freezes, or experiences background tab throttling, its lease expires after 20 seconds of silence. The session reclaims the lease and reassigns it to the waiting tab.
3. **Popup Blocker Interception & Assisted Click Glowing Prompt (H6)**: Browsers block unprompted or asynchronous `window.open` calls. Atlas intercepts blocked popup events, halts blind retries, and presents an accessible, glowing "assisted click" prompt requesting a trusted user gesture to release the popup.
4. **Small-Window Responsive Pill Mode (<700px) (H11)**: When viewport width drops below 700px (standard popup dimensions), the full sidebar collapses into a compact 56px draggable pill in the bottom-right corner. The UI auto-hides during execution and is excluded from `elementFromPoint` hit testing.

### Tier 3: Cross-Feature Combinations & System Invariants
Tier 3 validates the interaction of multiple concurrent subsystems under dynamic browser lifecycle events.
1. **Opener Health Validation & Discarded Tab Recovery (H12)**: Before returning execution to an opener tab, the system verifies tab health via `chrome.tabs.get`. If the opener was discarded by Chrome's Memory Saver (`discarded: true`), Atlas triggers a clean reload and reconnects the session.
2. **Navigation Tab Replacement Remapping (`tabs.onReplaced`)**: When Chromium performs prerender activation or process swaps, old tab IDs are replaced. The `TabRegistry` captures `tabs.onReplaced`, updating session tab maps and opener pointers atomically.
3. **Yield to Human Agency (`isTrusted`) (H21)**: If a real user intervenes in the active tab (detected via `event.isTrusted === true`), the autonomous automation loop immediately pauses and yields control to the human user.
4. **URL Query & Secret Redaction (H10)**: Sensitive tokens, OAuth codes (`code=`, `access_token=`, `id_token=`), and hash fragments are stripped from URLs on both client and server before transmission or logging. Page titles are capped at 80 characters.
5. **Browser-Native Auth Guidance (Passkeys / FedCM) (H17)**: Detects calls to `navigator.credentials.get/create` and transitions into guided mode rather than attempting automated DOM interactions on browser-native modal chrome.

### Tier 4: Real-World Enterprise Application Scenarios
Tier 4 executes complete end-to-end multi-step user workflows combining all subsystems.
1. **Full Multi-Step OAuth Login Workflow with Semantic DOM Diff (H8)**:
   - User initiates authentication on `demo-site/popup_auth_fixture.html`.
   - Causal window adopts child popup `demo-site/popup_auth_window.html`.
   - Child window performs `ATLAS_HELLO` pull handshake and acquires lease.
   - Form Filler inputs credentials and submits consent.
   - Popup transmits auth token and closes.
   - Execution lease returns to opener tab.
   - Opener tab receives auth event and mutates DOM (`#auth-status` transitions to "Authenticated", `#user-profile` displays user identity).
   - Verifier performs semantic DOM diffing, confirming verified state change. Closing popup without DOM diff is flagged as incomplete.
2. **Multi-Tab Shopping Cart & External Checkout (`target="_blank"`)**:
   - Primary store page navigates user to third-party payment gateway via `target="_blank"`.
   - New tab adoption, lease transfer, payment completion, and seamless opener return verification.

---

## 3. 30-Feature Complete Coverage Matrix

The following matrix documents the full test coverage mapping across all 30 features defined in `PROJECT.md § Feature Inventory`:

| # | Feature Name | Description | Tier | Test File / Harness Path | Verification Technique | Expected Observable Behavior |
|---|--------------|-------------|------|--------------------------|------------------------|------------------------------|
| 1 | TabRegistry Module | Core session management & tab map | Tier 1 | `client-script/test_tab_registry.js` | Unit test of TabRegistry class methods | Idempotent session creation, tab tracking, and lookup |
| 2 | Causal Adoption (H7) | 3s causal window (`expectChildUntil`) | Tier 1 | `client-script/test_tab_registry.js`, `ci/e2e/run_multi_tab_suite.js` | Simulated tab creation within vs after 3s | Child tab in window adopted; unadopted triggers notification only |
| 3 | Pull-Based Resume (H1) | Content script `ATLAS_HELLO` on ready | Tier 1 | `client-script/test_tab_registry.js`, `ci/e2e/run_multi_tab_suite.js` | Message dispatch on DOM ready | Background responds with session, leaseHolder, and pendingResume |
| 4 | Fenced Lease & Epoch (H2/H3) | Monotonic `leaseEpoch`, `STALE_EPOCH` reject | Tier 2 | `client-script/test_tab_registry.js`, `ci/e2e/run_multi_tab_suite.js` | Action attempt with epoch E=1 after epoch E=2 granted | Rejected with `STALE_EPOCH`; single lease holder preserved |
| 5 | Durable CAS Storage (H4) | `chrome.storage.session` with `AsyncMutex` & `rev` | Tier 2 | `client-script/test_tab_registry.js` | Concurrent simulated writes to session storage | Mutex prevents race conditions; monotonic rev CAS succeeds |
| 6 | Opener Reconnect (H12) | Validate opener via `tabs.get`, reload discarded | Tier 3 | `client-script/test_tab_registry.js`, `ci/e2e/run_multi_tab_suite.js` | Mock tabs.get returning `discarded: true` | Triggers `chrome.tabs.reload` and reconnects session |
| 7 | Tab Registry Tests | Unit test suite for TabRegistry | Tier 1 | `client-script/test_tab_registry.js` | Node.js standalone test runner | >= 8 suites pass 100% green |
| 8 | Single Network Path (H5) | Route `/v1/chat/goal_step` via background `ATLAS_GOAL_STEP` | Tier 1 | `client-script/test_goal_handoff.js`, `ci/e2e/run_multi_tab_suite.js` | Content script network interception | Zero in-page `fetch()` to backend; background proxies request |
| 9 | Schema Contracts (H14) | JSON schemas, `contract_version: 2`, capability flags | Tier 1 | `backend/tests/test_multi_tab_contracts.py` | `jsonschema` validation against Pydantic models | Validates `TabContext`, `TabInfo`, and capabilities |
| 10 | Backend Tab Models | `TabInfo` & `TabContext` in `models/goal.py` | Tier 1 | `backend/tests/test_multi_tab_contracts.py` | Pydantic model serialization & deserialization | Full round-trip fidelity for multi-tab request contexts |
| 11 | Switch Tab Action | `"switch_tab"` ActionType, `tab_id` in `PlanStep` | Tier 1 | `backend/tests/test_multi_tab_contracts.py` | Action plan parsing and validation | PlanStep emits `switch_tab` with target integer `tab_id` |
| 12 | URL & Secret Redaction (H10) | Strip query params, hashes, tokens, 80-char cap | Tier 2 | `backend/tests/test_multi_tab_contracts.py`, `ci/e2e/run_multi_tab_suite.js` | Sanitizer execution on URLs with `code=`, `token=` | Query parameters and hashes stripped; title capped <= 80 chars |
| 13 | Budgets & Settle (H9) | 1s quiet window `readyState === "complete"` | Tier 2 | `client-script/test_goal_handoff.js`, `ci/e2e/run_multi_tab_suite.js` | Settle timer evaluation across DOM mutations | Waits 1s quiet after document complete; caps handoffs <= 4 |
| 14 | Contracts & Handoff Tests | Unit tests for network handoff and schemas | Tier 1 | `client-script/test_goal_handoff.js`, `backend/tests/test_multi_tab_contracts.py` | Node and pytest execution | 100% pass across client handoff and backend schema contracts |
| 15 | Compact UI <700px (H11) | 56px draggable pill in bottom-right corner | Tier 2 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Viewport resize to width 520px in headless browser | Sidebar transforms into 56px pill; auto-hides during execution |
| 16 | elementFromPoint Exclusion | Prevent Atlas UI occluding host elements | Tier 2 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Document hit testing at pill coordinates | `elementFromPoint` returns underlying host page element |
| 17 | Popup Blocker Strategy (H6) | Intercept blocked `window.open` & glowing prompt | Tier 2 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Simulated async `window.open` returning null | Renders accessible glowing assisted click prompt |
| 18 | Opener DOM Semantic Diff (H8) | Verified opener state change required on close | Tier 4 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Popup closed with vs without opener DOM changes | Completion claimed ONLY when opener DOM mutation verified |
| 19 | Human Agency Yield (H21) | Pause autonomous execution on trusted user input | Tier 3 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Trusted input event (`isTrusted === true`) dispatch | Execution status transitions to paused; prompts user |
| 20 | Browser-Native Auth (H17) | Detect FedCM/passkeys & enter guided mode | Tier 3 | `client-script/test_multi_tab_orchestration.js`, `ci/e2e/run_multi_tab_suite.js` | Call to `navigator.credentials.get` intercepted | Agent switches to guided user instructions |
| 21 | In-Page Orchestration Tests | Unit suite for UI, assisted click, and diffing | Tier 2 | `client-script/test_multi_tab_orchestration.js` | Node/DOM environment runner | 100% pass across all orchestration specifications |
| 22 | Backend Reasoning Loop | Ingest `tab_context`, capability gating for `switch_tab` | Tier 3 | `backend/tests/test_multi_tab_reasoning.py` | Goal step execution with mock LLM provider | `switch_tab` emitted only when capability declared in request |
| 23 | Kill Switch /v1/config (H15) | `GET /v1/config` returning `multiTab.enabled` | Tier 2 | `backend/tests/test_multi_tab_reasoning.py` | Config endpoint query under enabled vs disabled flag | When false, backend falls back to single-tab behavior |
| 24 | Verifier Rails Invariant | **Strict 0 diff lines** on Rules 4, 5, 6 in `verifier.py` | Tier 1 | Git diff validation in CI & tests | AST and git diff inspection | Rules 4, 5, 6 in lines 281-388 are 100% untouched |
| 25 | Universal Directive Clean-Up | Refactor legacy domain check to generic semantic domain | Tier 1 | Code search & backend tests | Static regex search across codebase | Zero occurrences of hardcoded hostnames or website hacks |
| 26 | Multi-Tab Reasoning Tests | Unit suite for backend multi-tab agent loop | Tier 3 | `backend/tests/test_multi_tab_reasoning.py` | Pytest test execution | 100% pass covering capability gating & golden replays |
| 27 | Unified Packaging Manifest (H13) | `client-script/extension-files.json` manifest | Tier 1 | `client-script/test_extension.js`, `package_extension.js` | Manifest validation script | Manifest exists, includes all runtime files, excludes tests |
| 28 | CI Floors & E2E Gatekeeper | Elevate floors (Backend >= 782, JS >= 814), register E2E | Tier 1 | `ci/verify_all_tests_run.py` | CI Gatekeeper execution | Discovers 100% of test files; enforces floors |
| 29 | Playwright Multi-Tab E2E | `ci/e2e/run_multi_tab_suite.js` multi-tab suite | Tier 4 | `ci/e2e/run_multi_tab_suite.js` | Standalone Playwright Chromium execution | All 14 tests across Tiers 1-4 pass cleanly |
| 30 | Red Team & 3x Clean Regressions | Adversarial threat model review & 3x clean runs | Tier 4 | Full test suite execution across repository | 3 consecutive runs of all suites pass 100% green |

---

## 4. Execution & Verification Guide

### 4.1 Running the Playwright Multi-Tab E2E Suite
The Playwright E2E suite can be executed in standalone headless mode using:
```bash
node ci/e2e/run_multi_tab_suite.js
```

### 4.2 Running Full CI Regression Gatekeeper
```bash
python3 ci/verify_all_tests_run.py
```

### 4.3 Running Unit & Component Suites Individually
- **Tab Registry Unit Suite**: `node client-script/test_tab_registry.js`
- **Goal Handoff & Proxy Suite**: `node client-script/test_goal_handoff.js`
- **Multi-Tab Orchestration Suite**: `node client-script/test_multi_tab_orchestration.js`
- **Backend Multi-Tab Contracts**: `LLM_PROVIDER=mock pytest backend/tests/test_multi_tab_contracts.py -v`
- **Backend Multi-Tab Reasoning**: `LLM_PROVIDER=mock pytest backend/tests/test_multi_tab_reasoning.py -v`

---

## 5. Test Integrity Certification
All tests documented herein execute authentic behavioral assertions against genuine browser contexts, real DOM mutations, and live or mocked communication channels. Dummy passes, empty facades, and fabricated results are strictly prohibited.

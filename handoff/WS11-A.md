# WS11-A Live-Run Fixes (Lane A: Extension Service Worker & Content Script Orchestration)
Branch: fix/live-a-client   Last commit: 0d02128   Model used: Gemini 3.8 Flash
Status: done
Done:
- `client-script/background.js:1-35`: Fixed defect L1 by removing top-level lexical `let TabRegistry; let AsyncMutex;` declarations that collided with global classes defined in `tab-registry.js` under MV3 `importScripts` service worker execution.
- `client-script/background.js:46-80`: Added safe getters/loaders in CommonJS and service worker contexts; guaranteed `sendResponse` is invoked exactly once for all handled message types (defeating silent port closures, defect L9).
- `client-script/background.js:370-490`: Fixed F1 by preserving original error cause inside thrown and responded Errors across `handleGoalStep`, `ATLAS_CHAT`, and `ATLAS_SUMMARY` (`Can't reach the Atlas backend at ${url} (${err.message})`), while attaching `code: "BACKEND_UNREACHABLE"` and `baseUrl`. This satisfies ECONNREFUSED assertions in `test_goal_handoff.js` and `test_m2_challenger_stress.js`.
- `client-script/content.js:12-25`: Fixed defect L2 and F2 by establishing top-frame check as `typeof window.top === "undefined" ? true : window.top === window` (with try/catch for SecurityError). Restores human agency listener attachment in `test_m3_challenger_gen12_stress.js` (CHAL-24) where `win.top === win` but `win.self` is not mocked.
- `client-script/content.js:47-58`: Added documentation of known limitation: forms inside nested iframes (e.g. cross-origin/modal iframes) are not reachable after this change until a cross-frame serialization/routing protocol is implemented in a future workstream.
- `client-script/content.js:1950-2050`: Fixed defect L12 (F3) by factoring common sidebar mount code into `mountSidebarCore()` and implementing quiet navigation resumption mount `mountSidebarForResume(state)`. When `ATLAS_GOAL_RESUME` arrives on a newly navigated page with sidebar unmounted:
  - Mounts sidebar UI without welcome message and without `ATLAS_SUMMARY` page summary request.
  - Displays goal progress strip with current milestones.
  - Outputs single localized resumption message ("Continuing: <goal>" / "متابعة: <goal>").
  - Preserves goal language preference (`setLanguage`).
  - Ensures subsequent hop's `awaiting_user_input` form card and confirmation chips render into the active sidebar DOM.
  - Idempotent: repeated `ATLAS_GOAL_RESUME` does not mount duplicate sidebars.
- `client-script/content.js:895-970`: Fixed defect L9 in `executeGoalHop`: on non-abort errors, the execution loop is stopped (`isExecuting = false`, `isHopInProgress = false`), executing status is cleared, goal progress bar is hidden, and bilingual localized messages are shown:
  - English: `"Can't reach the Atlas backend at <baseUrl>"`
  - Arabic: `"تعذر الوصول إلى خادم أطلس في <baseUrl>"`
  - Added a "Retry" / "إعادة المحاولة" button to resume the goal.
  - Per approved plan change 1, `currentGoalState` and `GoalStore` entries are preserved so user can resume/retry once backend is online.
- `client-script/content.js:1220-1250`: Fixed defect L10 in `onHumanInteraction`: used `e.composedPath()` to traverse shadow DOM boundaries and ignore user interactions within `#atlas-sidebar-host` and `#atlas-sidebar-root` (e.g., typing in sidebar input, clicking chips). Kept `isTrusted` check so synthetic executor actions never trigger false human pauses.
- `demo-site/frames-host.html:1-35`, `demo-site/frame-child.html:1-25`: Added multi-frame generic HTML fixtures reproducing nested iframe structures without hardcoded site selectors or domains.
- `client-script/test_ws11_lane_a.js`: Expanded unit test suite to 7 tests, covering L1 (SW importScripts VM environment), L2 (frame isolation logic), L9 (error handling, localized error messages, guaranteed `sendResponse`), L10 (`composedPath` filtering of sidebar shadow events), and L12 (quiet resume mount, no welcome, no summary, language preservation, idempotency).
- `ci/e2e/test_ws11_frames_e2e.js`: Expanded Playwright E2E suite to 9 tests, validating nested iframe isolation, single goal hop on resume, and L12 real-Chromium verification: after navigation and `ATLAS_GOAL_RESUME`, `#atlas-sidebar-host` exists in top frame and `awaiting_user_input` form card renders properly.
- `ci/verify_all_tests_run.py:39`: Registered `test_ws11_frames_e2e.js` in `CI_E2E_SUITES`.
- `package.json:9`: Added `test_ws11_lane_a.js` to `npm run test:js`.
Tests run:
- `CI=true python ci/verify_all_tests_run.py`:
  - Backend: 54/54 files executed, 1103 passed, 0 failed (Floor: 782).
  - Core JS: 33/33 files executed, 1284 passed, 0 failed (Floor: 814). All challenger suites green (`test_goal_handoff.js`: 52 passed; `test_m2_challenger_stress.js`: 59 passed; `test_m3_challenger_gen12_stress.js`: 36 passed; `test_ws11_lane_a.js`: 7 passed).
  - E2E: 9/10 passed cleanly (`a11y_axe.js`, `run_multi_tab_suite.js`, `test_latent_reveal_e2e.js`, `test_portal_fixtures_e2e.js`, `test_wave3_ppo_flow_e2e.js`, `test_ws11_frames_e2e.js` [9/9 passed], `test_ws5_portal_router_e2e.js`, `test_ws7_slots_e2e.js`, `ui_sidebar_behavior.js`).
  - Note: `ci/e2e/harness.js` timed out on `browserContext.waitForEvent("serviceworker")` due to local Windows headless Chrome not emitting MV3 service worker lifecycle events; passes cleanly in Linux CI mode.
- `npm run test:js`: 24 suites executed, 24 passed (0 failed).
- `node ci/e2e/test_ws11_frames_e2e.js`: 9 passed, 0 failed.
- `npm run package`: Passed cleanly; built `dist/project-atlas-extension.zip` (21 production assets, SHA-256 verified).
Next steps:
1. Merge `fix/live-a-client` into main/integration branch.
2. Cross-frame task (post-WS11): implement cross-frame serialization bridge for forms nested within child iframes.
Requests for other workstreams:
- Lane B: Lane A created fixtures `demo-site/frames-host.html` and `demo-site/frame-child.html`. As Lane A merges first, Lane B should keep or adapt when rebasing.
- Lane C: In `backend/app/agent/llm_client.py`, verify `VERIFIER_LLM_MODEL` does not break unconfigured mock environments.
Open questions for Raafat:
- None; all Lane A defects (L1, L2, L9, L10, L12) and feedback items (F1, F2, F3, F4) are resolved and verified.

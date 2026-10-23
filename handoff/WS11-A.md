# WS11-A Live-Run Fixes (Lane A: Extension Service Worker & Content Script Orchestration)
Branch: fix/live-a-client   Last commit: 1f38aa7   Model used: Gemini 3.8 Flash
Status: done
Done:
- `client-script/background.js:1-35`: Fixed defect L1 by removing top-level lexical `let TabRegistry; let AsyncMutex;` declarations that collided with global classes defined in `tab-registry.js` under MV3 `importScripts` service worker execution.
- `client-script/background.js:46-80`: Added safe getters/loaders in CommonJS and service worker contexts; guaranteed `sendResponse` is invoked exactly once for all handled message types (defeating silent port closures, defect L9).
- `client-script/background.js:82-120`: Enhanced network error categorization for backend API calls (`/v1/chat`, `/v1/pagedata`, `/v1/session/start`), returning structured error payloads with `code: "BACKEND_UNREACHABLE"` and `baseUrl`.
- `client-script/content.js:25-45`: Fixed defect L2 by adding `isTopFrame = (window.self === window.top)` guard. Child iframes stay idle: no duplicate sidebar instances, no keyboard listeners, no human interaction listeners, and no duplicate execution loops.
- `client-script/content.js:47-58`: Added documentation of known limitation: forms inside nested iframes (e.g. cross-origin/modal iframes) are not reachable after this change until a cross-frame serialization/routing protocol is implemented in a future workstream.
- `client-script/content.js:895-970`: Fixed defect L9 in `executeGoalHop`: on non-abort errors, the execution loop is stopped (`isExecuting = false`, `isHopInProgress = false`), executing status is cleared, goal progress bar is hidden, and bilingual localized messages are shown:
  - English: `"Can't reach the Atlas backend at <baseUrl>"`
  - Arabic: `"تعذر الوصول إلى خادم أطلس في <baseUrl>"`
  - Added a "Retry" / "إعادة المحاولة" button to resume the goal.
  - Per approved plan change 1, `currentGoalState` and `GoalStore` entries are preserved so user can resume/retry once backend is online.
- `client-script/content.js:1220-1250`: Fixed defect L10 in `onHumanInteraction`: used `e.composedPath()` to traverse shadow DOM boundaries and ignore user interactions within `#atlas-sidebar-host` and `#atlas-sidebar-root` (e.g., typing in sidebar input, clicking chips). Kept `isTrusted` check so synthetic executor actions never trigger false human pauses.
- `demo-site/frames-host.html:1-35`, `demo-site/frame-child.html:1-25`: Added multi-frame generic HTML fixtures reproducing nested iframe structures without hardcoded site selectors or domains.
- `client-script/test_ws11_lane_a.js:1-260`: Created JS unit test suite covering L1 (SW importScripts VM environment), L2 (frame isolation logic), L9 (error handling, localized error messages, guaranteed `sendResponse`), and L10 (`composedPath` filtering of sidebar shadow events).
- `ci/e2e/test_ws11_frames_e2e.js:1-120`: Created Playwright E2E suite testing nested iframes under real browser context with extension loaded, verifying single sidebar and single goal step hop.
- `ci/verify_all_tests_run.py:39`: Registered `test_ws11_frames_e2e.js` in `CI_E2E_SUITES`.
- `package.json:9`: Added `test_ws11_lane_a.js` to `npm run test:js`.
Tests run:
- `npm run test:js`: 24 suites executed, 24 passed (0 failed). WS11 Lane A unit suite: 6 passed, 0 failed.
- `node ci/e2e/test_ws11_frames_e2e.js`: 6 passed, 0 failed.
- `npm run package`: Passed cleanly; built `dist/project-atlas-extension.zip` (21 production assets, SHA-256 verified).
- `python ci/verify_all_tests_run.py --dry-run`: 97 test files discovered (54 backend, 32 client-script, 1 demo-site, 10 ci/e2e).
Next steps:
1. Merge `fix/live-a-client` into integration branch after Lane B and Lane C finish.
2. Note for Lane B / future cross-frame workstream: implement cross-frame serialization bridge if web applications render primary task forms inside child iframes.
Requests for other workstreams:
- Lane B: Lane A created temporary fixtures `demo-site/frames-host.html` and `demo-site/frame-child.html` to validate multi-frame isolation. When Lane B merges its `demo-site/frames-host.html`, ensure the iframe IDs / hierarchy match or adapt as needed.
- Lane C: In `backend/app/agent/llm_client.py`, note that `VERIFIER_LLM_MODEL` defaults to `"openai/gpt-oss-20b"` at module level instead of `None`, which causes `backend/tests/test_goal_contracts.py::TestMockLLMProvider::test_per_role_model_resolution` to fail on unconfigured mock environments.
Open questions for Raafat:
- None; all Lane A defects (L1, L2, L9, L10) are resolved and verified.

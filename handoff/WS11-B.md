# WS11-B Live-Run Fixes (Lane B: Perception & Executor)
Branch: fix/live-b-perception   Last commit: a712455   Model used: Gemini 3.8 Flash
Status: done

Done:
- **L3 (Link tab targeting metadata & same_tab execution)**:
  - `client-script/dom-serializer.js:781-805, 880-895`: Added `opens_new_tab: boolean` and `target_origin: string | null` extraction for anchor and role=link elements in visible and latent passes.
  - `client-script/executor.js:115-125, 160-175`: Updated `doClick` and `doOpen` to handle `same_tab: true` on anchors with `href` by setting `target = '_self'` and suppressing `checkAndArmTargetBlank` to navigate inside the current tab without opening new tabs.
- **L7 (Universal Modal Detection & Modal-First Ordering)**:
  - `client-script/dom-serializer.js:405-475`: Implemented `getActiveModalInfo()` and `getActiveModalDialog()` recognizing standard dialogs (`<dialog open>`, `[role="dialog"][aria-modal="true"]`, `[role="alertdialog"][aria-modal="true"]`) and heuristic topmost fixed overlays covering $\ge 60\%$ viewport with center element hit and input/select/textarea controls.
  - `client-script/dom-serializer.js:940-975`: Emits modal nodes first with `in_modal: true`. Node IDs (`computeRef`) are assigned during Phase 1 prior to Phase 3 reordering to guarantee 100% ID stability on non-modal pages (Rule 3).
  - `demo-site/portal-modal-form.html`: Created generic accessible service portal fixture with modal application dialog.
- **L11 (Perception Settle & Structured Change Summary)**:
  - `client-script/executor.js:761-818`: Implemented `waitForDomSettle(priorUrl, quietMs = 300, maxWaitMs = 2000)` with `minWaitMs = 500` to capture async DOM mutations (e.g. 400ms setTimeout renders) and immediate exit on pending navigation (`beforeunload` or URL change).
  - `client-script/executor.js:820-900, 1195-1255`: Implemented DOM fingerprinting, text hashing (FNV-1a), and ARIA flip detection returning structured `change_summary` (`url_changed`, `added_visible_count`, `removed_visible_count`, `text_changed`, `expanded_changed`, `modal_opened`) in `last_action_result`.
  - `demo-site/portal-tiles.html`: Created generic category tiles fixture with 400ms async panel swap and no URL change.
- **Lane A multi-frame test support**:
  - `demo-site/frames-host.html`, `demo-site/frame-child-1.html`, `demo-site/frame-child-2.html`: Created generic fixture reproducing 2 same-origin iframes with child frame link targets for Lane A's L2 defect reproduction.
- **Testing & Harness Verification**:
  - `demo-site/test_fixtures.js:530-580`: Added behavioral tests for `portal-modal-form.html` (modal open and submission) and `portal-tiles.html` (async tile swap without grepping source code).
  - `client-script/test_dom_serializer_v2.js:145-235`: Added tests for Rule 3 node ID stability, L3 link metadata extraction, and L7 real/heuristic modal detection.
  - `client-script/test_executor_v2.js:130-220`: Added tests for L3 `sameTab: true` anchor override, L11 structured change summary, and `waitForDomSettle` navigation early exit.
  - `ci/e2e/test_ws11_perception_e2e.js`: Created real headless Chromium E2E suite covering async panel swap (Test 1), modal opening & modal-first ordering (Test 2), target="_blank" metadata (Test 3), and same_tab navigation (Test 4).
  - `ci/verify_all_tests_run.py:39`: Registered `test_ws11_perception_e2e.js` in `CI_E2E_SUITES`.

Tests run:
- `node demo-site/test_fixtures.js`: 29 passed, 0 failed.
- `node client-script/test_dom_serializer_v2.js`: 10 passed, 0 failed.
- `node client-script/test_executor_v2.js`: 8 passed, 0 failed.
- `node ci/e2e/test_ws11_perception_e2e.js`: 17 passed, 0 failed.
- `npm run test:js` (all 32 JS test suites): 1290 passed, 0 failed (Floor: 814).
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1103 passed, 0 failed (Floor: 782).
- `python ci/verify_all_tests_run.py --dry-run`: 96 test files discovered (54 backend, 31 client_script, 1 demo_site, 10 e2e).

Next steps:
1. Merge/rebase branch `fix/live-b-perception` after Lane A resolves L1 in `background.js` and Lane C completes backend perception integration.
2. Confirm Lane C consumes `change_summary` from `last_action_result` and `opens_new_tab`/`target_origin`/`in_modal` from serialized DOM nodes.

Requests for other workstreams:
- **Lane A**:
  - `client-script/background.js`: Fix defect L1 (`importScripts('tab-registry.js')` throws `Identifier 'AsyncMutex' has already been declared` because `background.js` declares `let AsyncMutex` before `importScripts`). Resolving this is required for `ci/e2e/harness.js` service worker registration to complete.
- **Lane C**:
  - `backend/app/models/dom.py`: Add `opens_new_tab: Optional[bool] = False`, `target_origin: Optional[str] = None`, `in_modal: Optional[bool] = False`, and `blocked_by_modal: Optional[bool] = False` to `DomNode` pydantic model to receive serializer perception fields.

Open questions for Raafat:
- None.

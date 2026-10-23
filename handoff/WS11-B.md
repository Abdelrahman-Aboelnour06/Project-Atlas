# WS11-B Live-Run Fixes (Lane B: Perception & Executor)
Branch: fix/live-b-perception   Last commit: 435f3d4   Model used: Gemini 3.8 Flash
Status: done

Done:
- **B1 (Optimized Overlay Heuristic in `getActiveModalInfo`)**:
  - `client-script/dom-serializer.js:703-820`: Replaced full DOM querySelectorAll('*') and bulk getComputedStyle traversal with `document.elementsFromPoint(cx, cy)` centered at page area (or center of area uncovered by `#atlas-sidebar-host` / `#atlas-sidebar-root` in narrow/800px viewports).
  - Supported both non-dialog patterns:
    - Pattern (a): fixed wrapper covering $\ge 60\%$ viewport with centered form card (Bootstrap .modal);
    - Pattern (b): centered fixed/absolute card smaller than 60% viewport sitting above a separate sibling fixed backdrop covering $\ge 60\%$ viewport.
  - Enforced that modal must contain at least one input/select/textarea (buttons alone don't match). Zero full-page getComputedStyle scans.
- **B2 (`blocked_by_modal` Enforcement)**:
  - `client-script/dom-serializer.js:1193, 1426, 1444`: For real dialogs, outside elements remain dropped. For heuristic overlays, outside elements are emitted with `blocked_by_modal: true` and `in_modal: false`. Modal elements have `in_modal: true` and `blocked_by_modal: false` and are emitted first.
- **B3 (Real-Chromium Perception Coverage for Non-Dialog Overlays & Negative Cases)**:
  - `demo-site/portal-overlay-form.html`: Created generic portal fixture with fixed top search header, fixed side nav filter, fixed bottom cookie bar, Pattern A Bootstrap-style overlay, and Pattern B separate backdrop + card overlay.
  - `demo-site/test_fixtures.js:330-370`: Added behavioral unit tests asserting trigger displays for Pattern A and Pattern B.
  - `ci/e2e/test_ws11_perception_e2e.js:215-345`: Added Test 5 covering:
    - Negative cases: Fixed header search, fixed side nav, and fixed cookie bar do NOT trigger modal detection;
    - Pattern A: `modal_opened: true`, modal inputs emitted first with `in_modal: true`, outside elements have `blocked_by_modal: true`, pre-existing node IDs remain 100% stable;
    - Pattern B: `modal_opened: true`, modal inputs emitted first with `in_modal: true`, outside elements have `blocked_by_modal: true`, pre-existing node IDs remain stable;
    - 800px viewport with 348px Atlas sidebar mounted: Pattern B card still recognized as modal, modal inputs come first, sidebar host excluded.
- **B5 (Link `target="_self"` Restoration)**:
  - `client-script/executor.js:115-155, 160-240`: Wrapped `doClick` and `doOpen` dispatches in `try ... finally` blocks that save original `target` attribute state and cleanly restore original `target` (or remove attribute if none was present) immediately after dispatch.
  - `client-script/test_executor_v2.js:133-185`: Added unit test verifying `target="_self"` during dispatch and full restoration afterwards for both `_blank` and target-less links.
- **L3 & L11 & L7 baseline (from prior step)**:
  - `client-script/dom-serializer.js`: `opens_new_tab` and `target_origin` extraction;
  - `client-script/executor.js`: `same_tab` navigation support and `waitForDomSettle` with structured `change_summary`.

Tests run:
- `node ci/e2e/test_ws11_perception_e2e.js`: 40 passed, 0 failed.
- `node demo-site/test_fixtures.js`: 30 passed, 0 failed.
- `node client-script/test_dom_serializer_v2.js`: 10 passed, 0 failed.
- `node client-script/test_executor_v2.js`: 8 passed, 0 failed.
- `npm run test:js` (all 32 JS test suites): 1291 passed, 0 failed (Floor: 814).
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1103 passed, 0 failed (Floor: 782).
- `python ci/verify_all_tests_run.py`: 1103 backend passed, 1291 JS passed, 9/10 E2E passed (harness.js failed with known Windows headed-extension service-worker timeout).

Next steps:
1. Merge prep (B4): When Lane A merges to main, rebase onto origin/main, keep both new suite lines in `ci/verify_all_tests_run.py`, delete temporary `demo-site/frames-host.html`, `frame-child-1.html`, and `frame-child-2.html` (and their `test_fixtures.js` check), and re-run full gatekeeper.

Requests for other workstreams:
- **Lane A**:
  - `client-script/background.js`: Fix defect L1 (`importScripts('tab-registry.js')` declaration conflict) so `ci/e2e/harness.js` passes on Windows.
- **Lane C**:
  - Consume `change_summary` from `last_action_result` and `blocked_by_modal`/`in_modal`/`opens_new_tab`/`target_origin` from `DomNode`.

Open questions for Raafat:
- None.

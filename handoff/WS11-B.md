# WS11-B Live-Run Fixes (Lane B: Perception & Executor)
Branch: fix/live-b-perception   Last commit: 28dd095   Model used: Gemini 3.8 Flash
Status: in progress

Done:
- **B1 & B6 (False Modal Prevention & Targeted Overlay Heuristic)**:
  - `client-script/dom-serializer.js`: Replaced full-page scans with `document.elementsFromPoint(cx, cy)` centered at page area (accounting for sidebar uncovered area).
  - Pattern (a): fixed wrapper covering $\ge 60\%$ viewport must be topmost non-Atlas element chain at center point.
  - Pattern (b): full-viewport backdrop candidate requires that every element in `elementsFromPoint` above the backdrop belongs to the centered card (`stack[i] === card || card.contains(stack[i])`). If any non-card page element (e.g. hero section) sits between card and backdrop, no modal is detected.
  - `demo-site/portal-hero-fixed-bg.html`: Created generic fixture reproducing normal home page layout with full-viewport fixed background and centered hero search card.
  - `ci/e2e/test_ws11_perception_e2e.js`: Added Test 6 asserting no modal detected, no elements blocked by modal, and search input has `in_modal: false` under both `z-index: 0` and `z-index: -1`.
- **B7 (Clean Production Serializer)**:
  - Removed all `window.__mockModalOverlay` test hooks from `client-script/dom-serializer.js`.
  - Added `elementsFromPoint` mocking to `client-script/test_dom_serializer_v2.js`.
- **B2 (`blocked_by_modal` Enforcement)**:
  - Real dialogs retain outside element occlusion; heuristic overlays emit outside elements with `blocked_by_modal: true` and `in_modal: false`. Modal elements come first with `in_modal: true, blocked_by_modal: false`.
- **B3 (Real-Chromium Perception Coverage)**:
  - Added `demo-site/portal-overlay-form.html` and Test 5 in `ci/e2e/test_ws11_perception_e2e.js` covering Pattern A, Pattern B, negative controls, ID stability, and 800px viewport with Atlas sidebar mounted.
- **B5 (Link `target="_self"` Restoration)**:
  - `client-script/executor.js`: Wrapped `doClick` and `doOpen` in `try ... finally` blocks to restore original link `target` attribute immediately after click dispatch. Unit tested in `test_executor_v2.js`.
- **L3 & L11 & L7 baseline (from prior step)**:
  - Link targeting metadata, same_tab navigation, `waitForDomSettle`, and structured `change_summary`.

Tests run:
- `node ci/e2e/test_ws11_perception_e2e.js`: 48 passed, 0 failed.
- `node demo-site/test_fixtures.js`: 31 passed, 0 failed.
- `node client-script/test_dom_serializer_v2.js`: 10 passed, 0 failed.
- `node client-script/test_executor_v2.js`: 8 passed, 0 failed.
- `npm run test:js` (all 32 JS test suites): 1291 passed, 0 failed (Floor: 814).
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1103 passed, 0 failed (Floor: 782).

Next steps:
1. Rebase onto origin/main (B4) now that Lane A has merged.
2. In `ci/verify_all_tests_run.py`, keep both new suite lines (`test_ws11_perception_e2e.js` and Lane A's suite).
3. Delete `demo-site/frames-host.html`, `demo-site/frame-child-1.html`, `demo-site/frame-child-2.html`, and their checks in `demo-site/test_fixtures.js`.
4. Re-run full gatekeeper.

Requests for other workstreams:
- None.

Open questions for Raafat:
- None.

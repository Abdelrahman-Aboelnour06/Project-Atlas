# WS9 QA and Evals
Branch: test/fixture-portals   Last commit: 2abeb19   Model used: Gemini 3.8 Flash
Status: done

Done:
- demo-site/portal-megamenu.html:1: Generic Arabic RTL government portal fixture ("بوابة الخدمات الحكومية التجريبية") with a CSS `:hover` and `:focus-within` mega-menu toggle under "خدمات المواطنين" (`aria-haspopup="true"`, `aria-expanded="false"`, `aria-controls="citizen-services-dropdown"`) containing link `traffic-prosecution-link` pointing to `portal-inquiry.html`.
- demo-site/portal-inquiry.html:1: Traffic violations inquiry page with a client-side form (`#violations-inquiry-form`). Implements strict privacy controls preventing national ID or plate numbers from being placed in URL query parameters (`event.preventDefault()`). Enforces 14-digit national ID pattern (`[0-9]{14}`, `required`, `maxlength="14"`), Arabic letters and plate numbers. Displays real-time validation errors on invalid input, and upon valid submission renders a client-side fake violations table (`#violations-table`) with 3 fake violations and 550 ج.م total amount (`#total-amount`).
- demo-site/portal-megamenu-variant.html:1: Unbiased variant fixture proving zero hard-coding. Shuffles service order and renames labels ("بوابة المعاملات الحكومية التجريبية", "دليل المعاملات والخدمات الموحدة", "مخالفات رخص المركبات والقيادة"). Uses JS button click mechanics with `aria-controls="variant-services-panel"` and `aria-expanded="false"` / `"true"`.
- demo-site/portal-inquiry-variant.html:1: Variant inquiry form with alternate IDs and Arabic labels (`#civil-id`, `#vehicle-plate-num`, `#vehicle-plate-chars`), client-side validation, and fake results rendering.
- demo-site/portal-drawer.html:1: Off-canvas drawer fixture featuring a hamburger button (`#drawer-hamburger`, `aria-label`, `aria-controls="offcanvas-drawer"`, `aria-expanded="false"`) that expands a sliding drawer nav (`aria-hidden="true"` -> `aria-hidden="false"`) holding `#drawer-traffic-link`.
- demo-site/portal-grid.html:1 & demo-site/portal-grid-services.html:1: Two-step catalog navigation fixture. Home page features `#all-services-link` pointing to catalog grid, which renders service cards including `#grid-traffic-link`.
- demo-site/portal-search.html:1: Search-only portal fixture with a search form (`role="search"`, `#site-search-form`). Services are not statically exposed; searching for traffic keywords ("مرور", "مخالفات") renders the dynamic result link `#search-result-traffic-link`.
- demo-site/portal-deadend.html:1: Exploration boundary fixture. Features only general cultural and meteorological services without any vehicle or violation endpoints, verifying backtracking and `max_hops` termination.
- backend/tests/replay/scenarios/: Created 6 structured scenario contract files (`portal_megamenu.json`, `portal_megamenu_variant.json`, `portal_drawer.json`, `portal_grid.json`, `portal_search.json`, `portal_deadend.json`) defining `start_page`, `goal_text` (Arabic & English), `expected_target_page`, `required_inputs`, and `expected_end_state`.
- backend/tests/replay/test_portal_fixtures_validation.py:1: Added 27 pytest validation tests asserting structural DOM integrity, ARIA attributes, CSS visibility rules, form constraints (14-digit pattern, no GET method), and dead-end absence. Uses standard library only (no external dependencies, zero skip, zero xfail).
- ci/e2e/test_portal_fixtures_e2e.js:1: Standalone Playwright E2E harness running headless Chromium in ~2.5 seconds. Serves pages through `demo-site/server.py`, validates RTL layout, menu hover expansion, JS drawer toggles, form validation, absence of URL query string leakage, client-side results rendering, and dead-end boundary.
- ci/verify_all_tests_run.py:34: Registered `"test_portal_fixtures_e2e.js"` in `CI_E2E_SUITES`.

Tests run:
- `node ci/e2e/test_portal_fixtures_e2e.js`: 7 passed, 0 failed in 2.5s
- `LLM_PROVIDER=mock pytest backend/tests/replay/test_portal_fixtures_validation.py -v`: 27 passed, 0 failed in 0.09s
- `node demo-site/test_fixtures.js`: 23 passed, 0 failed
- `python3 ci/verify_all_tests_run.py --dry-run`: 81 total test files discovered (0 skipped, 5 E2E harnesses registered)

Next steps:
1. Integrator to merge `test/fixture-portals` into `main`.
2. WS6 (Navigator) to use scenario files in `backend/tests/replay/scenarios/` for multi-hop goal-loop exploration and backtracking tests.

Requests for other workstreams:
- WS2 / WS5: In `backend/app/routes/chat.py:608`, an unexpected indentation (`IndentationError: unexpected indent`) was observed during full backend test discovery; please resolve syntax in `chat.py`.
- WS4: In `client-script/dom-serializer.js`, an unexpected token error (`Unexpected token 'catch'`) was observed during `test_extension.js` syntax verification; please resolve syntax in `dom-serializer.js`.

Open questions for Raafat:
- None.

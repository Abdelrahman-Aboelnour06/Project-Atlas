# WS9 QA and Evals
Branch: test/fixture-portals   Last commit: ed0cd5b   Model used: Gemini 3.8 Flash
Status: not started

Done:
- Checked out branch `test/fixture-portals` from latest `origin/main` (`ed0cd5b`).
- Reviewed `AGENTS.md` (Prime Directive: 100% universal across all websites, no hardcoding, standard W3C DOM/ARIA specs).
- Reviewed `docs/plans/atlas_multistep_arabic_plan.md` (WS9 scope, acceptance criteria, wave execution dependencies).
- Ran baseline test suites to verify quality floors:
  - `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 957 passed, 0 failed.
  - `LLM_PROVIDER=mock pytest backend/tests -q`: 957 passed, 0 failed.
  - `npm run test:js`: 1,136 passed, 0 failed across all JS and demo-site fixture suites.
  - Verified Playwright Chromium headless launch and axe-core accessibility compliance (`a11y_axe.js`).
- Created detailed implementation plan at `implementation_plan.md` for user review before writing code.

Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 957 passed, 0 failed
- `LLM_PROVIDER=mock pytest backend/tests -q`: 957 passed, 0 failed
- `npm run test:js`: 1,136 passed, 0 failed
- `node ci/e2e/a11y_axe.js`: 19 passed, 0 failed

Next steps:
1. Wait for user review and approval of `implementation_plan.md`.
2. Implement offline fixture portal pages under `demo-site/`:
   - `portal-megamenu.html` (Arabic, RTL, hover & click mega-menu "خدمات المواطنين" with link to "نيابات المرور")
   - `portal-inquiry.html` (Arabic, RTL, inquiry form with 14-digit national ID and plate inputs)
   - `portal-violations-result.html` (Arabic, RTL, results table with fake violations and summary fine)
   - `portal-megamenu-variant.html` (reordered services, renamed labels proving zero hard-coding)
   - `portal-inquiry-variant.html` (variant inquiry form with alternate labels)
   - `portal-drawer.html` (accessible off-canvas hamburger drawer)
   - `portal-grid.html` & `portal-grid-services.html` (services behind "All services" catalog page)
   - `portal-search.html` (search-only service discovery flow)
   - `portal-deadend.html` (portal devoid of target services to verify exploration bounds)
3. Implement mock-LLM-driven replay scenarios in `backend/tests/replay/test_portal_fixtures_replay.py`.
4. Implement Playwright E2E test harness in `ci/e2e/test_portal_fixtures_e2e.js`.
5. Register `test_portal_fixtures_e2e.js` in `CI_E2E_SUITES` within `ci/verify_all_tests_run.py`.
6. Run full verification suite and update `handoff/WS9.md`.

Requests for other workstreams:
- None.

Open questions for Raafat:
- None.

# WS11-C Live-Run Fixes (Lane C: Backend Reliability, Routing, Verification & Scoping)
Branch: fix/live-c-backend   Last commit: 0b16534   Model used: Gemini 3.8 Flash
Status: in progress (L3, L4, L5, L6, L7, L8, L11 done; awaiting Lane A and B merge to main for C-E2E)
Done:
- `backend/app/models/dom.py:64-165`: Added perception fields `opens_new_tab`, `target_origin`, `in_modal`, `blocked_by_modal` to `DomNode`. Implemented `coerce_dom_map()` with generous bounds (label: 512, inner_text: 2000, href: 2048), safe landmark nulling, numeric string casting for `maxlength`, and privacy-safe logging (field names/counts only, no node values) resolving L8.
- `backend/app/models/goal.py:27-142`: Added `same_tab` to `PlanStep`, `"requires_origin_confirmation"` to `GoalOverallStatus`. Added `coerce_dom_map()` validation on `GoalStepRequest`. Dynamically stripped Wave 4 fields from generated OpenAPI JSON schema in `model_json_schema()` to maintain 100% byte-for-byte fidelity with `contracts/*.schema.json`.
- `backend/app/models/request.py:16-43`: Added `@field_validator("dom_map", mode="before")` on `AgentMessage` using `coerce_dom_map()`, ensuring `/v1/chat` coercion.
- `backend/app/i18n.py:58-154`: Added `cross_origin_detected` translations (`ar-EG` and `en`). Hardened `t()` in `ar-EG` to guarantee zero unquoted Latin characters by translating/stripping English verifier text, resolving L5.
- `backend/app/agent/form_filler.py:35-139`: Added `is_search_or_filter_form()` detecting search landmarks/roles, filter bars, and header search inputs (L6). Scoped `extract_required_form_fields()` and `plan_form_fill()` to `in_modal: True` nodes when a modal is active (L7).
- `backend/app/agent/navigator.py:84-177`: Scoped `plan_milestone_step()` to `in_modal: True` nodes when a modal is active (L7). Filtered `tried_set` at the top of candidate step resolution to prevent repeated no-op clicks (L4).
- `backend/app/routes/chat.py:44-530`:
  - Added L3 cross-origin gate: inspects next step target; if target origin differs from current origin (including subdomains), prompts user with `status="requires_origin_confirmation"` and target hostname; remembers confirmed origins in `GoalStore`. Sets `step.same_tab = True` automatically when target origin matches current origin.
  - Added L4 no-op click handling: demotes false `goal_failed` to `in_progress`, appends element to `tried`, and forces navigation to next candidate.
  - Added L6 form relevance gate: `_is_form_relevant()` checks goal relevance against form labels, page title, headings, and breadcrumbs, and excludes search/filter forms from submit confirmation.
  - Added L11 visual change detection: positive change signals (URL change, DOM mutation fingerprint, added visible count, text change) override verifier "no change" reports in `routes/chat.py` (preserving 0 diff lines in `verifier.py`).
- `backend/tests/fixtures_lane_c/*`: Captured real DOM serializer snapshots using Playwright for modal, tiles, and search listing patterns.
- `backend/tests/test_ws11_lane_c_live_fixes.py:1-417`: Created 16 comprehensive unit and regression tests covering all defects L3, L4, L5, L6, L7, L8, and L11.
Tests run:
- Backend pytest (from `backend/`): `cd backend && LLM_PROVIDER=mock pytest tests/ -q` -> 1119 passed, 0 failed, 2 warnings in 102.95s.
- Backend pytest (from root): `LLM_PROVIDER=mock pytest backend/tests -q` -> 1119 passed, 0 failed, 2 warnings in 102.81s.
- JavaScript unit tests: `npm run test:js` -> 23 suites executed, 1277 passed, 0 failed.
- Extension packager: `node client-script/package_extension.js` -> packaged 21 files into `dist/project-atlas-extension.zip` cleanly.
- CI Gatekeeper: `python ci/verify_all_tests_run.py` -> Backend 1119 passed (floor: 782), JS 1277 passed (floor: 814), all 8 Playwright E2E suites passed (a11y_axe, run_multi_tab_suite, test_latent_reveal_e2e, test_portal_fixtures_e2e, test_wave3_ppo_flow_e2e, test_ws5_portal_router_e2e, test_ws7_slots_e2e, ui_sidebar_behavior). Note: `ci/e2e/harness.js` timed out on Windows MV3 service worker registration as expected and noted in workstream rules; passes in Linux CI mode.
Next steps:
1. Commit and push current Lane C changes to `origin/fix/live-c-backend`.
2. Await PR merge of `fix/live-a-client` (Lane A) and `fix/live-b-perception` (Lane B) into `origin/main`.
3. Once Lanes A & B are merged, rebase `fix/live-c-backend` on `origin/main`.
4. Implement cross-lane E2E suite `ci/e2e/test_wave4_live_patterns_e2e.js` covering the 4 live scenarios (`portal-tiles.html`, `portal-modal-form.html`, `frames-host.html`, cross-origin navigation).
5. Register in `CI_E2E_SUITES` in `ci/verify_all_tests_run.py`.
6. Run 3 consecutive times to ensure 100% pass rate.
Requests for other workstreams:
- None.
Open questions for Raafat:
- None.

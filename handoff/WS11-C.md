# WS11-C Live-Run Fixes (Lane C: Backend Reliability, Routing, Verification & Scoping)
Branch: fix/live-c-backend   Last commit: d3e3b66   Model used: Gemini 3.8 Flash
Status: in progress (L3, L4, L5, L6, L7, L8, L11 done; C1–C6 review feedback addressed; awaiting Lane B merge to main for C-E2E)
Done:
- `backend/app/models/dom.py:64-165`: Added perception fields `opens_new_tab`, `target_origin`, `in_modal`, `blocked_by_modal` to `DomNode`. Implemented `coerce_dom_map()` with generous bounds (label: 512, inner_text: 2000, href: 2048), safe landmark nulling, numeric string casting for `maxlength`, and privacy-safe logging (field names/counts only, no node values) resolving L8.
- `backend/app/models/goal.py:27-142`: Added `same_tab` to `PlanStep`, `"requires_origin_confirmation"` to `GoalOverallStatus`. Deleted `model_json_schema` overrides, synchronizing disk contracts directly (C3).
- `contracts/goal_step.request.schema.json` & `contracts/goal_step.response.schema.json`: Synchronized with models, adding optional `same_tab`, `opens_new_tab`, `target_origin`, `in_modal`, `blocked_by_modal`, and `"requires_origin_confirmation"` status (C3).
- `backend/app/models/request.py:16-43`: Added `@field_validator("dom_map", mode="before")` on `AgentMessage` using `coerce_dom_map()`, ensuring `/v1/chat` coercion (L8).
- `backend/app/i18n.py:85-310`: Added `cross_origin_detected` translations (`ar-EG` and `en`) with quoted host placeholder `'{host}'` preserving exact host visibility while maintaining Arabic purity (C2). Removed blanket regex Latin strip from `t()`; mapped verifier failures to structured Arabic reason keys. Quoted `nav_exploring_menu` target parameter.
- `backend/app/agent/form_filler.py:35-139`: Added `is_search_or_filter_form()` detecting search landmarks/roles, filter bars, and header search inputs (L6). Scoped `extract_required_form_fields()` and `plan_form_fill()` to `in_modal: True` nodes when a modal is active (L7).
- `backend/app/agent/navigator.py:84-177`: Scoped `plan_milestone_step()` to `in_modal: True` nodes when a modal is active (L7). Filtered `blocked_by_modal: True` nodes when modal is inactive (C5). Filtered `tried_set` at the top of candidate step resolution to prevent repeated no-op clicks (L4).
- `backend/app/routes/chat.py`:
  - L3/Plan 3: Cross-origin gate inspects next step target; if target origin differs from current origin (subdomain counts as different), prompts user with `status="requires_origin_confirmation"` and target hostname; remembers confirmed origins in `GoalStore`. Sets `step.same_tab = True` automatically when target origin matches current origin.
  - L4/C4: Demotes `goal_failed` to `in_progress` only upon structured evidence of no-change (`has_change_summary and not any_positive_change` or identical URL, text, and DOM fingerprints). If positive changes occurred and verifier failed for other reasons, failure is preserved.
  - L6/C1: Universal `_is_form_relevant()` with zero topic words (removed keyword tuple). Checks form labels against goal with stopwords filtering and stem/prefix matching; context relevance via headings/breadcrumbs/page_text; navigation path history. Sensitive/password fields require context/auth intent and do not qualify forms on their own. Search/filter forms excluded unconditionally.
  - L7/C5: Modal perception and scoping. Irrelevant modals (newsletters, cookie consent) are dismissed with a single close step (`_find_modal_close_control()` or Escape).
  - L8/C6: Generous DOM coercion across `/v1/chat` and `/v1/chat/goal_step`. Added `_safe_int()` for `added_visible_count` to prevent `TypeError` on null/non-integer values.
  - L11: Positive change signals (URL change, DOM mutation fingerprint, added visible count, text change) override verifier "no change" reports in `routes/chat.py` (preserving strictly 0 diff lines in `verifier.py` and `llm_client.py`).
- `backend/tests/fixtures_lane_c/*`: Captured real DOM serializer snapshots using Playwright for modal, tiles, and search listing patterns.
- `backend/tests/test_ws11_lane_c_live_fixes.py:1-915`: 22 comprehensive unit and regression tests covering L3, L4, L5, L6, L7, L8, L11 and review items C1, C2, C3, C4, C5, C6.
Tests run:
- Backend pytest (from `backend/`): `cd backend && LLM_PROVIDER=mock pytest tests/ -q` -> 1125 passed, 0 failed, 2 warnings in 85.04s.
- Backend pytest (from root): `LLM_PROVIDER=mock pytest backend/tests -q` -> 1125 passed, 0 failed, 2 warnings in 85.35s.
- JavaScript unit tests: `npm run test:js` -> 1284 passed, 0 failed (33/33 files executed).
- Extension packager: `node client-script/package_extension.js` -> packaged 21 files into `dist/project-atlas-extension.zip` cleanly (SHA-256: 495a6c21a3a631ac39948d1f5db19cc0f929301bea2e6fdd641c4eb2ab152f24).
- Production diff topic words audit: 0 topic keywords across all modified production files (`backend/app/agent/navigator.py`, `backend/app/i18n.py`, `backend/app/models/goal.py`, `backend/app/routes/chat.py`).
- Zero-diff invariants: `backend/app/agent/verifier.py` (0 diff lines), `backend/app/agent/llm_client.py` (0 diff lines).
Next steps:
1. Commit all Lane C changes and push to `origin/fix/live-c-backend`.
2. Await merge of `fix/live-b-perception` (Lane B) into `origin/main` (Lane A already merged in ee29884).
3. Once Lane B is merged into `origin/main`, rebase `fix/live-c-backend` on `origin/main`.
4. Implement cross-lane E2E suite `ci/e2e/test_wave4_live_patterns_e2e.js` covering the 4 live scenarios (`portal-tiles.html`, `portal-modal-form.html`, `frames-host.html`, cross-origin navigation).
5. Register in `CI_E2E_SUITES` in `ci/verify_all_tests_run.py`.
6. Run 3 consecutive times to ensure 100% pass rate.
Requests for other workstreams:
- None.
Open questions for Raafat:
- None.

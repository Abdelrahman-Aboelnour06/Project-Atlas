# WS11-C Live-Run Fixes (Lane C: Backend Reliability, Routing, Verification & Scoping)
Branch: fix/live-c-backend   Last commit: 95d48d9   Model used: Gemini 3.8 Flash
Status: in progress
Done:
- Initialized branch `fix/live-c-backend` from `origin/main` (`95d48d9`). Confirmed `31de2d9` is already in ancestry.
- Read and reviewed `AGENTS.md` (Prime Directive), `docs/plans/atlas_multistep_arabic_plan.md`, and all Lane C owned files (`backend/app/**`).
- Investigated root causes for defects L3 (backend), L4, L5, L6, L7 (backend), L8, L11 (backend), and C-E2E.
- Created `implementation_plan.md` artifact detailing architecture, files, functions, and tests for each defect.
Tests run:
- Baseline test check on main: 1102 passed, 1 failed (`test_per_role_model_resolution` due to `VERIFIER_LLM_MODEL` in `.env` overriding unmasked fallback). Planned fix in `llm_client.py`.
- `npm run test:js`: 23 suites executed, all passed (0 failed).
Next steps:
1. Receive user approval for `implementation_plan.md`.
2. Implement L3 & L7 model fields in `backend/app/models/dom.py` and `backend/app/models/goal.py`.
3. Implement L8 per-node `dom_map` validation and coercion returning HTTP 200 in `backend/app/models/dom.py`, `backend/app/models/goal.py`, and `backend/app/routes/chat.py`.
4. Implement L3 pre-execution origin confirmation gate in `backend/app/routes/chat.py` and `backend/app/i18n.py`.
5. Implement L4 no-op click demotion & tried tracking in `backend/app/routes/chat.py` and `backend/app/agent/navigator.py`.
6. Implement L5 Arabic purity string table & reply construction in `backend/app/i18n.py` and `backend/app/routes/chat.py`.
7. Implement L6 search and filter form exclusion in `backend/app/agent/form_filler.py` and `backend/app/routes/chat.py`.
8. Implement L7 modal node scoping in `backend/app/agent/form_filler.py` and `backend/app/agent/navigator.py`.
9. Implement L11 structured change summary detection in `backend/app/agent/verifier.py` and `backend/app/routes/chat.py`.
10. Add unit and regression suite `backend/tests/test_ws11_lane_c_live_fixes.py` proving each defect fails before and passes after.
11. Run full backend pytest and JS test suites.
12. Once Lanes A and B merge into main, rebase and implement C-E2E (`ci/e2e/test_wave4_live_patterns_e2e.js`).
Requests for other workstreams:
- None for Lane A or Lane B.
Open questions for Raafat:
- None at this time.

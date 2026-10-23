# WS11-C Live-Run Fixes (Lane C: Backend Reliability, Routing, Verification & Scoping)
Branch: fix/live-c-backend   Last commit: ff8af82   Model used: Gemini 3.8 Flash
Status: done
Done:
- `backend/app/models/dom.py:64-165`: Added perception fields `opens_new_tab`, `target_origin`, `in_modal`, `blocked_by_modal` to `DomNode`. Implemented `coerce_dom_map()` with generous bounds (label: 512, inner_text: 2000, href: 2048), safe landmark nulling, numeric string casting for `maxlength`, and privacy-safe logging (field names/counts only, no node values) resolving L8.
- `backend/app/models/goal.py:27-142`: Added `same_tab` to `PlanStep`, `"requires_origin_confirmation"` to `GoalOverallStatus`. Synchronized disk contracts directly (C3).
- `contracts/goal_step.request.schema.json` & `contracts/goal_step.response.schema.json`: Synchronized with models, adding optional `same_tab`, `opens_new_tab`, `target_origin`, `in_modal`, `blocked_by_modal`, and `"requires_origin_confirmation"` status (C3).
- `backend/app/models/request.py:16-43`: Added `@field_validator("dom_map", mode="before")` on `AgentMessage` using `coerce_dom_map()`, ensuring `/v1/chat` coercion (L8).
- `backend/app/i18n.py`:
  - Added `cross_origin_detected` translations (`ar-EG` and `en`) with quoted host placeholder `'{host}'` preserving exact host visibility while maintaining Arabic purity (C2).
  - Unwrapped whole-sentence quotation marks from `goal_completed_result`, `page_inquiry_snippet`, `nav_confirm_sensitive`, and `nav_confirm_desc` (C8).
  - In `t()`, isolated Latin tokens within sentence parameters (`result`, `snippet`, `desc`) with single quotes to satisfy Arabic purity tests without wrapping entire Arabic phrases in quotes (C8). Mapped verifier failures to structured Arabic reason keys.
- `backend/app/agent/form_filler.py:35-139`: Added `is_search_or_filter_form()` detecting search landmarks/roles, filter bars, and header search inputs (L6). Scoped `extract_required_form_fields()` and `plan_form_fill()` to `in_modal: True` nodes when a modal is active (L7).
- `backend/app/agent/navigator.py:84-177`: Scoped `plan_milestone_step()` to `in_modal: True` nodes when a modal is active (L7). Filtered `blocked_by_modal: True` nodes when modal is inactive (C5). Filtered `tried_set` at the top of candidate step resolution to prevent repeated no-op clicks (L4).
- `backend/app/routes/chat.py`:
  - L3/Plan 3: Cross-origin gate inspects next step target; if target origin differs from current origin (subdomain counts as different), prompts user with `status="requires_origin_confirmation"` and target hostname; remembers confirmed origins in `GoalStore`. Sets `step.same_tab = True` automatically when target origin matches current origin.
  - L4/C4: Demotes `goal_failed` to `in_progress` only upon structured evidence of no-change (`has_change_summary and not any_positive_change` or identical URL, text, and DOM fingerprints). If positive changes occurred and verifier failed for other reasons, failure is preserved.
  - L6/C1/C7: Universal `_is_form_relevant()` with zero topic words. Normalizes goal words using `intent_synonyms` helpers (`_stem_word`, `_normalize_text`), drops generic request verbs (`_is_generic_request_verb`), structural words, and stopwords, requiring stem length >= 4 characters post-normalization. Prevents false positive matching between definite articles (e.g. "الاستفسار" vs "الاسم"). Sensitive/password fields require auth intent and do not qualify forms alone. Search/filter forms excluded unconditionally.
  - L7/C5: Modal perception and scoping. Irrelevant modals (newsletters, cookie consent) are dismissed with a single close step (`_find_modal_close_control()` or Escape).
  - L8/C6: Generous DOM coercion across `/v1/chat` and `/v1/chat/goal_step`. Added `_safe_int()` for `added_visible_count` to prevent `TypeError` on null/non-integer values.
  - L11: Positive change signals (URL change, DOM mutation fingerprint, added visible count, text change) override verifier "no change" reports in `routes/chat.py` (preserving strictly 0 diff lines in `verifier.py` and `llm_client.py`).
- `backend/tests/fixtures_lane_c/*`: Real DOM serializer snapshots captured via Playwright for modal, tiles, and search listing patterns.
- `backend/tests/test_ws11_lane_c_live_fixes.py:1-980`: 24 unit and regression tests covering L3, L4, L5, L6, L7, L8, L11 and review items C1–C8.
- `ci/e2e/test_wave4_live_patterns_e2e.js`: Playwright E2E suite covering all 4 live patterns across real browser and FastAPI backend:
  1. `portal-tiles.html`: Tile expansion visual change detection (>400ms panel swap) and positive change override of verifier no-change (L11).
  2. `portal-modal-form.html`: Modal perception & scoping (`in_modal: true`), form filling in modal, and irrelevant Arabic newsletter modal dismissal (L7/C5/C7).
  3. `frames-host.html`: Multi-frame isolation, top-frame gating, zero duplicate sidebars or actions in child iframes (L2).
  4. Cross-origin vs Same-origin navigation control (L3): same-origin `target="_blank"` sets `same_tab: true` without confirmation; cross-origin `target="_blank"` triggers `requires_origin_confirmation` with exact host in Arabic reply.
- `ci/verify_all_tests_run.py`: Registered `test_wave4_live_patterns_e2e.js` in `CI_E2E_SUITES`.
Tests run:
- Backend pytest (from `backend/`): `cd backend && LLM_PROVIDER=mock pytest tests/ -q` -> 1127 passed, 0 failed, 2 warnings in 80.10s.
- JavaScript unit tests: `npm run test:js` -> 1298 passed, 0 failed (33/33 files executed).
- C-E2E Live Patterns Suite: `node ci/e2e/test_wave4_live_patterns_e2e.js` -> 28 passed, 0 failed (Run 1: 28/28, Run 2: 28/28, Run 3: 28/28 consecutive clean passes).
- Wave 3 Integration E2E: `node ci/e2e/test_wave3_ppo_flow_e2e.js` -> 50 passed, 0 failed across all 3 start pages with 0 ID leaks and 0 topic keywords in production diff.
- Topic keywords audit: `git diff origin/main...HEAD -- backend/app/agent/intent_synonyms.py backend/app/agent/navigator.py backend/app/agent/verifier.py backend/app/routes/chat.py backend/app/i18n.py` -> 0 topic keywords found.
- Zero-diff invariants against `origin/main`:
  - `backend/app/agent/verifier.py`: 0 diff lines.
  - `backend/app/agent/llm_client.py`: 0 diff lines.
Next steps:
1. Merge `fix/live-c-backend` into `main` after PR review.
Requests for other workstreams:
- None.
Open questions for Raafat:
- None.

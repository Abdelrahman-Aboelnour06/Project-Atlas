# WS5 Router and Loop
Branch: feat/goal-router   Last commit: cf97db2   Model used: Gemini 3.8 Flash
Status: in progress
Done:
- backend/app/i18n.py:112,208: Added symmetric i18n keys for `router_goal_ack` and `loop_repeated_action_limit` in English and Egyptian Colloquial Arabic (`ar-EG`).
- backend/app/routes/chat.py:133: Added `contract_version: int = 2` to `ChatRequest` (preserving legacy behavior for contract_version < 3).
- backend/app/routes/chat.py:151-274: Implemented `classify_intent_route(question, dom_map, page_text, language)`:
  - Question FIRST: informational questions about page content.
  - Direct: short command (<=6 words) matching a VISIBLE node with score >= 0.85.
  - Explicit Goal: multi-step task verbs, service requests, inquiries, payments (e.g. `عايز`, `اريد`, `محتاج`, `استعلام`, `استفسار`, `ادفع`, `سجل`, `قدم`) route to `goal` even if words match links.
  - LLM classification in `json_mode` when rules are unsure, disabled when `is_limited_mode()` is True.
  - Goal fallback when no visible match.
- backend/app/routes/chat.py:301-370: Integrated router in `chat_endpoint`:
  - When `contract_version >= 3`: routes to `goal` (seeding `GoalState` with `max_hops=15`), `direct` (single-shot plan), or `question` (conversational QA).
  - When `contract_version < 3`: keeps today's exact legacy behavior.
- backend/tests/test_ws5_router.py: Added 12 comprehensive unit and integration tests covering vehicle violations, Egyptian Arabic bill pay, visible direct click, latent node exclusion from direct, question precedence, limited mode fallback, and Prime Directive zero-domain hardcoding.
Tests run:
- cd backend && LLM_PROVIDER=mock pytest tests/test_ws5_router.py -v: 12 passed, 0 failed in 0.29s
- cd backend && LLM_PROVIDER=mock pytest tests/ -q: 1063 passed, 0 failed in 5.82s
- LLM_PROVIDER=mock pytest backend/tests -q: 1063 passed, 0 failed in 5.86s
Next steps:
1. Implement client goal loop, `awaiting_user_input` form rendering, secret vault tokenization, and repeat step loop abort in `client-script/content.js`.
2. Verify parameter passthrough in `client-script/goal-handoff.js` and `client-script/background.js`.
3. Add JS unit tests in `client-script/test_ws5_router_loop.js`.
4. Add Playwright E2E test in `ci/e2e/test_ws5_portal_router_e2e.js`.
5. Register tests in `package.json` and `ci/verify_all_tests_run.py`.
Requests for other workstreams:
- None.
Open questions for Raafat:
- None.

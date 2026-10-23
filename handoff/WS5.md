# WS5 Router and Loop
Branch: feat/goal-router   Last commit: e6c22c6   Model used: Gemini 3.8 Flash
Status: done

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
- client-script/content.js:118,533-655: Implemented `renderAwaitingUserInputForm` inside sidebar closed shadow root (`dir="auto"`) with sensitive field masking (`type="password"`), tokenization via `window.AtlasSecretVault.store(origin, category, field.ref, rawVal)`, immediate clearing of inputs post-submit, and submission of `{vault:...}` tokens with zero raw PII leakage to logs, speech, or chat history.
- client-script/content.js:659-992: Upgraded `executeGoalHop`:
  - Single-flight lock (`isHopInProgress`) preventing duplicate concurrent runs.
  - Navigation settle window integration.
  - Sends active `language` (`window.AtlasSidebar?.getLanguage?.() || "en-US"`), `contract_version: 3`, `page_text`, and previous `lastActionResult`.
  - Repeat step safety guard: detects 3 identical consecutive actions on the same element and halts the loop with a localized warning.
  - Max hops enforcement (seeds with `max_hops=15`).
  - Interactive status handling for `awaiting_user_input` and `requires_confirmation`.
  - Terminal status handling for `goal_complete` and `goal_failed`.
- client-script/content.js:1274,1503,1573: Applied WS3 one-liners ensuring `language` and `contract_version: 3` are dispatched across `ATLAS_CHAT`, `ATLAS_GOAL_STEP`, and `ATLAS_SUMMARY`.
- client-script/test_ws5_router_loop.js: Created standalone 8-test acceptance suite validating router loop, vault tokenization, repetition abort, max hops, and stop control.
- ci/e2e/test_ws5_portal_router_e2e.js: Created 13-assertion Playwright E2E test driving `demo-site/portal-inquiry.html`, asserting pause at `awaiting_user_input`, password masking, vault tokenization, zero raw digits in network payload or chat, and completion.
- package.json:9: Registered `node client-script/test_ws5_router_loop.js` in `test:js`.
- ci/verify_all_tests_run.py:29: Added `test_ws5_portal_router_e2e.js` to `CI_E2E_SUITES`.

Tests run:
- cd backend && LLM_PROVIDER=mock pytest tests/test_ws5_router.py -v: 12 passed, 0 failed in 0.29s
- cd backend && LLM_PROVIDER=mock pytest tests/ -q: 1063 passed, 0 failed, 7 warnings in 5.83s
- LLM_PROVIDER=mock pytest backend/tests -q: 1063 passed, 0 failed, 7 warnings in 5.86s
- npm run test:js: 1,216 passed, 0 failed across all 20 JS test suites in 18.2s
- node ci/e2e/test_ws5_portal_router_e2e.js: 13 passed, 0 failed in 1.8s
- python3 ci/verify_all_tests_run.py: 100% checks passed:
  - 100% Backend test files executed (50/50, 1063 passed >= 782 floor)
  - 100% JavaScript test files executed (30/30, 1216 passed >= 814 floor)
  - 100% Playwright E2E Harnesses executed (7/7)
  - 0 failures across all suites.
- node client-script/package_extension.js --verify-only: 100% store-ready, 0 errors.

Next steps:
1. Merge `feat/goal-router` into the integration branch following team protocol.
2. WS6/WS7 will consume the `/v1/chat` seeded `GoalState(max_hops=15)` and `user_inputs` dictionary in `POST /v1/chat/goal_step`.

Requests for other workstreams:
- None.

Open questions for Raafat:
- None.

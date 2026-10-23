# WS5 Router and Loop
Branch: feat/goal-router   Last commit: 2e9313a   Model used: Gemini 3.8 Flash
Status: done

Done:
- backend/app/agent/agentic_planner.py:537-568: Extracted `build_concise_dom(dom_map)` (incorporating `strip_pii_from_dom` and standard serializer label priority `resolved_label` > `aria_label` > `inner_text` > `placeholder` > `name` > `label` while preserving `visible` metadata) and used it in `plan_agentic_action` and `classify_intent_route` without changing planner behavior.
- backend/app/routes/chat.py:193-272:
  - Added targetless scroll/navigation command matching (`scroll down`, `go back`, `انزل`, `اطلع لفوق`, `ارجع`) at priority 0 to route directly to `"direct", None`.
  - Used `agentic_planner.build_concise_dom(dom_map)` in `classify_intent_route` preserving the `visible != False` filter, resolving elements whose attributes are in `resolved_label`/`inner_text` without a `"label"` key.
- backend/tests/test_ws5_router.py:
  - Updated ALL router test DOM maps to serializer-shaped nodes: `{"id": "el_x", "tag": "button", "resolved_label": "...", "inner_text": "...", "visible": True}` with zero `"label"` keys.
  - Added `test_classifier_targetless_scroll_and_nav_routes_to_direct` verifying `"scroll down"`, `"go back"`, `"انزل"`, `"اطلع لفوق"`, and `"ارجع"` route to `direct`.
  - Verified `"click register"` and `"اضغط تسجيل الدخول"` match as `direct` with serializer shapes under limited mode.
- client-script/content.js:957-961, 1236-1262:
  - Set `currentGoalState.requires_confirmation = true` upon receiving confirmation turns.
  - In `handleChatInput`, checked `currentGoalState && (currentGoalState.status === "awaiting_user_input" || currentGoalState.requires_confirmation === true || pendingConfirmation)`.
  - Tokenized input via `AtlasSecretVault.tokenizeCommand` FIRST, displaying the tokenized text (never raw secrets) in the chat bubble.
  - Decoded affirmative ("yes", "أيوة", "ايوة", "نعم", "proceed", "ok") to `"yes"` and negative to `"no"`, resetting `requires_confirmation = false` and resuming `executeGoalHop(currentGoalState)` with `user_response`.
- client-script/test_ws5_router_loop.js:
  - Added test verifying typed `"yes"` during a confirmation resumes `goal_step` with `user_response: "yes"`.
  - Added test verifying typed `"أيوة"` during a confirmation resumes `goal_step` with `user_response: "yes"`.
  - Added test verifying typed chat input during `awaiting_user_input` tokenizes first and displays the tokenized `{vault:...}` text in the chat bubble.
- ci/e2e/test_ws5_portal_router_e2e.js: 13-assertion Playwright E2E suite verifying portal inquiry, shadow root form, vault tokenization, and complete goal loop.

Tests run:
- cd backend && LLM_PROVIDER=mock pytest tests/test_ws5_router.py -v: 14 passed, 0 failed, 1 warning in 0.31s
- cd backend && LLM_PROVIDER=mock pytest tests/ -q: 1065 passed, 0 failed, 7 warnings in 5.92s
- LLM_PROVIDER=mock pytest backend/tests -q: 1065 passed, 0 failed, 7 warnings in 5.85s
- node client-script/test_ws5_router_loop.js: 13 passed, 0 failed in 0.25s
- npm run test:js: 1,221 passed, 0 failed across all JS test suites in 18.2s
- ci/verify_all_tests_run.py: 100% checks passed:
  - 100% Backend test files executed (50/50, 1065 passed >= 782 floor)
  - 100% JavaScript test files executed (30/30, 1221 passed >= 814 floor)
  - 100% Playwright E2E Harnesses executed (7/7)
  - 0 failures across all suites.
- node client-script/package_extension.js --verify-only: 100% store-ready, 0 errors.

Next steps:
1. Merge `feat/goal-router` into integration branch.
2. WS6/WS7 will consume the `/v1/chat` seeded `GoalState(max_hops=15)` and `user_inputs` dictionary in `POST /v1/chat/goal_step`.

Requests for other workstreams:
- None.

Open questions for Raafat:
- None.

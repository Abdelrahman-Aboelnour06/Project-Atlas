# WS5 Router and Loop
Branch: feat/goal-router   Last commit: f8135a2   Model used: Gemini 3.8 Flash
Status: done

Done:
- backend/app/i18n.py:112,208: Added symmetric i18n keys for `router_goal_ack` and `loop_repeated_action_limit` in English and Egyptian Colloquial Arabic (`ar-EG`).
- backend/app/routes/chat.py:133: Added `contract_version: int = 2` to `ChatRequest` (preserving legacy behavior for contract_version < 3).
- backend/app/routes/chat.py:151-345: Implemented WS5 review order in `classify_intent_route`:
  - (a) Explicit command verb (`click`, `press`, `tap`, `open`, `select`, `type`, `اضغط`, `دوس`, `افتح`, `اختار`, `اكتب`) + VISIBLE node >= 0.85 -> `direct`.
  - (b) Question: interrogative start (`what`, `where`, `how`, `when`, `who`, `why`, `ما`, `ماذا`, `ايه`, `فين`, `ازاي`, `امتى`, `كام`, `هل`...) beats goal when no first-person want/need phrase.
  - (c) Explicit goal phrase -> `goal`. All topic nouns removed from `GOAL_TASK_PATTERNS` (`مخالفات`, `مرور`, `رخصة`, `بطاقة`, `كشف`, `معرفة`, `طلب`), keeping verbs/intent phrases only with word boundaries `(?<![-ۿ])(?:...)(?![-ۿ])`, so `سجل` never matches inside `التسجيل`.
  - (d) Other short commands (<= 6 words) + visible match >= 0.85 -> `direct`.
  - (e) Small talk / greetings / thanks (`hello`, `thanks!`, `شكرا`, `ازيك`...), or <= 2 words with no action verb -> `question`.
  - (f) Else LLM in `json_mode` if healthy, else `goal`.
- backend/tests/test_ws5_router.py:239-290: Added `test_ws5_review_fixes_rules_only_limited_mode` covering all 7 review cases under limited mode:
  - "click register" -> `direct`
  - "اضغط تسجيل الدخول" -> `direct`
  - "hello" / "thanks!" / "شكرا" / "ازيك" -> `question`
  - "ما هي مواعيد التسجيل؟" -> `question`
  - "اريد الاستفسار عن مخالفات المركبات" -> `goal`
  - "I want to renew my license" -> `goal`
  - "عايز ادفع الفاتورة" -> `goal`
- client-script/content.js:966-976: Changed confirmation chip handling to decide strictly by option index (`options[0]` = proceed -> `"yes"`, otherwise `"no"`), completely language-agnostic and regex-free.
- client-script/content.js:1232-1256: Added active goal input interception in `handleChatInput`: while `currentGoalState.status` is `awaiting_user_input` or `requires_confirmation`, typed/spoken chat is routed to `goal_step` as `user_response` (tokenized via `AtlasSecretVault.tokenizeCommand`) rather than `/v1/chat`, handling captcha/OTP prompts without fields ("done"/"خلصت" resumes).
- client-script/content.js:853-870: Updated repeat action guard: step signature includes `action` + `element` + `redacted URL` + `hash of visible DOM node ids`. Only aborts when the page has not changed.
- client-script/content.js:632-658: Hardened vault error handling: if `AtlasSecretVault.store` is missing or throws, never sends fake `{vault:...}` token; displays a localized error in sidebar and preserves the form for user retry.
- client-script/test_ws5_router_loop.js: Added test cases for Arabic `t()` confirmation chip index resolution, active goal typed user_response interception, and vault error handling.
- ci/e2e/test_ws5_portal_router_e2e.js: 13-assertion Playwright E2E suite verifying portal inquiry, shadow root form, vault tokenization, and complete goal loop.

Tests run:
- cd backend && LLM_PROVIDER=mock pytest tests/test_ws5_router.py -v: 13 passed, 0 failed in 0.31s
- cd backend && LLM_PROVIDER=mock pytest tests/ -q: 1064 passed, 0 failed, 7 warnings in 5.87s
- LLM_PROVIDER=mock pytest backend/tests -q: 1064 passed, 0 failed, 7 warnings in 5.94s
- npm run test:js: 1,218 passed, 0 failed across all 20 JS test suites in 18.5s
- node ci/e2e/test_ws5_portal_router_e2e.js: 13 passed, 0 failed in 1.8s
- python3 ci/verify_all_tests_run.py: 100% checks passed:
  - 100% Backend test files executed (50/50, 1064 passed >= 782 floor)
  - 100% JavaScript test files executed (30/30, 1218 passed >= 814 floor)
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

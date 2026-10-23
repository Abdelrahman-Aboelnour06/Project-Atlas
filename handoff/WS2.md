# WS2 Language Backend
Branch: feat/lang-backend   Last commit: pending   Model used: Gemini 3.8 Flash
Status: done
Done:
- backend/app/i18n.py: Implemented universal i18n engine with `resolve_reply_language(selected, user_text)` returning 'ar-EG' or 'en-US' (Egyptian colloquial Arabic when selected starts with 'ar', otherwise script mirroring), `is_mostly_non_arabic(text)` (<30% Arabic character detector), and `t(key, lang, **kwargs)` over a 72-key string table with 100% key and parameter symmetry between 'en' and 'ar-EG' (Egyptian colloquial Arabic). Preserved byte-for-byte exact legacy English strings when English is used. Zero website/domain hardcoding (Prime Directive compliant).
- backend/app/agent/summary_prompt.py: Added `language=None` parameter to `build_summary_prompt()`, added `REPLY LANGUAGE: {reply_lang}` prompt line, resolving language via `resolve_reply_language`.
- backend/app/agent/form_filler.py: Added `language=None` parameter to `plan_form_fill()`, resolved reply language and added `REPLY LANGUAGE: {reply_lang}` line in form filler prompt.
- backend/app/agent/planner.py: Added `language=None`, `explicit_only=False` parameters to `plan_goal()`, added `REPLY LANGUAGE: {reply_lang}` line in planner prompt. Implemented normalized Arabic and English regex matcher `_is_explicit_language_switch_request()` so that synthetic page language switch milestone fires only on explicit user requests (e.g. switch/change/translate page language, or حول/غير/ترجم الصفحة/الموقع للعربي) when `explicit_only=True` (used in chat.py `goal_step_endpoint`), while preserving backwards compatibility when `explicit_only=False`.
- backend/app/agent/navigator.py: Added `language=None` parameter to `plan_milestone_step()`, added `REPLY LANGUAGE: {reply_lang}` prompt line, localized user cancellation and heuristic confirmation replies using `t(key, reply_lang)`.
- backend/app/agent/verifier.py: Added `language=None` parameter to `verify_step_outcome()`, `_verify_with_llm()`, and `verify_quorum()`. Added `REPLY LANGUAGE: {reply_lang}` prompt line to LLM verifier prompt. Strictly adhered to Rule 6 (only user-facing explanation reasons steered; verifier statuses, signals, and rules unmodified).
- backend/app/agent/agentic_planner.py: Added `language=None` parameter to `plan_agentic_action()`, added `REPLY LANGUAGE: {reply_lang}` prompt line, added Arabic retry mechanism (if reply language is 'ar-EG' and reply has <30% Arabic letters, retries once with strict Egyptian Arabic instruction, then falls back to `t("request_processed", reply_lang)`). Replaced all user-facing literal replies (search typing/focus, canonical intent, heuristic, page inquiry, cancel, confirm, 401 error, no match) with `t(key, reply_lang)`.
- backend/app/routes/chat.py:
  - Added `language: Optional[str] = Field(default=None, max_length=32)` to `SummaryRequest`.
  - Updated `summary_endpoint()` to pass `language` to `build_summary_prompt()`, with Arabic retry and string table fallback `t("summary_fallback", reply_lang)`.
  - Updated `chat_endpoint()` QA prompt with `REPLY LANGUAGE: {reply_lang}`, Arabic retry, and localized rate limit and authentication error messages.
  - Updated `goal_step_endpoint()` to pass `goal_state.language` to `plan_goal()`, `verify_step_outcome()`, `plan_form_fill()`, and `plan_milestone_step()`.
  - Localized all ~23 fixed replies in `goal_step_endpoint()` (max hops, max handoffs, already terminated, cancel, confirmation received, popup blocked, cross-origin detected, CAPTCHA/OTP blocker prompts and replies, batch form fill prepared) via `t(key, reply_lang)`.
- backend/tests/test_agentic_planner.py: Updated line 268 to explicit request (`"goal": "Switch page to Arabic and order a laptop"`) per user approval; added test that non-explicit goal `"Order a laptop"` produces NO switch milestone; added test that Arabic explicit request `"حوّل الصفحة للعربي واشتري لابتوب"` produces switch milestone.
- backend/tests/test_ws2_language_backend.py: Created comprehensive 24-test suite covering string table symmetry, parameter parity, zero site names, language resolution matrix, script mirroring, mostly-non-arabic heuristic, exact English preservation, all planner branches in Arabic mode (search typing, search focus, canonical, heuristic, page inquiry, confirmation, cancel, no match, LLM retry fallback, LLM mock success), `REPLY LANGUAGE: <lang>` presence across all 7 prompt builders, and route integration tests.
Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 1007 passed, 0 failed in 7.08s
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1007 passed, 0 failed in 6.85s
- `python3 ci/verify_all_tests_run.py`: 1008 backend tests passed (>=782 floor), 1205 core JS tests passed (>=814 floor), 4/4 Playwright harnesses passed, 0 failures
- `backend/tests/test_ws2_language_backend.py`: 24 passed in 0.56s
- `backend/tests/test_agentic_planner.py`: 18 passed in 0.61s
- `backend/tests/test_m2_challenger_stress.py`: 51 passed in 0.09s
Next steps:
- All WS2 tasks completed. Ready for review and merging into main.
Requests for other workstreams:
- WS5 (`client-script/content.js`): In `summarizePageContent()` or wherever `/v1/summary` is invoked, pass `language: window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US"` in the POST payload so the backend summary endpoint receives the user's active language preference.
Open questions for Raafat:
- None.

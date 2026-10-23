# WS2 Language Backend
Branch: fix/lang-mirror   Last commit: 595880f   Model used: Gemini 3.8 Flash
Status: done
Done:
- backend/app/i18n.py:
  - Implemented universal i18n engine with `resolve_reply_language(selected, user_text)` returning 'ar-EG' or 'en-US'. Rule: if selected starts with 'ar', returns 'ar-EG'; if selected starts with 'en', returns 'en-US' (explicit English wins); user script mirroring applies strictly when selected is None/empty.
  - `is_mostly_non_arabic(text)` (<30% Arabic character detector).
  - `t(key, lang, **kwargs)` over a 72-key string table with 100% key and parameter symmetry between 'en' and 'ar-EG' (Egyptian colloquial Arabic). Preserved byte-for-byte exact legacy English strings when English is used. Zero website/domain hardcoding (Prime Directive compliant).
- backend/app/agent/summary_prompt.py: Added `language=None` parameter to `build_summary_prompt()`, added `REPLY LANGUAGE: {reply_lang}` prompt line, calling `resolve_reply_language(language, None)` without passing page text.
- backend/app/agent/form_filler.py: Added `language=None` parameter to `plan_form_fill()`, resolved reply language from goal and added `REPLY LANGUAGE: {reply_lang}` line in form filler prompt.
- backend/app/agent/planner.py: Added `language=None`, `explicit_only=False` parameters to `plan_goal()`, added `REPLY LANGUAGE: {reply_lang}` line in planner prompt. Implemented normalized Arabic and English regex matcher `_is_explicit_language_switch_request()` so that synthetic page language switch milestone fires only on explicit user requests when `explicit_only=True` (used in chat.py `goal_step_endpoint`), while preserving backwards compatibility when `explicit_only=False`.
- backend/app/agent/navigator.py: Added `language=None` parameter to `plan_milestone_step()`, calling `resolve_reply_language(language, goal)` (dropped `milestone.description` and `user_response`), added `REPLY LANGUAGE: {reply_lang}` prompt line, localized user cancellation and heuristic confirmation replies using `t(key, reply_lang)`.
- backend/app/agent/verifier.py: Added `language=None` parameter to `verify_step_outcome()`, `_verify_with_llm()`, and `verify_quorum()`. Calls `resolve_reply_language(language, goal)` (dropped `milestone.description`). Added `REPLY LANGUAGE: {reply_lang}` prompt line to LLM verifier prompt. Strictly adhered to Rule 6 (only user-facing explanation reasons steered; verifier statuses, signals, and rules unmodified).
- backend/app/agent/agentic_planner.py: Added `language=None` parameter to `plan_agentic_action()`, added `REPLY LANGUAGE: {reply_lang}` prompt line, added Arabic retry mechanism (if reply language is 'ar-EG' and reply has <30% Arabic letters, retries once with strict Egyptian Arabic instruction, then falls back to `t("request_processed", reply_lang)`). Replaced all user-facing literal replies (search typing/focus, canonical intent, heuristic, page inquiry, cancel, confirm, 401 error, no match) with `t(key, reply_lang)`.
- backend/app/routes/chat.py:
  - Added `language: Optional[str] = Field(default=None, max_length=32)` to `SummaryRequest`.
  - Updated `summary_endpoint()` to call `resolve_reply_language(payload.language, None)` (never passing page text), passing `language` to `build_summary_prompt()`, with Arabic retry and string table fallback `t("summary_fallback", reply_lang)`.
  - Updated `chat_endpoint()` QA prompt with `REPLY LANGUAGE: {reply_lang}`, Arabic retry, and localized rate limit and authentication error messages.
  - Updated `goal_step_endpoint()` to call `resolve_reply_language(goal_state.language or payload.language, goal_state.goal)` (never user_response).
  - Passed `goal_state.language` to `plan_goal()`, `verify_step_outcome()`, `plan_form_fill()`, and `plan_milestone_step()`.
  - Localized all ~23 fixed replies in `goal_step_endpoint()` via `t(key, reply_lang)`.
- backend/tests/test_agentic_planner.py: Updated line 268 to explicit request (`"goal": "Switch page to Arabic and order a laptop"`) per user approval; added test that non-explicit goal `"Order a laptop"` produces NO switch milestone; added test that Arabic explicit request `"حوّل الصفحة للعربي واشتري لابتوب"` produces switch milestone.
- backend/tests/test_ws2_language_backend.py: Comprehensive 27-test suite covering string table symmetry, parameter parity, zero site names, language resolution matrix, explicit English precedence, script mirroring when unset, mostly-non-arabic heuristic, exact English preservation, all planner branches in Arabic mode, `REPLY LANGUAGE: <lang>` presence across all 7 prompt builders, summary with English mode on Arabic page text (asserting no Arabic retry occurs), and navigator with English goal and Arabic milestone label returning English reply.
- Language mirroring follow-up (`fix/lang-mirror`):
  - In `backend/app/i18n.py` `resolve_reply_language(selected, user_text)`: when `selected` starts with 'en', returns 'ar-EG' if `user_text` contains Arabic letters ([؀-ۿ] / `[\u0600-\u06FF]`), otherwise 'en-US'. 'ar' still always returns 'ar-EG'. Unset/empty `selected` continues mirroring user script.
  - In `backend/tests/test_ws2_language_backend.py`: updated `test_resolve_language_explicit_english_vs_arabic_user_text` asserting `language="en-US"` + Arabic user text -> 'ar-EG' and English text -> 'en-US'; kept summary test `language="en-US"` + Arabic page_text -> 'en-US' with no retry; updated `test_resolve_reply_language_matrix`.
Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests -q`: 1038 passed, 0 failed in 8.41s
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1038 passed in 6.87s
- `backend/tests/test_ws2_language_backend.py`: 27 passed in 0.63s
Next steps:
1. Merge branch `fix/lang-mirror` into main after review.
Requests for other workstreams:
- WS5 (`client-script/content.js`): In `summarizePageContent()` or wherever `/v1/summary` is invoked, pass `language: window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US"` in the POST payload so the backend summary endpoint receives the user's active language preference.
Open questions for Raafat:
- None.

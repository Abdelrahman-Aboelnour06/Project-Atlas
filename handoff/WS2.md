# WS2 Language Backend
Branch: fix/lang-mirror   Last commit: 36d087d   Model used: Gemini 3.8 Flash
Status: done
Done:
- backend/app/i18n.py:
  - Updated `resolve_reply_language(selected, user_text)`: when `selected` starts with 'en', returns 'ar-EG' if `user_text` contains Arabic letters ([؀-ۿ] / `[\u0600-\u06FF]`), otherwise 'en-US'. 'ar' still always returns 'ar-EG'. If `selected` is None/empty, script mirroring applies.
  - Preserved caller contract: all callers only pass the user's own text (never page text or milestone descriptions).
- backend/tests/test_ws2_language_backend.py:
  - Updated `test_resolve_language_explicit_english_vs_arabic_user_text`: asserted `language="en-US"` + Arabic user text -> 'ar-EG', and `language="en-US"` + English text -> 'en-US'. Preserved `language="en-US"` + Arabic page_text summary test -> 'en-US' with no retry.
  - Updated `test_resolve_reply_language_matrix`: aligned assertions with the updated rule.
Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests -q`: 1038 passed in 8.41s
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1038 passed in 6.87s
- `backend/tests/test_ws2_language_backend.py`: 27 passed in 0.63s
Next steps:
1. Merge branch `fix/lang-mirror` into main after review.
Requests for other workstreams:
- WS5 (`client-script/content.js`): In `summarizePageContent()` or wherever `/v1/summary` is invoked, pass `language: window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US"` in the POST payload so the backend summary endpoint receives the user's active language preference.
Open questions for Raafat:
- None.

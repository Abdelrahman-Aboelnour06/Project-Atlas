# WS3 Language Client
Branch: feat/lang-client   Last commit: fa8d91e   Model used: Gemini 3.8 Flash
Status: done

Done:
- client-script/speech.js:46: Unified voice and client language storage on key `atlas_lang` ('ar-EG' | 'en-US') with automatic migration on first load from legacy `atlas_voice_lang`. Synchronizes both storage keys on language switch for full backward compatibility across all modules.
- client-script/speech.js:125: Updated `setLanguage()` to persist both `atlas_lang` and `atlas_voice_lang`, and updated storage change listener to monitor both keys for multi-tab synchronization.
- client-script/speech.js:296: Localized speech error feedback messages in `formatSpeechError` to Egyptian Arabic when operating in `ar-EG` mode (e.g., "لم يتم رصد أي صوت. يرجى المحاولة مرة أخرى", "تم رفض إذن استخدام الميكروفون").
- client-script/sidebar.js:68: Added Egyptian Arabic UI dictionary (`SIDEBAR_AR_STRINGS`) and status mapping (`SIDEBAR_OWN_STATUS_MAP`) to localize sidebar chrome (header title, sub-label, pause/resume, stop, popout, close, audio levels, suggestions, input placeholder, and confirmation chip action regex).
- client-script/sidebar.js:128: Localized onboarding guided tour into Egyptian Arabic (`AR_TOUR_STEPS`) while preserving original English walkthrough (`DEFAULT_TOUR_STEPS`), applying `dir="rtl"` to the tour card in Arabic mode.
- client-script/sidebar.js:189: Maintained pill visible text strictly as `"EN"` / `"AR"`, while putting `"Atlas language"` in `aria-label` and `title` (prefixed with `"EN — "` / `"AR — "` to satisfy WCAG 2.5.3 Label in Name).
- client-script/sidebar.js:255: Implemented universal bidirectional text rendering on chat bubbles with `dir="auto"` on both the bubble container and text node, applying `lang="ar"` only when the message text is predominantly Arabic (`arabicChars.length > latinChars.length`), preserving clean typography for mixed-script inputs.
- client-script/sidebar.js:433: Implemented selective status translation (`SIDEBAR_OWN_STATUS_MAP`) ensuring only sidebar-internal statuses are translated, while backend LLM replies and plan confirmation prompts remain untouched.
- client-script/sidebar.js:952: Exposed `window.AtlasSidebar.getLanguage()` and `setLanguage()`, and kept `window.AtlasSpeech.getLanguage()` bidirectionally synchronized across load, toggle, and storage events so `/v1/chat` immediately sends the active language.
- client-script/tts.js:103: Implemented `getVoiceForLanguage(targetLang, voices)` with hierarchical matching: exact target code (`ar-EG`), prefix (`ar`), language name substring match, and graceful fallback to `null` to let the browser host speech synthesis engine choose its native default voice.
- client-script/options.html:125: Updated onboarding wizard Step 3 to "Atlas Language Preferences" with clear bilingual configuration.
- client-script/options.js:77: Updated options persistence to save both `atlas_lang` and `atlas_voice_lang` during configuration saves.
- client-script/test_extension.js:489: Added unit test assertions verifying `AtlasSidebar.getLanguage()` and `AtlasSidebar.setLanguage()` exports and state transitions.
- client-script/test_lang_client.js:1: Created 44 unit and empirical tests covering migration, synchronization, accessibility, bidi semantics, chrome localization, TTS voice selection, and Prime Directive universal compliance.
- package.json:9: Registered `node client-script/test_lang_client.js` in `test:js`.

Tests run:
- Backend pytest from `./backend`: `cd backend && LLM_PROVIDER=mock pytest tests/ -q`
  Output: `957 passed, 3 warnings in 5.62s`
- Backend pytest from root: `LLM_PROVIDER=mock pytest backend/tests -q`
  Output: `957 passed, 3 warnings in 4.43s`
- Isolated WS3 suite: `node client-script/test_lang_client.js`
  Output: `WS3 Language Client Suite: 44 passed, 0 failed.`
- Full JavaScript test suite: `npm run test:js`
  Output: `All 19 test suites passed cleanly (1,170+ total assertions, 0 failed)`:
  - `client-script/test_extension.js`: 278 passed, 0 failed
  - `client-script/test_secret_vault.js`: 48 passed, 0 failed
  - `client-script/test_dom_serializer_v2.js`: 6 passed, 0 failed
  - `client-script/test_goal_store.js`: 9 passed, 0 failed
  - `client-script/test_executor_v2.js`: 5 passed, 0 failed
  - `client-script/test_ws_client_stress.js`: 44 passed, 0 failed
  - `client-script/test_m7_adversarial_challenger2.js`: 29 passed, 0 failed
  - `client-script/test_sidebar_behavior.js`: 29 passed, 0 failed
  - `client-script/test_connection_resilience.js`: 10 passed, 0 failed
  - `client-script/test_guided_tour.js`: 19 passed, 0 failed
  - `client-script/test_w0_challenger_stress.js`: 39 passed, 0 failed
  - `client-script/test_w1_challenger_stress.js`: 50 passed, 0 failed
  - `client-script/test_w2_challenger_stress.js`: 53 passed, 0 failed
  - `client-script/test_w2_challenger_u2_stress.js`: 62 passed, 0 failed
  - `client-script/test_w3_challenger_stress.js`: 54 passed, 0 failed
  - `client-script/test_w3_challenger_u5_u7.js`: 43 passed, 0 failed
  - `client-script/test_wave2_ux.js`: 51 passed, 0 failed
  - `client-script/test_lang_client.js`: 44 passed, 0 failed
  - `demo-site/test_fixtures.js`: 23 passed, 0 failed

Next steps:
1. Integrator merges `feat/lang-client` into the Wave 1 integration branch.
2. WS5 adopts `window.AtlasSidebar?.getLanguage?.()` in `client-script/content.js`.
3. WS2 verifies backend chat responses in Egyptian Arabic match the incoming `language: "ar-EG"` parameter.

Requests for other workstreams:
- WS5 (`client-script/content.js`):
  Replace lines 975 and 1246:
  Line 975:
  `language: window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || "en-US",`
  Line 1246:
  `const activeLang = window.AtlasSidebar?.getLanguage?.() || window.AtlasSpeech?.getLanguage?.() || window.AtlasSidebar?.getVoiceLanguage?.() || "en-US";`
  Note: Since WS3 keeps `window.AtlasSpeech.getLanguage()` continuously synchronized with `atlas_lang` across initial load, pill toggles, and cross-tab storage changes, `content.js` already automatically sends `"ar-EG"` or `"en-US"` on `/v1/chat` without waiting for WS5.

Open questions for Raafat:
- None. All tasks and adjustments completed and verified against all quality gates.

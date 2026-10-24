# WS12-E live-run fixes, round 2 (Backend Lane: N2-N6 & Reviewer Defect Fixes E-F1 to E-F13)
Branch: fix/live2-e-backend   Last commit: bbca835   Model used: Gemini 3.8 Flash
Status: done

Done:
- `backend/app/agent/intent_synonyms.py:180-245`: E-F1 Arabic & Latin keyword matching shared helper. Added `_tokenize_text` (splitting on whitespace and punctuation FIRST without collapsing spaces), `_token_matches` with Arabic normalization and prefix removal, `matches_keyword_sequence` (contiguous normalized token sequence matching), and `matches_any_keyword` (supporting word boundaries `\b` for Latin and contiguous token sequence matching for Arabic). Added unit tests covering all 6 reviewer critical cases ("رجوع للخلف", "العودة للرئيسية", "استعلام عن المخالفات", "الاسم (مطلوب)", "ابدأ الخدمة الآن", auth heading).
- `backend/app/agent/form_filler.py:40-150`: Replaced keyword checks with `matches_any_keyword`. In `_is_excluded_submit_candidate`, dropped lone `aria_controls` exclusion while retaining `aria-expanded` and `aria-haspopup` (E-F13), enabling valid submits that reference error or status regions.
- `backend/app/agent/form_filler.py:640-740`: Overhauled `classify_auth_wall` (E-F2):
  - Page without modal requires visible password input (`password_nodes`), `page_text` not used, text alone never counts.
  - Modal: classified as login when password input present; classified as sign-up when >= 2 password inputs or modal's own heading/buttons match signup keywords (excluding `<a>` links); login by text only when modal's own heading/buttons match login keywords AND identifier input present.
  - Identifier, password, and submit refs scoped strictly to the same `form_id` or same modal.
  - If login has no password or no identifier field found, initiates fieldless manual-login handoff (never invented fake refs like `"login_id"`/`"password"`).
- `backend/app/routes/chat.py:1425-1440`: E-F3 verifier guard on modals: scoped completion guard to `classify_auth_wall` only, removing `has_active_modal`. A results dialog is not an auth wall, allowing final goals with modal results to complete cleanly without clicking "×".
- `backend/app/agent/navigator.py:260-285`: E-F4 generic CTA boost: evaluates candidate's own `section_label` and `breadcrumb` against goal using `score_text_similarity >= 0.35` when matching `CTA_GENERIC_KEYWORDS`. Goal tokens tokenized without collapsing spaces.
- `client-script/content.js:761` & `backend/app/routes/chat.py:1750-1840`: E-F5 saved login fixes:
  - Added `"login_id"` to `renderAwaitingUserInputForm` category check so sensitive login identifier fields are saved as `{login_id}` instead of fallback `{secret}`.
  - In `chat.py`, verified exact category match for `"login_id"` and `"password"` in `vault_hints`.
  - Emitted `vault_clear: ["login_id", "password"]` on 2nd login failure as well.
- `backend/app/models/goal.py:39-43`, `contracts/goal_step.request.schema.json:1305`, `contracts/goal_step.response.schema.json:929`, `client-script/executor.js:296`: E-F6 prevent double confirmation:
  - Added `vault_login: Optional[bool] = None` to `PlanStep` and exact matching Pydantic JSON schemas.
  - In `executor.js`, bypasses credential confirmation banner only when `step.vault_login === true` AND value matches `TOKEN_REGEX`. Destructive guardrails and non-token credential fills preserve confirmation banner. Emitted login fill/submit steps marked with `vault_login=True`.
- `backend/app/routes/chat.py:870-930, 1105`: E-F7 URL revisit stop & planned backtracks:
  - Tracks `is_planned_navigation` (`last_reason in ("backtrack", "navigate", "sitemap")`), incrementing URL visit count only on unplanned navigation to avoid false halts during deliberate backtracks.
  - Preserved `last_act_control` on confirmation branches instead of overwriting with description.
- `backend/app/routes/chat.py:2180-2225`: E-F8 validation recovery scope: scoped error recovery strictly to fields of the submitted form (`pending_form_id`), counting only fields that have `error_text` or are `invalid` AND not empty.
- `backend/app/routes/chat.py:1690-1740`: E-F9 generic login failure detection: primary signal after login submit checks whether auth wall is still detected (same password/identifier visible) or fields show `invalid`/`error_text`, with case-insensitive Arabic/English failure phrases as fallback.
- `demo-site/portal-service-login.html:150` & `backend/app/routes/chat.py:1445`: E-F10 visible change after submit: replaced `alert()` with in-page `#service-results` table; backend accepts client's structured change summary (`added_visible_count > 0` or `text_changed`) as evidence of visible change.
- `backend/app/i18n.py:190, 400`: E-F11 localized login card labels: added `auth_label_password` ("كلمة المرور") and `auth_label_identifier_fallback` ("اسم المستخدم أو البريد الإلكتروني") in English and Egyptian Arabic.
- `backend/app/routes/chat.py:1938-1945`: E-F12 exact normalized "no account" option matching against `auth_no_account_option` ("معنديش حساب").
- `backend/tests/test_ws12_lane_e_live_fixes.py`: Added 12 new comprehensive unit and integration tests covering E-F1 through E-F13 (29 tests total in lane suite, 100% passing).
- `ci/e2e/test_ws12_live_round2_e2e.js`: Updated Flow C and E6 flows with real goal "اريد الاستفسار عن مخالفات المركبات" and dynamic `page.evaluate(() => document.body.innerText)` (all 34 assertions passing).
- `backend/app/agent/verifier.py`: 0 diff lines (strictly preserved).

Tests run:
- Backend tests (from backend/): `cd backend && LLM_PROVIDER=mock pytest tests/ -q` -> 1156 passed, 2 warnings in 80.34s (0 failures).
- Backend tests (from repo root): `LLM_PROVIDER=mock pytest backend/tests -q` -> 1156 passed, 2 warnings in 80.27s (0 failures).
- Lane E unit tests: `pytest backend/tests/test_ws12_lane_e_live_fixes.py -q` -> 29 passed, 1 warning in 0.45s (0 failures).
- JS tests: `npm run test:js` -> 1321 passed across 25 suites (Floor: 814), 0 failed.
- Extension Packager: `node client-script/package_extension.js` -> 21 production files validated, store-ready ZIP generated cleanly in `dist/`.
- WS12 E2E Suite: `node ci/e2e/test_ws12_live_round2_e2e.js` -> 34 passed, 0 failed.
- CI Gatekeeper Execution: `CI=true python ci/verify_all_tests_run.py` -> 103 test files discovered (56 backend, 33 client, 1 demo, 13 E2E). 1156 backend passed (>= 782 floor), 1321 JS passed (>= 814 floor), 12/13 E2E suites passed (only Windows-specific `harness.js` timeout excepted).

Next steps:
1. Merge `fix/live2-e-backend` to main via team lead pull request review.
2. Verify live run on target portals with real browser extension and Groq LLM provider.

Requests for other workstreams:
- None. All Lane E backend fixes and Lane D/E client contracts verified and complete.

Open questions for Raafat:
- In `ci/e2e/harness.js`, `browserContext.waitForEvent('serviceworker', { timeout: 10000 })` times out on Windows environments due to Chrome binary launching differences vs Playwright Chromium (same as noted in Lane D handoff). All other 12 Playwright E2E suites including `test_ws12_live_round2_e2e.js` run and pass cleanly with 0 failures.

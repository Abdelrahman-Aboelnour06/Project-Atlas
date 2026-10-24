# WS12-E live-run fixes, round 2 (Backend Lane: N2-N6)
Branch: fix/live2-e-backend   Last commit: 99c49bb   Model used: Gemini 3.8 Flash
Status: done

Done:
- `backend/app/agent/form_filler.py:38-160`: Implemented E1 (N2) scoped and filtered submit selection. Created whole-word token/word boundary matching `_matches_any_keyword_whole_word` for both Latin and Arabic text. Added universal exclusion filters: `_is_language_switch_control`, `_is_icon_only_without_label`, `_is_excluded_submit_candidate` (filtering out "رجوع", back, cancel, reset, close, home, print, help, menu toggles, language switches), and `_is_control_wrong`. Implemented `_score_submit_candidate` ranking submit candidates (highest priority to submit-semantic keywords like استعلام, بحث, submit, confirm).
- `backend/app/agent/form_filler.py:165-275`: Implemented E2 (N3) multi-field requirement discovery. Implemented `_is_field_required` recognizing `required`, `aria-required`, visible `*`, `مطلوب`, and `إجباري`. Implemented `extract_target_form_fields` returning required fields plus optional empty inputs when target form inputs <= 8.
- `backend/app/agent/form_filler.py:627-710`: Implemented E4 (N5) `classify_auth_wall` detecting login vs sign-up overlay dialogs and full pages, extracting identifier, password, confirm password, and submit refs.
- `backend/app/agent/navigator.py:28-48, 245-285, 410-440`: Implemented E5 (N6) generic CTA boost (`CTA_GENERIC_KEYWORDS`, `_matches_whole_keyword`). Boosts CTA score to 0.90 in `_score_dom_candidate` only when page heading/breadcrumbs match goal AND no target form is visible. Enforced `wrong_controls` filtering in `plan_milestone_step`.
- `backend/app/i18n.py:175-188, 385-398`: Added bilingual translations in `en` and `ar-EG` for `auth_login_saved_confirm`, `auth_credential_prompt`, `auth_no_account_option`, `auth_signup_handoff_prompt`, `auth_done_continue_option`, `auth_login_manual_handoff`, and `loop_url_revisit_limit`.
- `backend/app/models/goal.py:18, 126, 218`: Added `"login_id"` to `InputFieldKind`, `vault_hints` to `GoalStepRequest`, and `vault_clear` to `GoalStepResponse`.
- `contracts/goal_step.request.schema.json` & `contracts/goal_step.response.schema.json`: Added `vault_hints` array (strings or objects) and `vault_clear` array of strings to official API contracts.
- `backend/app/routes/chat.py:868-922`: Implemented E3 (N4) backwards-navigation guard. Tracks `url_history` and `url_visits`, recording `wrong_controls` keyed by `(form_id, normalized_label)` and secondary `element_id`. Halts with localized error `loop_url_revisit_limit` if any URL is revisited 3 times.
- `backend/app/routes/chat.py:1413-1422`: Universal verifier demotion guard: if a modal dialog is open or an auth wall is present, action on a final milestone cannot complete the goal (demoted to `in_progress`).
- `backend/app/routes/chat.py:1640-1920`: Implemented E4 (N5) login vs sign-up wall handling: protected auth modals from C5 dismissal, sign-up hands off with fieldless prompt and empty options (enabling default "خلصت، كمل" chip), login uses `vault_hints` with single confirmation prompt, login failure emits `vault_clear` and re-asks once, then hands off on 2nd failure.
- `backend/app/routes/chat.py:2180-2225`: Implemented E2 (N3) validation error recovery: when previous executed step was confirmed submit and serializer reports `invalid=true` / `error_text`, asks ONLY for the errored fields.
- `client-script/secret-vault.js:17`: Added `login_id` category to `TOKEN_REGEX`.
- `client-script/executor.js:13`: Added `login_id` category to `TOKEN_REGEX`.
- `client-script/content.js:893-906, 977-995`: Client E4 integration: sends `vault_hints` from `AtlasSecretVault.listEntries` in `requestPayload`, and handles `vault_clear` from backend response to delete cleared credentials from vault.
- `demo-site/`: Created 5 test fixtures (`portal-form-marked-required.html`, `portal-form-no-header.html`, `portal-form-no-tag.html`, `portal-service-login.html`, `portal-service-signup.html`).
- `backend/tests/fixtures_lane_e/`: Captured 8 real Playwright DOM serializer JSON snapshots via `capture_fixtures.js`.
- `backend/tests/test_ws12_lane_e_live_fixes.py`: Added 17 unit and integration tests covering E1 through E5 (all passing).
- `ci/e2e/test_ws12_live_round2_e2e.js`: Implemented comprehensive Playwright E2E test suite covering Flows A through F in real browser (all 34 checks passing).
- `ci/verify_all_tests_run.py:42`: Registered `"test_ws12_live_round2_e2e.js"` in `CI_E2E_SUITES`.

Tests run:
- Backend tests (from backend/): `cd backend && LLM_PROVIDER=mock pytest tests/ -q` -> 1144 passed, 2 warnings in 80.10s (0 failures).
- Backend tests (from repo root): `LLM_PROVIDER=mock pytest backend/tests -q` -> 1144 passed, 2 warnings in 80.10s (0 failures).
- Lane E unit tests: `pytest backend/tests/test_ws12_lane_e_live_fixes.py -q` -> 17 passed, 1 warning in 0.35s (0 failures).
- JS tests: `npm run test:js` -> 1321 passed across 25 suites (Floor: 814), 0 failed.
- Extension Packager: `node client-script/package_extension.js` -> 21 production files validated, store-ready ZIP generated cleanly in `dist/`.
- WS12 E2E Suite: `node ci/e2e/test_ws12_live_round2_e2e.js` -> 34 passed, 0 failed.
- CI Gatekeeper Discovery: `python ci/verify_all_tests_run.py --dry-run` -> 103 total test files discovered (56 backend, 33 client, 1 demo, 13 E2E).

Next steps:
1. Merge `fix/live2-e-backend` to main via pull request.
2. Verify live run on target portals with real browser extension and LLM provider.

Requests for other workstreams:
- None. All E1-E5 backend and E4 client integrations complete.

Open questions for Raafat:
- In `ci/e2e/harness.js`, `browserContext.waitForEvent('serviceworker', { timeout: 10000 })` times out on Windows environments due to Chrome binary launching differences vs Playwright Chromium (same as noted in Lane D handoff). All other 12 Playwright E2E suites including `test_ws12_live_round2_e2e.js` run and pass cleanly with 0 failures.

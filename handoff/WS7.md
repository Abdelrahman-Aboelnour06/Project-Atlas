# WS7 Slots and Forms
Branch: feat/slot-filling   Last commit: 903da99   Model used: Gemini 3.8 Flash
Status: done
Done:
- client-script/secret-vault.js:17: Updated TOKEN_REGEX to support vault tokens ({vault:...}) and national_id identically with executor.js.
- client-script/secret-vault.js:465-475, 620-632: Updated tokenizeCommand to normalize Arabic-Indic digits ([\u0660-\u0669\u06F0-\u06F9]) to ASCII and tokenize any run of 10+ digits into {secret}.
- client-script/executor.js:13: Updated TOKEN_REGEX to maintain 100% parity with secret-vault.js.
- client-script/content.js:630-675: Implemented client-side validation for required, maxlength, and pattern before tokenizing in renderAwaitingUserInputForm; renders localized .atlas-inline-error, sets border color #dc2626, and keeps form open on violation.
- backend/app/i18n.py:104-106, 210-212: Added localized string keys form_missing_fields_prompt, form_validation_error_reask, and form_confirm_submit for both English and Egyptian Arabic (ar-EG).
- backend/app/agent/form_filler.py:80-115: Implemented _is_sensitive_field universally detecting password, card, identity keywords (national id, civil id, passport, الرقم القومي, رقم الهوية, جواز السفر), and numeric fields with length >= 9 and ID-like label.
- backend/app/agent/form_filler.py:135-185: Implemented extract_required_form_fields discovering all required form fields with label, kind, pattern, maxlength, and sensitive flag.
- backend/app/agent/form_filler.py:188-210: Implemented extract_tokens_from_goal extracting only existing vault/profile tokens matching TOKEN_REGEX (never raw digits).
- backend/app/agent/form_filler.py:212-225: Implemented format_missing_fields_prompt generating localized prompts using the page's own field labels.
- backend/app/agent/form_filler.py:485-528: Updated plan_form_fill to enforce sensitive tokenization ({secret}/{password}) and surface unfulfilled DOM required fields in missing_required.
- backend/app/routes/chat.py:1215-1430: Integrated slot filling & missing field orchestration into goal_step_endpoint:
  * Detects missing required fields and returns ONE awaiting_user_input response with UserInputRequest.fields (contract v3).
  * Validates user inputs: enforces tokens for sensitive fields, checks pattern/maxlength for non-sensitive fields; re-asks with awaiting_user_input on validation mismatch.
  * Generates tokenized fill PlanSteps using vault tokens.
  * When form is filled and submit button is present, pauses execution with status="requires_confirmation" and pending_step targeting submit_ref.
  * Supports Egyptian Arabic affirmative confirmations ("أيوة", "نعم", "تمام", "أكيد", "ايوة") to execute pending submit step.
  * Defense-in-depth: Never logs payload.user_inputs or user_response in application logs.
- backend/tests/test_ws7_slots_forms.py: Created 13 unit and integration tests covering field discovery, goal token safety, prompt formatting, contract v3 fields, validation re-asking, tokenized fill steps, confirmation + Arabic responses, caplog leak prevention, and zero hardcoded domains.
- client-script/test_ws7_slots.js: Created 39 JavaScript unit and integration tests across 4 test suites covering TOKEN_REGEX parity, tokenizeCommand 10+ digits & Arabic-Indic normalization, store -> token -> executor fill into DOM, and client-side inline error validation.
- package.json:9: Registered client-script/test_ws7_slots.js in npm test:js script.
Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 1078 passed, 0 failed in 81.00s.
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1078 passed, 0 failed in 78.43s.
- `npm run test:js`: 1260 passed across 22 test suites, 0 failed in 26.5s.
- `node client-script/package_extension.js`: 45 checks passed, store-ready ZIP archive generated cleanly.
- `node client-script/test_ws7_slots.js`: 39 passed, 0 failed.
- `python ci/verify_all_tests_run.py`:
  * 100% Backend test files executed: 51/51 files, 1078 passed (Floor: 782).
  * 100% JavaScript test files executed: 31/31 files, 1260 passed (Floor: 814).
  * E2E suites passed: a11y_axe.js, run_multi_tab_suite.js, test_latent_reveal_e2e.js, test_portal_fixtures_e2e.js, test_ws5_portal_router_e2e.js, ui_sidebar_behavior.js.
Next steps:
1. When WS7 PR is opened/merged into main, team can run multi-step scenarios on portal-inquiry with automated slot asking and confirmation.
2. WS8 (Action Space / Multi-Tab Reasoning) and WS9 (Portal Replay) can leverage contract v3 UserInputRequest.fields and Egyptian Arabic confirmation.
Requests for other workstreams:
- ci/e2e/harness.js (Infrastructure): In ci/e2e/harness.js line 35-37, remove `executablePath: chromePath` or make it opt-in via environment variable so Playwright uses its bundled Chromium on Windows. When Google Chrome is running in the background on Windows, passing `executablePath: chrome.exe` attaches to the running Chrome singleton which ignores `--load-extension` and times out waiting for the service worker, whereas Playwright's bundled Chromium succeeds in 3 seconds.
Open questions for Raafat:
- None.

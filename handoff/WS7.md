# WS7 Slots and Forms
Branch: feat/slot-filling   Last commit: 7a7b58d   Model used: Gemini 3.8 Flash
Status: in progress
Done:
- Initialized workstream WS7 on branch feat/slot-filling based on latest main (WS5 merged).
- Baseline verification passed: 1065 backend tests passed (root & backend/), 21 JS suites passed.
- Analyzed form_filler.py, goal_step in routes/chat.py, and secret-vault.js.
Tests run:
- cd backend && LLM_PROVIDER=mock pytest tests/ -q (1065 passed in 78.91s)
- LLM_PROVIDER=mock pytest backend/tests -q (1065 passed in 78.35s)
- npm run test:js (1,221 passed across 21 test suites in 24s)
Next steps:
1. Submit implementation_plan.md and wait for user review and approval.
2. Implement plan_form_fill enhancements in backend/app/agent/form_filler.py:
   - Extract required fields with label, kind, pattern, maxlength, sensitive flag (national ID, passport, card, password).
   - Extract values from goal text prior to asking.
   - Return structured InputField objects and FormPlan with missing required fields.
3. Update client-script/secret-vault.js:
   - Support national ID / plate and {vault:...} tokens in TOKEN_REGEX and store/resolve methods.
4. Implement awaiting_user_input handling in backend/app/routes/chat.py:
   - Return ONE awaiting_user_input with contract v3 fields, localized via app.i18n.t().
   - Validate incoming user_inputs / user_response against pattern/maxlength; re-ask on mismatch.
   - Generate tokenized fill PlanSteps.
   - Require explicit confirmation before the final submit click.
5. Create comprehensive tests in backend/tests/test_ws7_slots_forms.py and client-script/test_ws7_slots.js.
6. Verify full test suite, lint/formatting integrity, zero log leaks of raw secrets, and update handoff.
Requests for other workstreams:
- WS2 (Language Backend): Register keys "form_missing_fields_prompt" and "form_validation_error_reask" in app/i18n.py STRINGS (en + ar-EG) if WS2 updates string tables.
Open questions for Raafat:
- None.

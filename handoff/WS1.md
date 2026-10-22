# Atlas Contract v3 Summary

> **Contract v3 Status: LOCKED & COMMITTED on branch `feat/contract-v3`**
> Primary purpose: Unblock Arabic localization (WS2, WS3), multi-field input requests (WS5, WS7), exploration metadata (WS4, WS6), and latent menu discovery.

### Summary of v3 Contracts

1. **`POST /v1/chat` (`ChatRequest` & `ChatResponse`)**:
   - `ChatRequest.language: Optional[str]` (max 32 chars, safe default `None`, e.g. `'ar-EG'`).
   - `ChatResponse.intent_route: Optional[Literal['direct', 'question', 'goal']]` (safe default `None`).
   - `ChatResponse.goal_state: Optional[GoalState]` (seed `GoalState` for the client loop when `intent_route == 'goal'`).

2. **Multi-Field Inputs (`UserInputRequest` & `InputField`)**:
   - `InputField = { ref: str, label: str | None, kind: Literal['text','number','select','date','phone','email','password','otp','other'], sensitive: bool = False, pattern: str | None, maxlength: int | None, required: bool = True, options: List[str] = [] }`.
   - `UserInputRequest.fields: List[InputField]` (safe default `[]`). Backward-compatible with single-field payloads (`kind`, `prompt`, `field_ref`, `resumable`).
   - `GoalStepRequest.user_inputs: Optional[Dict[str, str]]` (safe default `None`) mapping field refs to values or secret-vault tokens (e.g. `{"el_national_id": "29501011234567", "el_plate": "123-ABC"}`).

3. **Exploration Metadata & Action Types (`PlanStep` & `ActionType`)**:
   - Added `"reveal"` to `ActionType` without reordering existing entries.
   - `PlanStep.reason: Optional[Literal['reveal_menu', 'navigate', 'search', 'backtrack', 'act']]` (safe default `None`).
   - `PlanStep.expect: Optional[str]` (safe default `None`).

4. **Latent Node Schema (`DomNode` & `MenuInfo`)**:
   - Frozen on backend in `backend/app/models/dom.py` so Pydantic does not drop them:
     - `visible: bool | None = True`
     - `reveal_via: str | None = None` (toggle element ID)
     - `menu: MenuInfo | None = None` (`haspopup`, `expanded`, `controls`)
     - `landmark: Literal['header', 'nav', 'main', 'footer', 'aside'] | None = None`
     - `breadcrumb: list[str] | None = None`
   - **Note for WS4**: Backend model and schema are complete; WS4 now only needs to populate these from the client DOM serializer.

5. **Contract Versioning**:
   - Request `contract_version` default remains `2` for backward compatibility; responses echo client's version. `contract_version: 3` accepted for rich inputs and exploration metadata.
   - Both `contracts/goal_step.request.schema.json` and `contracts/goal_step.response.schema.json` regenerated and match Pydantic models exactly.

---

# WS1 Contract Owner
Branch: feat/contract-v3   Last commit: 3779392af31fe92eb2823d884a88e3bd9cd7ffd1   Model used: Gemini 1.5 / Claude (Thinking)
Status: done
Done:
- backend/app/models/action.py:17: added `"reveal"` action verb to `ActionType` without reordering existing values.
- backend/app/models/dom.py:11: added `MenuInfo` model and latent DOM fields (`visible`, `reveal_via`, `menu`, `landmark`, `breadcrumb`) to `DomNode`.
- backend/app/models/goal.py:24: added `PlanStepReason` literal, `reason`, and `expect` to `PlanStep`.
- backend/app/models/goal.py:136: added `InputFieldKind` literal, `InputField` model, and `fields: List[InputField]` to `UserInputRequest`.
- backend/app/models/goal.py:281: added `user_inputs: Optional[Dict[str, str]]` to `GoalStepRequest` and documented `contract_version: 3`.
- backend/app/routes/chat.py:11: added `Literal` import and extended `ChatRequest` with `language` (max 32 chars) and `ChatResponse` with `intent_route` and `goal_state`.
- contracts/goal_step.request.schema.json: regenerated from `GoalStepRequest.model_json_schema()` with LF line endings.
- contracts/goal_step.response.schema.json: regenerated from `GoalStepResponse.model_json_schema()` with LF line endings.
- docs/contracts.md: updated Contract 2 (`reveal` action, `reason`, `expect`), Contract 7 (`language`, `intent_route`, `goal_state`), Contract 12 (`user_inputs`, `fields`, latent nodes), and Versioning table (v3.0).
- backend/tests/test_v2_contracts.py:144: added 12 new v3 unit and route integration tests in `TestV3Contracts`.
Tests run:
- `pytest backend/tests -q`: 957 passed, 0 failed in 15.49s (from repo root).
- `cd backend && pytest tests/ -q`: 956 passed, 1 failed (known pre-existing git diff path issue in `test_m2_challenger_stress.py` on `main` before `fix/ci-test-cwd` merge).
- `pytest backend/tests/test_multi_tab_contracts.py -v`: 33 passed, 0 failed (strict schema equality check).
- `pytest backend/tests/test_v2_contracts.py -v`: 17 passed, 0 failed.
- `node client-script/test_m2_2_challenger_stress.js`: 18 passed, 0 failed.
- `npm run test:js`: 1,136 passed across 27 suites, 0 failed.
Next steps:
1. WS2 (Language Backend): Consume `language` in `routes/chat.py` and pass to `app/i18n.py`.
2. WS3 (Language Client): Send `language: "ar-EG"` from sidebar.
3. WS4 (Perception): Populate `DomNode` latent fields (`visible`, `reveal_via`, `menu`, `landmark`, `breadcrumb`) in `dom-serializer.js`.
4. WS5 (Router and Loop): Route `intent_route` (`direct`, `question`, `goal`) in `routes/chat.py` and pass `goal_state` seed to closed goal loop.
5. WS6 (Navigator): Emit `reveal` steps with `reason` and `expect`.
6. WS7 (Slots and Forms): Emit `UserInputRequest` with `fields: [InputField]` and parse `user_inputs`.
Requests for other workstreams:
- None. All models and schemas are backward-compatible and unblock downstream workstreams.
Open questions for Raafat:
- None. Contract v3 is fully implemented, verified, and locked.

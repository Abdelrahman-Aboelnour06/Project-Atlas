"""
WS12 Lane E Round 2: Submit Outcome, Errored Fields Scoping, and Login Outcome Tests
backend/tests/test_ws12_lane_e_r2_submit.py

Validates:
- R2-2: Validation error is NOT reported as success. Form submit with errored fields falls through
        from after-submit check to E2 recovery, re-asks only errored field, and completes on 2nd submit.
- R2-3: (a) Login submit does not set last_step_was_submit.
        (b) Form fill stores filled refs in dom_state; field counts as errored only when filled by Atlas
            with error_text, or invalid and not empty. Empty required field uses normal missing prompt.
        (c) Field must carry real pending_form_id; fields without form_id do not slip through.
- R2-6: Slow login tolerance. Auth wall still detected right after login submit does NOT trigger vault_clear
        or failure when password is still filled and no error_text. Keeps flag for one more hop.
        Fails and clears vault only when password is empty or error_text is shown.

Adheres strictly to AGENTS.md Prime Directive:
- 100% generic across all sites, zero site/topic keywords in production code.
- Placeholder ID 00000000000000 only.
- Vault tokens like {password}, {login_id}.
"""

import json
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.i18n import t
from app.models.goal import GoalState, Milestone, PlanStep

FIXTURES_DIR = Path(__file__).parent / "fixtures_lane_e"
DEMO_KEY = "atlas_live_round2_test_key"


@pytest.fixture
def client():
    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_KEY else None),
    ):
        with TestClient(app) as test_client:
            yield test_client


def load_fixture(name: str) -> List[Dict[str, Any]]:
    path = FIXTURES_DIR / name
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ── Test Suite 1: R2-2 Validation Error Not Reported as Success ──────────────

class TestR22SubmitValidationErrorNotReportedAsSuccess:
    """
    R2-2: A validation error is reported as success bug.
    On first submit, clearing plate digits and showing error with aria-invalid
    must NOT complete the goal even if error text counts as a visible change.
    Atlas falls through to E2 recovery, re-asks ONLY the plate digits,
    and completes after the second submit when results appear.
    """

    def test_r2_2_first_submit_validation_error_falls_through_to_reask_digits_only(self, client):
        """
        First submit on portal-form-validation-error.html:
        Atlas previously filled all 3 fields. First submit cleared plate digits with error_text.
        After-submit check must not return goal_complete; it must fall through to E2 recovery
        and re-ask ONLY the errored plate digits field.
        """
        dom_first_submit = load_fixture("portal_form_validation_error_first_submit.json")

        # Locate plate digits node in fixture
        plate_node = next(n for n in dom_first_submit if n.get("name") == "plate_numbers")
        nid_node = next(n for n in dom_first_submit if n.get("name") == "national_id")
        letters_node = next(n for n in dom_first_submit if n.get("name") == "plate_letters")

        plate_ref = str(plate_node.get("ref") or plate_node.get("id"))
        nid_ref = str(nid_node.get("ref") or nid_node.get("id"))
        letters_ref = str(letters_node.get("ref") or letters_node.get("id"))

        # Setup goal state after Atlas confirmed and clicked submit
        gs = GoalState(
            goal="الاستعلام عن مخالفات رخص المركبات",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[
                PlanStep(action="fill", element_id=nid_ref, value="00000000000000"),
                PlanStep(action="fill", element_id=plate_ref, value="1234"),
                PlanStep(action="fill", element_id=letters_ref, value="أبج"),
                PlanStep(action="click", element_id="btn-submit", description="Submit form (استعلام)", reason="act"),
            ],
            dom_state={
                "last_step_was_submit": True,
                "pending_form_id": "violations-form",
                "filled_form_refs": [nid_ref, plate_ref, letters_ref],
                "page_text": "نيابات المرور - الاستعلام عن مخالفات المركبات",
            },
        )

        payload = {
            "goal": "الاستعلام عن مخالفات رخص المركبات",
            "goal_state": gs.model_dump(),
            "dom_map": dom_first_submit,
            "current_url": "https://portal.gov.eg/form",
            # Error text appeared in page_text:
            "page_text": "أرقام اللوحة غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
            "last_action_result": {
                "action": "click",
                "text_changed": True,
                "added_visible_count": 1,
            },
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        # MUST NOT be goal_complete! Must fall through to awaiting_user_input
        assert data["status"] == "awaiting_user_input", "Validation error must not be reported as goal_complete"
        assert "تم اكتمال الهدف" not in data.get("reply", "")

        awaiting = data["goal_state"]["awaiting"]
        assert awaiting is not None
        assert awaiting["kind"] == "missing_field"

        # Re-asks ONLY the plate digits field, not national_id or letters
        fields = awaiting["fields"]
        assert len(fields) == 1, "Only the single errored field must be re-asked"
        assert fields[0]["ref"] == plate_ref
        assert "أرقام اللوحة" in fields[0]["label"]

        # Prompt must be the validation re-ask prompt
        assert t("form_validation_error_reask", "ar-EG", field=fields[0]["label"]) == data["reply"]

    def test_r2_2_second_submit_completes_goal_with_results(self, client):
        """
        Second submit on portal-form-validation-error.html:
        User supplied valid plate digits, Atlas filled it and confirmed submit.
        Results table is now visible and plate numbers has no error.
        After-submit check completes the goal.
        """
        dom_second_submit = load_fixture("portal_form_validation_error_second_submit.json")
        plate_node = next(n for n in dom_second_submit if n.get("name") == "plate_numbers")
        plate_ref = str(plate_node.get("ref") or plate_node.get("id"))

        gs = GoalState(
            goal="الاستعلام عن مخالفات رخص المركبات",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[
                PlanStep(action="fill", element_id=plate_ref, value="5678"),
                PlanStep(action="click", element_id="btn-submit", description="Submit form (استعلام)", reason="act"),
            ],
            dom_state={
                "last_step_was_submit": True,
                "pending_form_id": "violations-form",
                "filled_form_refs": [plate_ref],
                "page_text": "أرقام اللوحة غير صحيحة",
            },
        )

        payload = {
            "goal": "الاستعلام عن مخالفات رخص المركبات",
            "goal_state": gs.model_dump(),
            "dom_map": dom_second_submit,
            "current_url": "https://portal.gov.eg/form",
            "page_text": "نتيجة الاستعلام\nإجمالي المخالفات المستحقة: 150 جنيه مصري",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
            "last_action_result": {
                "action": "click",
                "text_changed": True,
                "added_visible_count": 2,
            },
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_complete", "Second submit with valid data must complete goal"
        assert "150 جنيه" in data["reply"]


# ── Test Suite 2: R2-3 Errored Field Scoping & Login Separation ──────────────

class TestR23ErroredFieldScopingAndLoginSubmitSeparation:
    """
    R2-3:
    (a) A login submit must not set last_step_was_submit (both in pending_kind and description fallback).
    (b) Form fill stores filled refs in dom_state; empty required fields not filled by Atlas use normal missing prompt.
    (c) Real pending_form_id scoping: fields with no form_id or mismatched form_id never slip through.
    """

    def test_r2_3_login_submit_pending_kind_does_not_set_last_step_was_submit(self, client):
        """
        (a) When user confirms a login submit (pending_step_kind == 'login_submit'),
        Atlas must set last_step_was_login_submit = True, but MUST NOT set last_step_was_submit.
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")
        id_node = next(n for n in login_modal_dom if n.get("name") == "login_id")
        pwd_node = next(n for n in login_modal_dom if n.get("type") == "password")
        sub_node = next(n for n in login_modal_dom if n.get("tag") == "button" and "تسجيل الدخول" in (n.get("resolved_label") or ""))

        state = {
            "goal": "الاستعلام عن مخالفات المرور",
            "status": "requires_confirmation",
            "requires_confirmation": True,
            "confirmation_prompt": "I'll log you in using the saved credentials for this site. Proceed?",
            "pending_step": {
                "action": "click",
                "element_id": sub_node["id"],
                "description": "Submit login (تسجيل الدخول)",
                "reason": "act",
            },
            "dom_state": {
                "pending_step_kind": "login_submit",
                "pending_login_steps": [
                    {"action": "fill", "element_id": id_node["id"], "value": "{login_id}", "description": "Fill ID", "delay_ms": 300},
                    {"action": "fill", "element_id": pwd_node["id"], "value": "{password}", "description": "Fill PWD", "delay_ms": 300},
                ],
            },
        }

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "أيوة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        d = res.json()

        dom_state = d["goal_state"]["dom_state"]
        assert dom_state.get("last_step_was_login_submit") is True
        assert not dom_state.get("last_step_was_submit"), "login_submit must never set last_step_was_submit"

    def test_r2_3_login_submit_description_fallback_does_not_set_last_step_was_submit(self, client):
        """
        (a) If pending_step_kind was not set, description fallback containing 'login' and 'submit'
        must set last_step_was_login_submit, NOT last_step_was_submit.
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")
        sub_node = next(n for n in login_modal_dom if n.get("tag") == "button" and "تسجيل الدخول" in (n.get("resolved_label") or ""))

        state = {
            "goal": "الاستعلام عن مخالفات المرور",
            "status": "requires_confirmation",
            "requires_confirmation": True,
            "confirmation_prompt": "Proceed?",
            "pending_step": {
                "action": "click",
                "element_id": sub_node["id"],
                "description": "Submit login (تسجيل الدخول)",
                "reason": "act",
            },
            "dom_state": {},
        }

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "أيوة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        d = res.json()

        dom_state = d["goal_state"]["dom_state"]
        assert dom_state.get("last_step_was_login_submit") is True
        assert not dom_state.get("last_step_was_submit"), "Description with 'login' must set last_step_was_login_submit, not last_step_was_submit"

    def test_r2_3_saved_login_then_service_form_asks_normal_missing_prompt(self, client):
        """
        (b) Saved login completed, then the service form appears with an empty required plate.
        The browser serializer marks the plate field with error_text: 'Please fill out this field.'
        Because Atlas did NOT fill this field, it must NOT trigger the validation re-ask prompt
        ('يرجى التأكد من صحة رقم اللوحة وإعادة إدخاله').
        It must ask with the normal missing-field prompt ('يرجى إدخال رقم اللوحة للمتابعة').
        """
        dom = [
            {
                "id": "plate-no",
                "tag": "input",
                "type": "text",
                "name": "plate_no",
                "form_id": "authenticated-service-form",
                "required": True,
                "current_value": None,
                "invalid": True,
                "error_text": "Please fill out this field.",
                "resolved_label": "رقم اللوحة",
            },
            {
                "id": "inquire-submit",
                "tag": "button",
                "type": "submit",
                "form_id": "authenticated-service-form",
                "resolved_label": "عرض المخالفات",
            },
        ]

        gs = GoalState(
            goal="الاستعلام عن مخالفات المركبات",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[
                PlanStep(action="fill", element_id="login-id", value="{login_id}"),
                PlanStep(action="fill", element_id="login-pass", value="{password}"),
                PlanStep(action="click", element_id="login-submit", description="Submit login", reason="act"),
            ],
            dom_state={
                # Login just completed, no last_step_was_submit on the service form:
                "auth_attempts": 0,
            },
        )

        payload = {
            "goal": "الاستعلام عن مخالفات المركبات",
            "goal_state": gs.model_dump(),
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "تم تسجيل دخولك بنجاح. يرجى إدخال أرقام وحروف اللوحة للاستعلام.",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "awaiting_user_input"
        reply = data["reply"]
        # Must NOT be the validation error check-and-reenter prompt!
        assert "يرجى التأكد من صحة" not in reply, "Empty required field must not trigger validation re-ask prompt"
        assert "إعادة إدخال" not in reply
        # Must be the normal missing fields prompt asking for plate-no
        awaiting = data["goal_state"]["awaiting"]
        assert awaiting["kind"] == "missing_field"
        assert len(awaiting["fields"]) == 1
        assert awaiting["fields"][0]["ref"] == "plate-no"

    def test_r2_3_field_without_form_id_does_not_slip_through(self, client):
        """
        (c) When pending_form_id is a real form id in the page (e.g. 'violations-form'),
        a field with NO form_id must not slip through into errored fields.
        """
        dom = [
            # Form fields
            {"id": "inp-id", "tag": "input", "form_id": "violations-form", "current_value": "00000000000000", "resolved_label": "الرقم القومي"},
            {"id": "inp-plate", "tag": "input", "form_id": "violations-form", "current_value": "1234", "invalid": True, "error_text": "أرقام اللوحة غير صحيحة", "resolved_label": "أرقام اللوحة"},
            # External field with NO form_id (e.g. global search box or ad input)
            {"id": "inp-search", "tag": "input", "form_id": None, "current_value": "", "invalid": True, "error_text": "Search required", "resolved_label": "بحث"},
        ]

        gs = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[PlanStep(action="click", element_id="btn-sub", description="Submit form", reason="act")],
            dom_state={
                "last_step_was_submit": True,
                "pending_form_id": "violations-form",
                "filled_form_refs": ["inp-id", "inp-plate"],
            },
        )

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": gs.model_dump(),
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/violations",
            "page_text": "أرقام اللوحة غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "awaiting_user_input"
        awaiting = data["goal_state"]["awaiting"]
        fields = awaiting["fields"]
        assert len(fields) == 1
        assert fields[0]["ref"] == "inp-plate", "Only violations-form field must be re-asked"
        assert all(f["ref"] != "inp-search" for f in fields), "Field with no form_id must not slip through"

    def test_r2_3_invalid_non_empty_field_counts_as_errored(self, client):
        """
        (b) A field that is invalid and not empty counts as errored even without Atlas having filled it.
        """
        dom = [
            {"id": "inp-plate", "tag": "input", "form_id": "violations-form", "current_value": "invalid_val", "invalid": True, "error_text": None, "resolved_label": "رقم اللوحة"},
            {"id": "inp-sub", "tag": "button", "type": "submit", "form_id": "violations-form", "resolved_label": "استعلام"},
        ]

        gs = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[PlanStep(action="click", element_id="inp-sub", description="Submit", reason="act")],
            dom_state={
                "last_step_was_submit": True,
                "pending_form_id": "violations-form",
                "filled_form_refs": [],
            },
        )

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": gs.model_dump(),
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/violations",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "awaiting_user_input"
        assert len(data["goal_state"]["awaiting"]["fields"]) == 1
        assert data["goal_state"]["awaiting"]["fields"][0]["ref"] == "inp-plate"


# ── Test Suite 3: R2-6 Slow Login Tolerance ──────────────────────────────────

class TestR26SlowLoginTolerance:
    """
    R2-6:
    (1) Login submitted. Next hop shows same wall with password still filled and no error:
        no vault_clear and no failure message. Hop after that shows service page: goal continues.
    (2) The wall is still there with empty password or error_text: failure path works as today.
    """

    def test_r2_6_slow_login_keeps_flag_and_does_not_vault_clear(self, client):
        """
        Test (1):
        Hop 1: Login was submitted.
        Hop 2: Site takes time to process. The modal is still there, password is still filled,
               no error_text. Must NOT emit vault_clear and must NOT emit failure message.
               Keeps last_step_was_login_submit for one more hop.
        Hop 3: Site finished loading service form. Goal continues.
        """
        login_dom = load_fixture("portal_service_login_open.json")
        # Simulate password field still filled with token/value and modal showing no error
        for n in login_dom:
            n["invalid"] = False
            n["error_text"] = None
            if n.get("type") == "password":
                n["current_value"] = "{password}"
            if n.get("name") == "login_id":
                n["current_value"] = "{login_id}"

        # Hop 2: Right after login submit, slow site
        gs_hop2 = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            current_url="https://portal.gov.eg/service",
            hop_count=2,
            max_hops=8,
            dom_state={
                "last_step_was_login_submit": True,
            },
        )

        payload_hop2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": gs_hop2.model_dump(),
            "dom_map": login_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "تسجيل الدخول",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res_hop2 = client.post("/v1/chat/goal_step", json=payload_hop2)
        assert res_hop2.status_code == 200
        d_hop2 = res_hop2.json()

        # MUST be in_progress
        assert d_hop2["status"] == "in_progress", "Slow login turn must return in_progress"
        # NO vault_clear!
        assert not d_hop2.get("vault_clear"), "Slow login must NOT emit vault_clear"
        # NO failure message in reply
        reply_hop2 = d_hop2["reply"]
        assert "اسم المستخدم أو كلمة المرور غير صحيحة" not in reply_hop2
        assert "خطأ" not in reply_hop2
        # Must retain last_step_was_login_submit for ONE more hop
        dom_state_hop2 = d_hop2["goal_state"]["dom_state"]
        assert dom_state_hop2.get("last_step_was_login_submit") is True, "Must keep last_step_was_login_submit for 1 more hop"
        assert dom_state_hop2.get("login_wait_hops") == 1

        # Hop 3: Next turn shows service page (login modal gone)
        service_dom = [
            {"id": "plate-no", "tag": "input", "form_id": "authenticated-service-form", "required": True, "resolved_label": "رقم اللوحة"},
            {"id": "inquire-submit", "tag": "button", "type": "submit", "form_id": "authenticated-service-form", "resolved_label": "عرض المخالفات"},
        ]

        payload_hop3 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": d_hop2["goal_state"],
            "dom_map": service_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "تم تسجيل دخولك بنجاح. بيانات استعلام رخصة المركبة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res_hop3 = client.post("/v1/chat/goal_step", json=payload_hop3)
        assert res_hop3.status_code == 200
        d_hop3 = res_hop3.json()

        # Goal continues smoothly into service form handling
        assert not d_hop3.get("vault_clear")
        assert d_hop3["status"] in ("in_progress", "awaiting_user_input")
        # Cleans up login_wait_hops
        assert "login_wait_hops" not in (d_hop3["goal_state"]["dom_state"] or {})

    def test_r2_6_login_with_empty_password_fails_and_clears_vault(self, client):
        """
        Test (2a):
        Login submitted, next hop shows the auth wall with an EMPTY password field.
        Counts as failure immediately -> sends vault_clear and re-asks once.
        """
        err_dom = load_fixture("portal_service_login_open.json")
        for n in err_dom:
            if n.get("type") == "password":
                n["current_value"] = ""
                n["invalid"] = True
                n["error_text"] = None

        state = {
            "goal": "الاستعلام عن مخالفات المرور",
            "status": "in_progress",
            "current_url": "https://portal.gov.eg/service",
            "hop_count": 3,
            "max_hops": 8,
            "dom_state": {
                "last_step_was_login_submit": True,
            },
        }

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": err_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        d = res.json()

        assert d["status"] == "awaiting_user_input"
        assert d["vault_clear"] == ["login_id", "password"], "Empty password on wall must trigger vault_clear"
        assert d["goal_state"]["dom_state"]["auth_attempts"] == 1

    def test_r2_6_login_with_error_text_fails_and_clears_vault(self, client):
        """
        Test (2b):
        Login submitted, next hop shows modal with error_text.
        Counts as failure -> sends vault_clear.
        """
        err_dom = load_fixture("portal_service_login_error.json")

        state = {
            "goal": "الاستعلام عن مخالفات المرور",
            "status": "in_progress",
            "current_url": "https://portal.gov.eg/service",
            "hop_count": 3,
            "max_hops": 8,
            "dom_state": {
                "last_step_was_login_submit": True,
            },
        }

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": err_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "اسم المستخدم أو كلمة المرور غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        d = res.json()

        assert d["status"] == "awaiting_user_input"
        assert d["vault_clear"] == ["login_id", "password"], "Error text on login must trigger vault_clear"
        assert d["goal_state"]["dom_state"]["auth_attempts"] == 1

        # Second failure hands off manually with empty options
        state2 = d["goal_state"]
        state2["dom_state"]["last_step_was_login_submit"] = True

        payload2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state2,
            "dom_map": err_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "اسم المستخدم أو كلمة المرور غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res2 = client.post("/v1/chat/goal_step", json=payload2)
        assert res2.status_code == 200
        d2 = res2.json()

        assert d2["status"] == "awaiting_user_input"
        assert d2["goal_state"]["awaiting"]["options"] == []
        assert d2["vault_clear"] == ["login_id", "password"]

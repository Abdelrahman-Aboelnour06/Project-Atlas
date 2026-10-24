"""
WS12 Lane E Round 2 Backend Auth Tests
backend/tests/test_ws12_lane_e_r2_auth.py

Tests for:
- R2-5: Auth-wall classification with single password input vs submit button words.
  * Login modal with one password + "تسجيل الدخول" submit + "إنشاء حساب جديد" button -> login
  * Modal with one password + "إنشاء حساب" submit -> signup
  * Two passwords -> signup
  * Existing portal_service_signup fixture -> signup
- Keeping auth-wall forms out of extract_target_form_fields and plan_form_fill.
- R2-4: Sign-up "done" loop:
  * Tap "done" and "خلصت" with signup popup still open -> repeats handoff with auth_signup_still_open message.
    No card with password fields, no vault_hints, no new vault categories.
  * "done" after popup is gone -> goal continues to the service form.
  * "done" when popup turned into login wall -> uses normal login path.

Generic only: strictly adheres to AGENTS.md Prime Directive.
"""

import os
os.environ.setdefault("LLM_PROVIDER", "mock")
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.agent.form_filler import (
    classify_auth_wall,
    extract_target_form_fields,
    plan_form_fill,
)
from app.i18n import t

FIXTURES_DIR = Path(__file__).parent / "fixtures_lane_e"
DEMO_KEY = "atlas_live_round2_test_key"


def load_fixture(name: str):
    with open(FIXTURES_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def client():
    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_KEY else None),
    ):
        with TestClient(app) as test_client:
            yield test_client


# ── Test Suite: R2-5 Auth Wall Classification ───────────────────────────────

class TestR25AuthWallClassification:
    """
    R2-5: With exactly one password input, classify by the submit button of the
    password's form (or modal). It is sign-up only when that submit matches sign-up
    words and not login words. Two or more passwords is still sign-up.
    """

    def test_login_modal_with_signup_secondary_button_gives_login(self):
        """
        A login modal with an email input, one password, a submit 'تسجيل الدخول',
        and a type=button 'إنشاء حساب جديد' must classify as 'login'.
        """
        modal_nodes = [
            {"id": "m-email", "tag": "input", "type": "email", "resolved_label": "البريد الإلكتروني", "form_id": "auth-form", "in_modal": True},
            {"id": "m-pwd", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "auth-form", "in_modal": True},
            {"id": "btn-submit", "tag": "button", "type": "submit", "resolved_label": "تسجيل الدخول", "form_id": "auth-form", "in_modal": True},
            {"id": "btn-signup", "tag": "button", "type": "button", "resolved_label": "إنشاء حساب جديد", "form_id": "auth-form", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None, "Modal must be recognized as an auth wall"
        assert res["type"] == "login", f"Expected type 'login', got {res['type']}"
        assert res["submit_ref"] == "btn-submit"
        assert res["password_ref"] == "m-pwd"
        assert res["identifier_ref"] == "m-email"

    def test_modal_with_one_password_whose_submit_is_signup_gives_signup(self):
        """
        A modal with one password whose submit is 'إنشاء حساب' gives 'signup'.
        """
        modal_nodes = [
            {"id": "m-email", "tag": "input", "type": "email", "resolved_label": "البريد الإلكتروني", "form_id": "signup-form", "in_modal": True},
            {"id": "m-pwd", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "signup-form", "in_modal": True},
            {"id": "btn-submit", "tag": "button", "type": "submit", "resolved_label": "إنشاء حساب", "form_id": "signup-form", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None, "Modal must be recognized as an auth wall"
        assert res["type"] == "signup", f"Expected type 'signup', got {res['type']}"
        assert res["submit_ref"] == "btn-submit"

    def test_modal_with_two_passwords_gives_signup(self):
        """
        Two or more passwords give 'signup'.
        """
        modal_nodes = [
            {"id": "m-pwd1", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "in_modal": True},
            {"id": "m-pwd2", "tag": "input", "type": "password", "resolved_label": "تأكيد كلمة المرور", "in_modal": True},
            {"id": "btn-sub", "tag": "button", "type": "submit", "resolved_label": "متابعة", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None
        assert res["type"] == "signup", f"Two passwords must classify as 'signup', got {res['type']}"
        assert res["password_ref"] == "m-pwd1"
        assert res["confirm_password_ref"] == "m-pwd2"

    def test_existing_portal_service_signup_fixture_gives_signup(self):
        """
        The existing portal_service_signup fixture still gives 'signup'.
        """
        signup_dom = load_fixture("portal_service_signup.json")
        res = classify_auth_wall(signup_dom)
        assert res is not None
        assert res["type"] == "signup"


# ── Test Suite: Auth Wall Exclusion from Form Filler ─────────────────────────

class TestAuthWallExclusionFromFormFiller:
    """
    Auth-wall forms must never go to extract_target_form_fields or plan_form_fill.
    """

    def test_extract_target_form_fields_returns_empty_for_auth_wall(self):
        signup_dom = load_fixture("portal_service_signup.json")
        reqs, opts = extract_target_form_fields(signup_dom, form_id="signup-form")
        assert reqs == [], "extract_target_form_fields must return empty required_fields for auth wall"
        assert opts == [], "extract_target_form_fields must return empty optional_fields for auth wall"

    @pytest.mark.asyncio
    async def test_plan_form_fill_returns_blocker_for_auth_wall(self):
        signup_dom = load_fixture("portal_service_signup.json")
        plan = await plan_form_fill(
            form_id="signup-form",
            dom_nodes=signup_dom,
            goal="الاستعلام عن مخالفات المرور",
            language="ar-EG",
        )
        assert "auth_wall" in plan.blockers, "plan_form_fill must flag auth_wall in blockers"
        assert plan.fields == [], "plan_form_fill must not plan fields on auth wall form"


# ── Test Suite: R2-4 Sign-up 'Done' Loop ─────────────────────────────────────

class TestR24SignupDoneLoop:
    """
    R2-4: Sign-up 'done' loop.
    After 'done':
    - if the sign-up wall is still there, repeat the handoff once, with a short message
      that the sign-up page is still open (new i18n key, en and Egyptian Arabic);
    - if it turned into a login wall, use the normal login path;
    - if it's gone, continue the goal.
    """

    def test_tap_done_with_popup_still_open_repeats_handoff_with_new_message(self, client):
        """
        Tap 'done' with the popup still open:
        There is no card with password fields and no vault_hints or new vault categories.
        The response is the sign-up handoff with the new message.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        # Turn 1: initial encounter with signup wall
        p1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        assert res1.status_code == 200
        d1 = res1.json()
        assert d1["status"] == "awaiting_user_input"
        assert t("auth_signup_handoff_prompt", "ar-EG") in d1["reply"]

        state = d1["goal_state"]

        # Turn 2: User taps "done" while the popup is still open
        p2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "done",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        # Must repeat the handoff with the new message
        assert d2["status"] == "awaiting_user_input"
        assert t("auth_signup_still_open", "ar-EG") in d2["reply"]
        awaiting = d2["goal_state"]["awaiting"]
        assert awaiting["kind"] == "credential"
        # No card with password fields
        assert awaiting["fields"] == []
        assert awaiting["options"] == []

        # Verify no vault hints or new vault categories
        vault_hints = d2["goal_state"].get("vault_hints") or []
        assert vault_hints == []

    def test_tap_khalast_with_popup_still_open_repeats_handoff_with_new_message(self, client):
        """
        Tap 'خلصت' with the popup still open:
        There is no card with password fields and no vault_hints or new vault categories.
        The response is the sign-up handoff with the new message.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        # Turn 1: initial encounter with signup wall
        p1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        d1 = res1.json()
        state = d1["goal_state"]

        # Turn 2: User taps "خلصت" with popup still open
        p2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "خلصت",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        assert d2["status"] == "awaiting_user_input"
        assert t("auth_signup_still_open", "ar-EG") in d2["reply"]
        awaiting = d2["goal_state"]["awaiting"]
        assert awaiting["kind"] == "credential"
        assert awaiting["fields"] == []
        assert awaiting["options"] == []

    def test_done_in_english_repeats_handoff_with_english_message(self, client):
        """
        English mode test: tapping 'done' with popup still open yields English still-open message.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        p1 = {
            "goal": "Check traffic violations",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "Create account",
            "language": "en",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        d1 = res1.json()
        state = d1["goal_state"]

        p2 = {
            "goal": "Check traffic violations",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "done",
            "language": "en",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        assert d2["status"] == "awaiting_user_input"
        assert t("auth_signup_still_open", "en") in d2["reply"]
        assert d2["goal_state"]["awaiting"]["fields"] == []

    def test_done_after_popup_gone_continues_to_service_form(self, client):
        """
        'done' after the popup is gone: the goal continues to the service form.
        Build modified copy of existing fixture without the modal.
        """
        signup_dom = load_fixture("portal_service_signup.json")
        service_dom = load_fixture("portal_form_marked_required.json")

        # Turn 1: initial signup handoff
        p1 = {
            "goal": "الاستعلام عن مخالفات المرور للرقم القومي",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        state = res1.json()["goal_state"]

        # Turn 2: User taps "done", popup is now GONE and service form is visible
        p2 = {
            "goal": "الاستعلام عن مخالفات المرور للرقم القومي",
            "goal_state": state,
            "dom_map": service_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "الاستعلام عن مخالفات المرور\nالرقم القومي\nأرقام اللوحة\nحروف اللوحة",
            "user_response": "done",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        # Goal continues: does NOT repeat signup handoff
        assert t("auth_signup_still_open", "ar-EG") not in d2.get("reply", "")
        assert t("auth_signup_handoff_prompt", "ar-EG") not in d2.get("reply", "")
        # Service form fields are targeted
        awaiting = d2.get("goal_state", {}).get("awaiting")
        if awaiting:
            field_refs = [f.get("ref") for f in awaiting.get("fields", [])]
            # Service form field references (not password or signup fields)
            assert not any("password" in r for r in field_refs)

    def test_done_when_turned_into_login_wall_uses_normal_login_path(self, client):
        """
        After 'done', if the sign-up wall turned into a login wall, use the normal login path.
        """
        signup_dom = load_fixture("portal_service_signup.json")
        login_dom = load_fixture("portal_service_login_open.json")

        # Turn 1: signup handoff
        p1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        state = res1.json()["goal_state"]

        # Turn 2: User taps "done", but now page is displaying login dialog
        p2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": login_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "done",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        # Normal login path is invoked: credential request card for login credentials
        assert d2["status"] == "awaiting_user_input"
        awaiting = d2["goal_state"]["awaiting"]
        assert awaiting["kind"] == "credential"
        # Should ask for login identifier and password
        assert len(awaiting["fields"]) == 2
        kinds = [f.get("kind") for f in awaiting["fields"]]
        assert "login_id" in kinds
        assert "password" in kinds
        # Options include "I don't have an account"
        assert t("auth_no_account_option", "ar-EG") in awaiting["options"]

    def test_tap_khalast_kamel_chip_with_popup_still_open_repeats_handoff(self, client):
        """
        On portal-service-signup.html the handoff shows the 'خلصت، كمل' chip.
        When user taps 'خلصت، كمل' with popup still open, repeat handoff with new message.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        p1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        state = res1.json()["goal_state"]

        p2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "خلصت، كمل",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        assert d2["status"] == "awaiting_user_input"
        assert t("auth_signup_still_open", "ar-EG") in d2["reply"]
        awaiting = d2["goal_state"]["awaiting"]
        assert awaiting["kind"] == "credential"
        assert awaiting["fields"] == []
        assert awaiting["options"] == []
        assert (d2["goal_state"].get("vault_hints") or []) == []

    def test_tap_done_continue_chip_with_popup_still_open_repeats_handoff(self, client):
        """
        English mode: user taps 'Done, continue' chip while popup is open.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        p1 = {
            "goal": "Check traffic violations",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "Create account",
            "language": "en",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=p1)
        state = res1.json()["goal_state"]

        p2 = {
            "goal": "Check traffic violations",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "Done, continue",
            "language": "en",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=p2)
        assert res2.status_code == 200
        d2 = res2.json()

        assert d2["status"] == "awaiting_user_input"
        assert t("auth_signup_still_open", "en") in d2["reply"]
        assert d2["goal_state"]["awaiting"]["fields"] == []

    def test_input_type_submit_value_decides_auth_wall_type(self):
        """
        Modal where submit button is <input type='submit' value='تسجيل الدخول'>
        and secondary is <button type='button'>إنشاء حساب جديد</button>.
        Must classify as 'login'.
        """
        modal_nodes = [
            {"id": "m-email", "tag": "input", "type": "email", "resolved_label": "البريد الإلكتروني", "form_id": "auth-form", "in_modal": True},
            {"id": "m-pwd", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "auth-form", "in_modal": True},
            {"id": "in-submit", "tag": "input", "type": "submit", "value": "تسجيل الدخول", "form_id": "auth-form", "in_modal": True},
            {"id": "btn-signup", "tag": "button", "type": "button", "resolved_label": "إنشاء حساب جديد", "form_id": "auth-form", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None
        assert res["type"] == "login"
        assert res["submit_ref"] == "in-submit"

    def test_button_without_explicit_type_decides_auth_wall_type(self):
        """
        Modal where primary button is <button>تسجيل الدخول</button> (default submit)
        and secondary is <button type='button'>إنشاء حساب جديد</button>.
        Must classify as 'login'.
        """
        modal_nodes = [
            {"id": "m-email", "tag": "input", "type": "email", "resolved_label": "البريد الإلكتروني", "form_id": "auth-form", "in_modal": True},
            {"id": "m-pwd", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "auth-form", "in_modal": True},
            {"id": "btn-submit", "tag": "button", "type": None, "resolved_label": "تسجيل الدخول", "form_id": "auth-form", "in_modal": True},
            {"id": "btn-signup", "tag": "button", "type": "button", "resolved_label": "إنشاء حساب جديد", "form_id": "auth-form", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None
        assert res["type"] == "login"
        assert res["submit_ref"] == "btn-submit"

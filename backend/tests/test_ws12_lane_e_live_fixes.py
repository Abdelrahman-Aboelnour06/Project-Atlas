"""
WS12 Lane E Backend Fixes Test Suite (N2 - N6)
backend/tests/test_ws12_lane_e_live_fixes.py

Comprehensive tests for:
- E1 (N2): Scoped and filtered submit selection (filters out back, cancel, reset, close, menu toggle, lang switch; ranks submit semantics; avoids "رجوع")
- E2 (N3): Multi-field required input discovery ('*', 'مطلوب', 'إجباري'), optional fields when <= 8 inputs, validation error recovery
- E3 (N4): Backwards navigation detection, wrong_controls recording by (form_id, normalized_label), and 3-revisit limit
- E4 (N5): Login wall vs sign-up wall, C5 non-dismissal, credential card, vault hints / vault clear, fieldless sign-up handoff
- E5 (N6): Target service generic CTA boost ("ابدأ الخدمة") over nav links, with negative test on unmatched home page

Strictly adheres to AGENTS.md Prime Directive: 100% universal across all websites, zero site or domain names.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.agent.form_filler import (
    _is_excluded_submit_candidate,
    _is_language_switch_control,
    _is_control_wrong,
    _score_submit_candidate,
    _is_field_required,
    is_field_value_empty,
    extract_target_form_fields,
    classify_auth_wall,
    plan_form_fill,
    _normalize_text,
)
from app.agent.navigator import (
    _score_dom_candidate,
    plan_milestone_step,
)
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


# ── Test Suite 1: E1 (N2) Scoped and Filtered Submit Selection ───────────────

class TestE1ScopedSubmitSelection:
    """
    E1: Scoped and filtered submit selection.
    Prevents picking 'رجوع' (back), '☰' (menu toggle), 'English' (lang switch), etc.
    """

    def test_e1_submit_scoped_picks_submit_never_back_first(self):
        """
        On portal-form-marked-required.html, the DOM order has:
        1. ☰ (menu button)
        2. English (lang button)
        3. رجوع (back button)
        4. استعلام (submit button)
        Atlas must pick 'استعلام', never 'رجوع' or '☰' or 'English'.
        """
        dom = load_fixture("portal_form_marked_required.json")

        # 1. Unit filter checks
        menu_btn = next(n for n in dom if "☰" in (n.get("inner_text") or "") or "☰" in (n.get("resolved_label") or "") or "القائمة" in (n.get("resolved_label") or ""))
        lang_btn = next(n for n in dom if "English" in (n.get("resolved_label") or ""))
        back_btn = next(n for n in dom if "رجوع" in (n.get("resolved_label") or ""))
        submit_btn = next(n for n in dom if "استعلام" in (n.get("resolved_label") or ""))

        assert _is_excluded_submit_candidate(menu_btn) is True, "Menu toggle button must be excluded"
        assert _is_excluded_submit_candidate(lang_btn) is True, "Language switch button must be excluded"
        assert _is_excluded_submit_candidate(back_btn) is True, "Back button 'رجوع' must be excluded"
        assert _is_excluded_submit_candidate(submit_btn) is False, "Submit button 'استعلام' must NOT be excluded"

        # 2. Score ranking check
        assert _score_submit_candidate(submit_btn) >= 80, "Submit with submit semantics must score high"

        # 3. plan_form_fill selection check
        import asyncio
        plan = asyncio.run(
            plan_form_fill(
                form_id="violations-form",
                dom_nodes=dom,
                goal="الاستعلام عن مخالفات المرور للرقم القومي",
                language="ar-EG",
            )
        )
        assert plan.submit_ref == submit_btn["id"], f"Expected submit_ref={submit_btn['id']}, got {plan.submit_ref}"

    def test_e1_no_tag_and_no_header_variants(self):
        """
        Works identically on forms inside <div> without <form> tag, and forms without headers.
        """
        import asyncio
        no_tag_dom = load_fixture("portal_form_no_tag.json")
        no_hdr_dom = load_fixture("portal_form_no_header.json")

        submit_no_tag = next(n for n in no_tag_dom if "استعلام" in (n.get("resolved_label") or ""))
        submit_no_hdr = next(n for n in no_hdr_dom if "استعلام" in (n.get("resolved_label") or ""))

        plan1 = asyncio.run(
            plan_form_fill(
                form_id="violations-box",
                dom_nodes=no_tag_dom,
                goal="الاستعلام عن مخالفات المرور",
                language="ar-EG",
            )
        )
        assert plan1.submit_ref == submit_no_tag["id"]

        plan2 = asyncio.run(
            plan_form_fill(
                form_id="violations-form",
                dom_nodes=no_hdr_dom,
                goal="الاستعلام عن مخالفات المرور",
                language="ar-EG",
            )
        )
        assert plan2.submit_ref == submit_no_hdr["id"]

    def test_e1_keyword_exclusions_whole_word_matching(self):
        """
        Directive 2: Whole word matching must NOT substring-match legitimate buttons:
        - 'Send feedback' is NOT excluded (even though 'back' is inside 'feedback')
        - 'Search' is NOT excluded
        - 'Back' IS excluded
        - An icon submit with aria-label 'بحث' is NOT excluded
        - An icon-only button without any label IS excluded
        """
        feedback_btn = {"tag": "button", "type": "submit", "resolved_label": "Send feedback"}
        search_btn = {"tag": "button", "type": "submit", "resolved_label": "Search"}
        back_btn = {"tag": "button", "type": "button", "resolved_label": "Back"}
        icon_submit_labeled = {"tag": "button", "type": "submit", "aria_label": "بحث"}
        icon_btn_empty = {"tag": "button", "type": "button", "resolved_label": "", "inner_text": "", "aria_label": ""}

        assert _is_excluded_submit_candidate(feedback_btn) is False, "'Send feedback' must NOT be excluded"
        assert _is_excluded_submit_candidate(search_btn) is False, "'Search' must NOT be excluded"
        assert _is_excluded_submit_candidate(back_btn) is True, "'Back' button must be excluded"
        assert _is_excluded_submit_candidate(icon_submit_labeled) is False, "Icon submit with aria-label must NOT be excluded"
        assert _is_excluded_submit_candidate(icon_btn_empty) is True, "Icon-only button without label must be excluded"

    def test_e1_language_switch_whole_word_only(self):
        """
        Directive 2: Language switches are only detected on whole words/codes:
        'English', 'عربي', 'EN', 'AR' are switches; 'Send', 'Start', 'Open', 'Continue' are NOT.
        """
        assert _is_language_switch_control({}, "English") is True
        assert _is_language_switch_control({}, "عربي") is True
        assert _is_language_switch_control({}, "EN") is True
        assert _is_language_switch_control({}, "AR") is True

        assert _is_language_switch_control({}, "Search") is False
        assert _is_language_switch_control({}, "Send") is False
        assert _is_language_switch_control({}, "Start") is False
        assert _is_language_switch_control({}, "Continue") is False
        assert _is_language_switch_control({}, "Open") is False


# ── Test Suite 2: E2 (N3) Required Input Discovery & Validation Recovery ──────

class TestE2RequiredFieldsAndValidationRecovery:
    """
    E2: Required markers ('*', 'مطلوب', 'إجباري'), optional inputs <= 8,
    and validation recovery re-asking ONLY errored fields after confirmed submit.
    """

    def test_e2_required_field_discovery_with_star_and_arabic_keywords(self):
        """
        On portal-form-marked-required.html:
        - الرقم القومي has required attribute
        - أرقام اللوحة has visible '*' span, no required attribute
        - حروف اللوحة has visible '*' span, no required attribute
        All 3 must be recognized as required!
        """
        dom = load_fixture("portal_form_marked_required.json")
        req_fields, opt_fields = extract_target_form_fields(dom, form_id="violations-form")

        field_labels = [f.label for f in req_fields]
        assert any("الرقم القومي" in l for l in field_labels), "National ID must be required"
        assert any("أرقام اللوحة" in l for l in field_labels), "Plate digits with '*' must be required"
        assert any("حروف اللوحة" in l for l in field_labels), "Plate letters with '*' must be required"
        assert len(req_fields) == 3

    def test_e2_optional_fields_included_when_under_eight_inputs(self):
        """
        When a form has <= 8 inputs and has non-required inputs,
        they are included in optional_fields so they can be presented to the user.
        """
        form_nodes = [
            {"id": "f1", "tag": "input", "type": "text", "resolved_label": "الاسم *", "required": True},
            {"id": "f2", "tag": "input", "type": "text", "resolved_label": "رقم الهاتف", "required": False},
            {"id": "f3", "tag": "select", "resolved_label": "المحافظة", "required": False, "options": ["اختر", "القاهرة"]},
        ]
        req_fields, opt_fields = extract_target_form_fields(form_nodes)
        assert len(req_fields) == 1
        assert len(opt_fields) == 2
        assert opt_fields[0].ref == "f2"
        assert opt_fields[1].ref == "f3"

    def test_e2_validation_error_recovery_asks_only_errored_fields(self, client):
        """
        Directive 3: On portal_form_with_errors.json, after confirmed submit:
        - National ID had valid input and has no error
        - Plate digits and plate letters have invalid=True and error_text
        Atlas must enter awaiting_user_input asking ONLY for the 2 errored fields!
        """
        err_dom = load_fixture("portal_form_with_errors.json")
        goal = "الاستعلام عن مخالفات المرور"

        payload = {
            "goal": goal,
            "goal_state": {
                "goal": goal,
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/violations",
                "hop_count": 3,
                "max_hops": 8,
                "dom_state": {
                    "last_step_was_submit": True,
                },
            },
            "dom_map": err_dom,
            "current_url": "https://portal.gov.eg/violations",
            "page_text": "يرجى إدخال أرقام اللوحة\nيرجى إدخال حروف اللوحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }

        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "awaiting_user_input"

        awaiting = data["goal_state"]["awaiting"]
        assert awaiting is not None
        reask_refs = [f["ref"] for f in awaiting.get("fields", [])]

        digits_node = next(n for n in err_dom if "أرقام اللوحة" in (n.get("resolved_label") or ""))
        letters_node = next(n for n in err_dom if "حروف اللوحة" in (n.get("resolved_label") or ""))
        nid_node = next(n for n in err_dom if "الرقم القومي" in (n.get("resolved_label") or ""))

        assert digits_node["id"] in reask_refs, "Errored digits field must be re-asked"
        assert letters_node["id"] in reask_refs, "Errored letters field must be re-asked"
        assert nid_node["id"] not in reask_refs, "Non-errored national ID must NOT be re-asked"


# ── Test Suite 3: E3 (N4) Backwards Navigation Guard ─────────────────────────

class TestE3BackwardsNavigationGuard:
    """
    E3: Backwards navigation detection, wrong_controls recording by
    (form_id, normalized_label), and 3-revisit limit.
    """

    def test_e3_backwards_navigation_detects_earlier_url_and_records_wrong_control(self, client):
        """
        Directive 4: A control with a NON-excluded label (e.g. 'متابعة' or 'التالي')
        navigates back to an earlier URL.
        Turn N: Atlas on https://portal.gov.eg/form executes act step.
        Turn N+1: lands back on https://portal.gov.eg (visited earlier in url_history).
        Atlas must record control in wrong_controls keyed by (form_id, normalized_label).
        """
        goal = "الاستعلام عن الخدمات"

        # Hop 1 on portal home
        p1 = {
            "goal": goal,
            "current_url": "https://portal.gov.eg",
            "dom_map": [{"id": "link-srv", "tag": "a", "resolved_label": "خدمات المواطنين", "href": "/form"}],
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        r1 = client.post("/v1/chat/goal_step", json=p1)
        assert r1.status_code == 200
        state = r1.json()["goal_state"]

        # Hop 2 on form page: client has executed an act step on 'btn-continue'
        state["dom_state"]["last_act_url"] = "https://portal.gov.eg/form"
        state["dom_state"]["last_act_control"] = {
            "element_id": "btn-continue",
            "label": "متابعة الطلب",
            "form_id": "service-form",
            "normalized_label": _normalize_text("متابعة الطلب"),
        }

        # Hop 3 arrives landing back on https://portal.gov.eg
        p3 = {
            "goal": goal,
            "goal_state": state,
            "current_url": "https://portal.gov.eg",
            "dom_map": [{"id": "link-srv", "tag": "a", "resolved_label": "خدمات المواطنين", "href": "/form"}],
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        r3 = client.post("/v1/chat/goal_step", json=p3)
        assert r3.status_code == 200
        data3 = r3.json()

        wrong = data3["goal_state"]["dom_state"].get("wrong_controls", [])
        assert len(wrong) >= 1
        entry = wrong[0]
        assert entry["form_id"] == "service-form"
        assert entry["normalized_label"] == _normalize_text("متابعة الطلب")
        assert entry["element_id"] == "btn-continue"

    def test_e3_wrong_control_never_picked_again(self):
        """
        Verify _is_control_wrong filters out controls in wrong_controls.
        """
        wrong_controls = [
            {"form_id": "service-form", "normalized_label": _normalize_text("متابعة الطلب"), "element_id": "btn-123"}
        ]
        bad_node = {
            "id": "btn-123",
            "form_id": "service-form",
            "resolved_label": "متابعة الطلب",
        }
        good_node = {
            "id": "btn-456",
            "form_id": "service-form",
            "resolved_label": "إرسال النموذج",
        }
        assert _is_control_wrong(bad_node, wrong_controls) is True
        assert _is_control_wrong(good_node, wrong_controls) is False

    def test_e3_url_revisit_limit_three_halts_with_localized_failure(self, client):
        """
        When Atlas visits the same URL 3 distinct times without progress,
        it must halt with status='goal_failed' and localized message.
        """
        goal = "الاستعلام عن الخدمات"

        # Simulate state where URL was already visited twice from history
        state = {
            "goal": goal,
            "status": "in_progress",
            "current_url": "https://portal.gov.eg/service",
            "hop_count": 4,
            "max_hops": 8,
            "language": "ar-EG",
            "dom_state": {
                "url_history": [
                    "https://portal.gov.eg/service",
                    "https://portal.gov.eg/other",
                    "https://portal.gov.eg/service",
                    "https://portal.gov.eg/other",
                ],
                "url_visits": {
                    "https://portal.gov.eg/service": 2,
                    "https://portal.gov.eg/other": 2,
                },
            },
        }

        # Arrive at https://portal.gov.eg/service a 3rd time
        payload = {
            "goal": goal,
            "goal_state": state,
            "current_url": "https://portal.gov.eg/service",
            "dom_map": [{"id": "btn-1", "tag": "button", "resolved_label": "تجربة"}],
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "goal_failed"
        assert t("loop_url_revisit_limit", "ar-EG") in data["reply"]


# ── Test Suite 4: E4 (N5) Login Wall vs Sign-up Wall ──────────────────────────

class TestE4LoginWallAndSignUpWall:
    """
    E4: Login wall vs sign-up wall, C5 non-dismissal, credential card,
    vault hints / vault clear, fieldless sign-up handoff.
    """

    def test_e4_auth_modal_never_dismissed_by_c5(self, client):
        """
        portal_service_login_open.json has a login dialog.
        Under WS11 C5, an irrelevant popup gets dismissed.
        Under WS12 E4, an auth dialog must NEVER be dismissed!
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")
        auth_info = classify_auth_wall(login_modal_dom)
        assert auth_info is not None
        assert auth_info["type"] == "login"
        assert auth_info["modal"] is True

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "تسجيل الدخول إلى بوابة الخدمات",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        # Must NOT emit a dismiss click step on close button
        close_node = next((n for n in login_modal_dom if n.get("resolved_label") == "إغلاق"), None)
        close_id = close_node["id"] if close_node else None

        steps = data.get("steps", [])
        if steps:
            for s in steps:
                if close_id:
                    assert s.get("element_id") != close_id, "Auth modal close button must NOT be clicked"
                assert s.get("action") != "press_key" or s.get("value") != "Escape", "Escape key must not dismiss auth modal"

    def test_e4_login_wall_empty_hints_presents_credential_card(self, client):
        """
        Directive 5: When vault_hints is empty, asks for credentials via card:
        - fields: login_id and password
        - options: [t('auth_no_account_option')] only.
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")

        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "vault_hints": [],
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "awaiting_user_input"

        awaiting = data["goal_state"]["awaiting"]
        assert awaiting["kind"] == "credential"
        fields = awaiting["fields"]
        assert len(fields) == 2
        assert any(f["kind"] == "login_id" for f in fields)
        assert any(f["kind"] == "password" for f in fields)

        # Directive 5: options = [t("auth_no_account_option")] only
        opts = awaiting.get("options") or []
        assert len(opts) == 1
        assert opts[0] == t("auth_no_account_option", "ar-EG")

    def test_e4_login_wall_with_vault_hints_asks_confirmation_and_fills_tokens(self, client):
        """
        Directive 5: When vault_hints has credentials:
        - asks confirmation with auth_login_saved_confirm
        - when user confirms, returns batch fill of {login_id} + {password} + click submit.
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")

        payload1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "vault_hints": ["login_id", "password"],
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=payload1)
        assert res1.status_code == 200
        d1 = res1.json()
        assert d1["status"] == "requires_confirmation"
        assert t("auth_login_saved_confirm", "ar-EG") in d1["reply"]

        state = d1["goal_state"]

        # Confirm proceed: "أيوة"
        payload2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "أيوة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=payload2)
        assert res2.status_code == 200
        d2 = res2.json()
        assert d2["status"] == "in_progress"

        steps = d2["steps"]
        assert len(steps) == 3  # fill id, fill pwd, click submit
        assert steps[0]["action"] == "fill" and steps[0]["value"] == "{login_id}"
        assert steps[1]["action"] == "fill" and steps[1]["value"] == "{password}"
        assert steps[2]["action"] == "click" and steps[2]["reason"] == "act"
        assert d2["goal_state"]["dom_state"]["last_step_was_login_submit"] is True

    def test_e4_login_wrong_credentials_clears_vault_and_reasks_once(self, client):
        """
        Directive 5: Wrong login clears vault via vault_clear and re-asks once.
        On 2nd failure, hands off with empty options.
        """
        err_dom = load_fixture("portal_service_login_error.json")

        # 1st failure right after login submit
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

        payload1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": err_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "اسم المستخدم أو كلمة المرور غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=payload1)
        assert res1.status_code == 200
        d1 = res1.json()
        assert d1["status"] == "awaiting_user_input"
        assert d1["vault_clear"] == ["login_id", "password"], "1st login failure must emit vault_clear"
        assert d1["goal_state"]["dom_state"]["auth_attempts"] == 1

        # 2nd failure right after login submit
        state2 = d1["goal_state"]
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
        assert d2["goal_state"]["awaiting"]["options"] == [], "Directive 5: Manual handoff must have empty options"
        assert t("auth_login_manual_handoff", "ar-EG") in d2["reply"]

    def test_e4_signup_wall_fieldless_handoff_and_resume(self, client):
        """
        Directive 5:
        - Sign-up overlay yields fieldless handoff with empty options.
        - User resume words ('done', 'خلصت', 'كمل', 'تم') resume in_progress.
        """
        signup_dom = load_fixture("portal_service_signup.json")

        payload1 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "إنشاء حساب جديد",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=payload1)
        assert res1.status_code == 200
        d1 = res1.json()
        assert d1["status"] == "awaiting_user_input"
        assert d1["goal_state"]["awaiting"]["options"] == [], "Sign-up handoff must leave options empty"
        assert t("auth_signup_handoff_prompt", "ar-EG") in d1["reply"]

        state = d1["goal_state"]

        # User replies with resume word "تم"
        payload2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "goal_state": state,
            "dom_map": signup_dom,
            "current_url": "https://portal.gov.eg/service",
            "user_response": "تم",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=payload2)
        assert res2.status_code == 200
        d2 = res2.json()
        assert d2["status"] != "awaiting_user_input"


# ── Test Suite 5: E5 (N6) Target Service Generic CTA Boost ───────────────────

class TestE5TargetServiceGenericCTABoost:
    """
    E5: Target service page generic CTA boost ('ابدأ الخدمة', 'start')
    outranking nav links when heading matches goal and no form is visible,
    with negative test on unmatched home page.
    """

    def test_e5_service_page_generic_cta_boosts_over_nav_links(self):
        """
        portal_service_initial.json:
        - Heading: 'الاستعلام عن مخالفات المرور' (matches goal)
        - Nav links: 'الأخبار', 'عن الوزارة'
        - CTA: 'ابدأ الخدمة'
        Atlas must pick 'ابدأ الخدمة' with high score over the nav links.
        """
        dom = load_fixture("portal_service_initial.json")
        goal = "الاستعلام عن مخالفات المرور"
        milestone = Milestone(id="m1", description="الوصول لخدمة الاستعلام وبدء الخدمة", status="active")

        import asyncio
        plan = asyncio.run(
            plan_milestone_step(
                goal=goal,
                milestone=milestone,
                dom_map=dom,
                current_url="https://portal.gov.eg/traffic-service",
                page_text="الاستعلام عن مخالفات المرور\nخدمة إلكترونية فورية",
                language="ar-EG",
            )
        )
        assert plan.steps is not None and len(plan.steps) >= 1
        picked_id = plan.steps[0].element_id

        cta_node = next(n for n in dom if "ابدأ الخدمة" in (n.get("resolved_label") or ""))
        assert picked_id == cta_node["id"], f"Expected CTA '{cta_node['id']}', got '{picked_id}'"

    def test_e5_generic_cta_negative_test_on_home_page(self):
        """
        Directive 6: On a home page whose heading does NOT match the goal,
        a generic 'ابدأ' button gets NO boost.
        """
        home_nodes = [
            {"id": "h1-welcome", "tag": "h1", "resolved_label": "أهلاً بكم في البوابة العامة", "role": "heading"},
            {"id": "btn-start-generic", "tag": "button", "resolved_label": "ابدأ", "landmark": "main"},
            {"id": "link-violations", "tag": "a", "resolved_label": "خدمة الاستعلام عن مخالفات المرور", "href": "/violations"},
        ]
        goal = "الاستعلام عن مخالفات المرور"
        milestone = Milestone(id="m1", description="الانتقال إلى صفحة الاستعلام عن مخالفات المرور", status="active")

        import asyncio
        plan = asyncio.run(
            plan_milestone_step(
                goal=goal,
                milestone=milestone,
                dom_map=home_nodes,
                current_url="https://portal.gov.eg/home",
                page_text="أهلاً بكم في البوابة العامة\nاختر الخدمة المطلوبة",
                language="ar-EG",
            )
        )
        assert plan.steps is not None and len(plan.steps) >= 1
        picked_id = plan.steps[0].element_id

        # Must pick the specific service link, NOT the generic 'ابدأ' button!
        assert picked_id == "link-violations", f"Expected 'link-violations', got '{picked_id}'"

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
from app.agent.intent_synonyms import (
    matches_any_keyword,
    matches_keyword_sequence,
)
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


class TestEFReviewerFixes:
    """WS12 Lane E Critical & High Reviewer Fixes (E-F1 through E-F13)."""

    def test_ef1_arabic_and_latin_keyword_matching_unit_tests(self):
        """
        E-F1: Arabic keyword matching shared helper.
        Tests all 6 required reviewer cases + Latin word boundary isolation.
        """
        # Case 1: exclude "رجوع للخلف" -> True
        assert matches_any_keyword("رجوع للخلف", {"رجوع"}) is True

        # Case 2: exclude "العودة للرئيسية" -> True
        assert matches_any_keyword("العودة للرئيسية", {"عودة", "العودة", "الرئيسية"}) is True

        # Case 3: submit semantics "استعلام عن المخالفات" -> True
        assert matches_any_keyword("استعلام عن المخالفات", {"استعلام"}) is True

        # Case 4: _is_field_required("الاسم (مطلوب)") -> True
        assert _is_field_required({"resolved_label": "الاسم (مطلوب)"}) is True

        # Case 5: CTA "ابدأ الخدمة الآن" -> True
        assert matches_any_keyword("ابدأ الخدمة الآن", {"ابدأ الخدمة", "ابدا الخدمة"}) is True

        # Case 6: classify_auth_wall(modal with heading "تسجيل الدخول إلى البوابة", an identifier input, button "متابعة") -> login
        modal_nodes = [
            {"id": "h-auth", "tag": "h2", "resolved_label": "تسجيل الدخول إلى البوابة", "in_modal": True},
            {"id": "inp-id", "tag": "input", "type": "text", "resolved_label": "الرقم القومي", "in_modal": True},
            {"id": "btn-sub", "tag": "button", "type": "submit", "resolved_label": "متابعة", "in_modal": True},
        ]
        res = classify_auth_wall(modal_nodes)
        assert res is not None
        assert res["type"] == "login"
        assert res["identifier_ref"] == "inp-id"

        # Latin word boundary negative tests
        assert matches_any_keyword("Send feedback", {"back"}) is False
        assert matches_any_keyword("Search", {"ar"}) is False
        assert matches_any_keyword("Go back", {"back"}) is True

    def test_ef2_ppo_page_with_login_header_link_not_auth_wall(self, client):
        """
        E-F2 (a): The PPO form page plus a header link "تسجيل الدخول" is NOT an auth wall,
        and the goal completes without being blocked.
        """
        ppo_dom = load_fixture("portal_form_marked_required.json")
        # Add a login link in header
        modified_dom = list(ppo_dom) + [
            {"id": "link-login", "tag": "a", "resolved_label": "تسجيل الدخول", "href": "/login", "landmark": "header"}
        ]
        auth_wall = classify_auth_wall(modified_dom)
        assert auth_wall is None, "Page without modal and without password inputs must NOT be classified as an auth wall"

        # Verify goal step execution proceeds with form filling, not auth handoff
        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": modified_dom,
            "current_url": "https://ppo.gov.eg/traffic",
            "page_text": "النيابة العامة - الاستعلام عن مخالفات المرور\nالرقم القومي\nتسجيل الدخول",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "awaiting_user_input"
        awaiting = data["goal_state"]["awaiting"]
        # Asks for form fields (national id, plate fields), NOT credential login card!
        assert awaiting["kind"] == "missing_field"

    def test_ef2_login_modal_with_long_heading_and_signup_popup_without_password(self):
        """
        E-F2 (b & c):
        - Login modal with long heading classifies correctly.
        - Signup popup with national ID + phone and 'إنشاء حساب' button but no password classifies as signup.
        """
        # b: Login modal with long heading
        login_nodes = [
            {"id": "h-login", "tag": "h1", "resolved_label": "تسجيل الدخول الموحد إلى البوابة الإلكترونية الحكومية", "in_modal": True},
            {"id": "id-inp", "tag": "input", "type": "text", "resolved_label": "اسم المستخدم", "in_modal": True},
            {"id": "pwd-inp", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "in_modal": True},
            {"id": "btn-sub", "tag": "button", "type": "submit", "resolved_label": "دخول", "in_modal": True},
        ]
        res_b = classify_auth_wall(login_nodes)
        assert res_b is not None
        assert res_b["type"] == "login"
        assert res_b["identifier_ref"] == "id-inp"
        assert res_b["password_ref"] == "pwd-inp"

        # c: Signup popup with national ID + phone and button 'إنشاء حساب' without password
        signup_nodes = [
            {"id": "h-srv", "tag": "h2", "resolved_label": "تسجيل مواطن جديد", "in_modal": True},
            {"id": "nid-inp", "tag": "input", "type": "text", "resolved_label": "الرقم القومي", "in_modal": True},
            {"id": "ph-inp", "tag": "input", "type": "tel", "resolved_label": "رقم المحمول", "in_modal": True},
            {"id": "btn-signup", "tag": "button", "type": "submit", "resolved_label": "إنشاء حساب", "in_modal": True},
        ]
        res_c = classify_auth_wall(signup_nodes)
        assert res_c is not None
        assert res_c["type"] == "signup"
        assert res_c["submit_ref"] == "btn-signup"

    def test_ef3_results_in_modal_dialog_complete_goal_without_closing(self, client):
        """
        E-F3: Results displayed in an aria-modal / role=dialog popup must complete the goal,
        and the close '×' button receives 0 clicks.
        """
        # DOM with a results dialog that is open post-submit
        results_modal_dom = [
            {"id": "res-dlg", "tag": "div", "role": "dialog", "aria_modal": "true", "in_modal": True, "resolved_label": "نتائج الاستعلام"},
            {"id": "btn-close", "tag": "button", "resolved_label": "×", "aria_label": "إغلاق", "in_modal": True},
            {"id": "res-table", "tag": "table", "in_modal": True},
            {"id": "lbl-total", "tag": "span", "resolved_label": "إجمالي المخالفات: 550 جنيه", "in_modal": True},
        ]
        # Active milestone is final milestone
        goal_state = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام عن مخالفات المرور", is_final=True, status="active")],
            plan_steps=[PlanStep(action="click", element_id="btn-submit", description="استعلام", reason="act")],
            dom_state={"last_step_was_submit": True, "pending_form_id": "traffic-form", "ids": ["res-dlg", "btn-close", "res-table", "lbl-total"]},
        )
        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": results_modal_dom,
            "current_url": "https://ppo.gov.eg/traffic",
            "page_text": "نتائج الاستعلام\nإجمالي المخالفات: 550 جنيه",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "goal_state": goal_state.model_dump(),
            "contract_version": 3,
            "last_action_result": {
                "ok": True,
                "change_summary": {"text_changed": True, "added_visible_count": 3}
            }
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        # Goal must complete!
        assert data["status"] == "goal_complete"
        # Zero clicks on the close button
        steps = data.get("steps") or []
        assert all(s.get("element_id") != "btn-close" for s in steps)

    def test_ef4_cta_boost_picks_start_service_over_news(self, client):
        """
        E-F4: Goal 'اريد الاستفسار عن مخالفات المركبات' on portal-service-login.html
        picks 'ابدأ الخدمة' (section_label='الاستعلام عن مخالفات رخص المركبات'),
        NOT 'الأخبار' nav link, even when 'اريد' and 'الاستفسار' are not literal words in heading.
        """
        dom = load_fixture("portal_service_initial.json")
        goal = "اريد الاستفسار عن مخالفات المركبات"
        payload = {
            "goal": goal,
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "الاستعلام عن مخالفات رخص المركبات\nخدمة فورية تمكّنك من معرفة مخالفات المرور",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()
        steps = data.get("steps") or []
        assert len(steps) >= 1
        chosen_id = steps[0]["element_id"]
        chosen_node = next((n for n in dom if n.get("id") == chosen_id), None)
        assert chosen_node is not None
        assert chosen_node.get("resolved_label") == "ابدأ الخدمة"
        news_node = next((n for n in dom if "الأخبار" in (n.get("resolved_label") or "")), None)
        if news_node:
            assert chosen_id != news_node.get("id")

    def test_ef5_saved_login_vault_hints_exact_categories_and_second_failure_clear(self, client):
        """
        E-F5:
        - Exact categories 'login_id' and 'password' required for saved login prompt.
        - Second login failure emits vault_clear: ['login_id', 'password'].
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")

        # 1. Partial/loose hint like 'user' or 'email' does NOT trigger saved login confirmation
        payload_loose = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "vault_hints": ["username", "pass"],  # loose substrings, not exact 'login_id' and 'password'
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res_loose = client.post("/v1/chat/goal_step", json=payload_loose)
        data_loose = res_loose.json()
        assert data_loose["status"] == "awaiting_user_input", "Loose hints must not trigger saved login confirmation"

        # 2. Exact 'login_id' and 'password' triggers saved login confirmation
        payload_exact = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "vault_hints": ["login_id", "password"],
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res_exact = client.post("/v1/chat/goal_step", json=payload_exact)
        data_exact = res_exact.json()
        assert data_exact["status"] == "requires_confirmation"
        assert data_exact["requires_confirmation"] is True

        # 3. 2nd login failure emits vault_clear: ['login_id', 'password']
        goal_state_fail2 = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="تسجيل الدخول", status="active")],
            plan_steps=[PlanStep(action="click", element_id="login-submit", description="تسجيل الدخول", reason="act")],
            dom_state={"last_step_was_login_submit": True, "auth_attempts": 1},
        )
        login_err_dom = load_fixture("portal_service_login_error.json")
        payload_fail2 = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_err_dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": "اسم المستخدم أو كلمة المرور غير صحيحة",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "goal_state": goal_state_fail2.model_dump(),
            "contract_version": 3,
        }
        res_fail2 = client.post("/v1/chat/goal_step", json=payload_fail2)
        data_fail2 = res_fail2.json()
        assert data_fail2["status"] == "awaiting_user_input"
        assert data_fail2.get("vault_clear") == ["login_id", "password"]

    def test_ef6_vault_login_property_on_plan_step(self):
        """
        E-F6: PlanStep schema supports optional boolean vault_login.
        """
        step = PlanStep(
            action="fill",
            element_id="inp-pwd",
            value="{password}",
            vault_login=True,
        )
        assert step.vault_login is True
        d = step.model_dump()
        assert d["vault_login"] is True

    def test_ef7_planned_backtracks_do_not_halt_and_confirmation_preserves_label(self, client):
        """
        E-F7:
        - Three planned backtracks (reason='backtrack') to home URL do NOT stop goal with loop_url_revisit_limit.
        - Confirmation branch does NOT overwrite last_act_control if already set.
        """
        home_url = "https://portal.gov.eg/home"
        dom = [{"id": "link-a", "tag": "a", "resolved_label": "خدمة أ", "href": "/a"}]

        # Hop with planned backtrack step to home
        gs = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="البحث عن الخدمة", status="active")],
            plan_steps=[PlanStep(action="click", element_id="btn-back", description="رجوع", reason="backtrack")],
            dom_state={"url_history": [home_url, "https://portal.gov.eg/a"], "url_visits": {home_url: 1, "https://portal.gov.eg/a": 1}},
        )
        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": dom,
            "current_url": home_url,
            "page_text": "الصفحة الرئيسية",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "goal_state": gs.model_dump(),
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        data = res.json()
        # Must NOT fail with loop_url_revisit_limit!
        assert data["status"] != "goal_failed"

        # Check confirmation branch preserves last_act_control label
        gs_confirm = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="requires_confirmation",
            requires_confirmation=True,
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            pending_step=PlanStep(action="click", element_id="btn-submit", description="Submit form (استعلام)", reason="act"),
            dom_state={"last_act_control": {"element_id": "btn-submit", "label": "استعلام", "normalized_label": "استعلام"}},
        )
        payload_confirm = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/form",
            "page_text": "نموذج الاستعلام",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "user_response": "أيوة",
            "goal_state": gs_confirm.model_dump(),
            "contract_version": 3,
        }
        res_conf = client.post("/v1/chat/goal_step", json=payload_confirm)
        data_conf = res_conf.json()
        act_ctrl = data_conf["goal_state"]["dom_state"].get("last_act_control")
        assert act_ctrl is not None
        assert act_ctrl["label"] == "استعلام", "Real button label must be preserved, not overwritten with description"

    def test_ef8_validation_recovery_scoped_to_pending_form(self, client):
        """
        E-F8: Validation recovery scopes to pending_form_id, and an empty required newsletter outside
        does NOT trigger re-ask.
        """
        dom = [
            # Pending form fields
            {"id": "inp-id", "tag": "input", "form_id": "violations-form", "current_value": "12345678901234", "resolved_label": "الرقم القومي"},
            {"id": "inp-plate", "tag": "input", "form_id": "violations-form", "current_value": "", "invalid": True, "error_text": "حقل مطلوب", "resolved_label": "رقم اللوحة"},
            # External empty required field (e.g. footer newsletter)
            {"id": "inp-news", "tag": "input", "form_id": "footer-newsletter", "current_value": "", "invalid": True, "required": True, "resolved_label": "النشرة البريدية"},
        ]
        gs = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[PlanStep(action="click", element_id="btn-sub", description="استعلام", reason="act")],
            dom_state={"last_step_was_submit": True, "pending_form_id": "violations-form"},
        )
        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/form",
            "page_text": "رقم اللوحة حقل مطلوب",
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "goal_state": gs.model_dump(),
            "contract_version": 3,
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        data = res.json()
        assert data["status"] == "awaiting_user_input"
        awaiting = data["goal_state"]["awaiting"]
        fields = awaiting["fields"]
        # Only inp-plate from violations-form must be re-asked, NOT inp-news from footer-newsletter!
        assert len(fields) == 1
        assert fields[0]["ref"] == "inp-plate"

    def test_ef10_visible_change_accepts_client_change_summary(self, client):
        """
        E-F10: After submit, visible change is detected via client change summary
        (added_visible_count > 0 or text_changed: true) even when page_text is unchanged.
        """
        dom = [
            {"id": "btn-sub", "tag": "button", "type": "submit", "resolved_label": "عرض المخالفات"},
        ]
        pre_rendered_text = "عرض المخالفات\nإجمالي المخالفات: 550 جنيه"
        gs = GoalState(
            goal="الاستعلام عن مخالفات المرور",
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام عن مخالفات المرور", is_final=True, status="active")],
            plan_steps=[PlanStep(action="click", element_id="btn-sub", description="Submit form (عرض المخالفات)", reason="act")],
            dom_state={"last_step_was_submit": True, "page_text": pre_rendered_text, "ids": ["btn-sub"]},
        )
        payload = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": dom,
            "current_url": "https://portal.gov.eg/service",
            "page_text": pre_rendered_text,  # Pre-rendered class-hidden text: exactly same as before submit
            "language": "ar-EG",
            "api_key": DEMO_KEY,
            "goal_state": gs.model_dump(),
            "contract_version": 3,
            "last_action_result": {
                "ok": True,
                "change_summary": {"text_changed": False, "added_visible_count": 2}
            }
        }
        res = client.post("/v1/chat/goal_step", json=payload)
        data = res.json()
        assert data["status"] == "goal_complete"

    def test_ef12_no_account_option_exact_match(self, client):
        """
        E-F12: Option 'معنديش حساب' matches exactly after normalization.
        Replies containing 'حساب' like 'عملت حساب' do NOT trigger the signup handoff.
        """
        login_modal_dom = load_fixture("portal_service_login_open.json")

        # 1. Exact match triggers signup handoff
        payload_no_acc = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "user_response": "معنديش حساب",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res1 = client.post("/v1/chat/goal_step", json=payload_no_acc)
        data1 = res1.json()
        assert data1["status"] == "awaiting_user_input"
        assert data1["reply"] == t("auth_signup_handoff_prompt", "ar-EG")

        # 2. 'عملت حساب' must NOT trigger signup handoff
        payload_created_acc = {
            "goal": "الاستعلام عن مخالفات المرور",
            "dom_map": login_modal_dom,
            "current_url": "https://portal.gov.eg/service",
            "language": "ar-EG",
            "user_response": "عملت حساب",
            "api_key": DEMO_KEY,
            "contract_version": 3,
        }
        res2 = client.post("/v1/chat/goal_step", json=payload_created_acc)
        data2 = res2.json()
        assert data2["reply"] != t("auth_signup_handoff_prompt", "ar-EG")

    def test_ef13_submit_with_aria_controls_is_not_excluded(self):
        """
        E-F13: A submit button with aria-controls='results' is NOT excluded by _is_excluded_submit_candidate.
        """
        node = {
            "tag": "button",
            "type": "submit",
            "resolved_label": "استعلام",
            "aria_controls": "results-region",
        }
        assert _is_excluded_submit_candidate(node) is False
        assert _score_submit_candidate(node) == 100

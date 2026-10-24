"""
WS12 Lane E final fixes (found with the real extension on top of round 2).
backend/tests/test_ws12_lane_e_final.py

Validates:
- F1: After a login, the hop that carries the user's card answer never completes the goal.
      The login click is not a form submit. Atlas fills the answer, submits the service form,
      and completes only when the results show.
- F2: A submit that reveals the next step of a multi-step form (new required empty inputs)
      is not the result, even when hidden result text is already in page_text.
- F3: A field Atlas filled that the site emptied and marked invalid is errored, even when the
      error message is not linked to the field. A full reset after success is not an error.
- F4: Every resume word hands a still-open sign-up popup back to the user.
- F5: On a submit tie, a login-worded button wins over a "create account" submit.
- F6: A slow login gets up to 3 wait hops before it counts as a failure.
- F7: The completion summary prefers a total line that carries a number.

Generic only: no site or topic words in production code. Placeholder ID 00000000000000 only.
"""

import os
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.i18n import t
from app.models.goal import GoalState, Milestone, PlanStep
from app.agent.form_filler import classify_auth_wall

DEMO_KEY = "atlas_lane_e_final_test_key"
GOAL = "اريد الاستفسار عن مخالفات المركبات"


@pytest.fixture
def client():
    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_KEY else None),
    ):
        with TestClient(app) as test_client:
            yield test_client


def _inp(ref: str, label: str, form_id: str, value: str = "", required: bool = True, **extra: Any) -> Dict[str, Any]:
    node = {
        "ref": ref,
        "id": ref,
        "tag": "input",
        "type": "text",
        "resolved_label": label,
        "form_id": form_id,
        "required": required,
        "current_value": value,
        "visible": True,
        "invalid": bool(required and not value),
        "error_text": None,
    }
    node.update(extra)
    return node


def _btn(ref: str, label: str, form_id: Optional[str] = None, btype: str = "submit", **extra: Any) -> Dict[str, Any]:
    node = {"ref": ref, "id": ref, "tag": "button", "type": btype, "resolved_label": label, "inner_text": label, "visible": True}
    if form_id:
        node["form_id"] = form_id
    node.update(extra)
    return node


def _post(client: TestClient, dom: List[Dict[str, Any]], page_text: str, goal_state: Optional[Dict[str, Any]] = None, **extra: Any) -> Dict[str, Any]:
    payload = {
        "goal": GOAL,
        "dom_map": dom,
        "current_url": "https://portal.example/service",
        "page_text": page_text,
        "language": "ar-EG",
        "api_key": DEMO_KEY,
        "contract_version": 3,
    }
    if goal_state is not None:
        payload["goal_state"] = goal_state
    payload.update(extra)
    res = client.post("/v1/chat/goal_step", json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _step_strings(data: Dict[str, Any]) -> List[str]:
    return [f"{s['action']}:{s.get('element_id')}:{s.get('value') or ''}" for s in (data.get("steps") or [])]


# ── F1: no completion on the hop that carries the user's answer after a login ──

SERVICE_TEXT = "بوابة الخدمات الحكومية الرئيسية\nبيانات استعلام رخصة المركبة\nرقم اللوحة *\nعرض المخالفات"
RESULTS_TEXT = SERVICE_TEXT + "\nنتائج الاستعلام عن المخالفات\nرقم المخالفة\tتاريخ المخالفة\tالمبلغ\n1024\t2026-05-12\t350 جنيه\nالإجمالي\t350 جنيه"


def _service_dom(plate_value: str = "", with_results: bool = False) -> List[Dict[str, Any]]:
    dom = [
        {"ref": "nav-home", "id": "nav-home", "tag": "a", "resolved_label": "الرئيسية", "href": "/", "visible": True},
        _inp("plate-no", "رقم اللوحة *", "svc-form", plate_value),
        _btn("svc-submit", "عرض المخالفات", "svc-form"),
    ]
    if with_results:
        dom.append({"ref": "results", "id": "results", "tag": "div", "role": "region", "resolved_label": "نتائج الاستعلام", "visible": True})
        dom.append({"ref": "results-table", "id": "results-table", "tag": "table", "visible": True})
    return dom


class TestF1NoCompletionOnAnswerHopAfterLogin:

    def _after_login_state(self) -> Dict[str, Any]:
        gs = GoalState(
            goal=GOAL,
            status="in_progress",
            active_milestone_id="m1",
            milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
            plan_steps=[
                PlanStep(action="click", element_id="start", description="Click 'ابدأ الخدمة'", reason="act"),
                PlanStep(action="fill", element_id="login-id", value="{login_id}", description="Fill identifier", vault_login=True),
                PlanStep(action="fill", element_id="login-pass", value="{password}", description="Fill password: {password}", vault_login=True),
                PlanStep(action="click", element_id="login-submit", description="Submit login (تسجيل الدخول)", reason="act", vault_login=True),
            ],
            dom_state={
                "last_step_was_login_submit": True,
                "page_text": "بوابة الخدمات الحكومية الرئيسية\nتسجيل الدخول",
                "ids": ["nav-home", "login-id", "login-pass", "login-submit"],
            },
        )
        return gs.model_dump()

    def test_login_then_answer_fills_submits_and_completes_with_results(self, client):
        change = {"action": "click", "text_changed": True, "added_visible_count": 3}

        # Hop 1: login worked, the service form asks for the plate
        d1 = _post(client, _service_dom(), SERVICE_TEXT, self._after_login_state(), last_action_result=change,
                   vault_hints=["login_id", "password"])
        assert d1["status"] == "awaiting_user_input"
        assert d1["goal_state"]["awaiting"]["kind"] == "missing_field"
        assert [f["ref"] for f in d1["goal_state"]["awaiting"]["fields"]] == ["plate-no"]
        assert d1["reply"] != t("form_validation_error_reask", "ar-EG", field="رقم اللوحة *")

        # Hop 2: the user answers the card. Same page, nothing filled yet: never goal_complete
        d2 = _post(client, _service_dom(), SERVICE_TEXT, d1["goal_state"], user_inputs={"plate-no": "1234"},
                   last_action_result=change, vault_hints=["login_id", "password"])
        assert d2["status"] != "goal_complete", "The answer hop must fill the field, not complete the goal"
        assert "تم اكتمال الهدف" not in d2.get("reply", "")
        assert "fill:plate-no:1234" in _step_strings(d2)

        # Hop 3: the plate is filled, Atlas asks to submit
        d3 = _post(client, _service_dom("1234"), SERVICE_TEXT, d2["goal_state"],
                   last_action_result={"action": "fill", "text_changed": False}, vault_hints=["login_id", "password"])
        assert d3["status"] == "requires_confirmation"

        # Hop 4: confirmed, Atlas clicks the service form's submit
        d4 = _post(client, _service_dom("1234"), SERVICE_TEXT, d3["goal_state"], user_response="yes",
                   vault_hints=["login_id", "password"])
        assert any(s.startswith("click:svc-submit") for s in _step_strings(d4))

        # Hop 5: results visible: goal complete with the total
        d5 = _post(client, _service_dom("1234", with_results=True), RESULTS_TEXT, d4["goal_state"],
                   last_action_result={"action": "click", "text_changed": True, "added_visible_count": 2},
                   vault_hints=["login_id", "password"])
        assert d5["status"] == "goal_complete"
        assert "350 جنيه" in d5["reply"]

    def test_login_click_is_not_a_form_submit_even_with_change(self, client):
        # Verifier and change signals both say "something changed" right after the login click.
        d1 = _post(client, _service_dom(), SERVICE_TEXT, self._after_login_state(),
                   last_action_result={"action": "click", "text_changed": True, "added_visible_count": 5})
        assert d1["status"] != "goal_complete"


# ── F2: multi-step form: the next step is not the result ──

STEP1_TEXT = "الاستعلام عن مخالفات المركبات\nالخطوة 1 من 2: بيانات المالك\nالرقم القومي *\nالتالي\nإجمالي المخالفات المستحقة: 550 ج.م"
STEP2_TEXT = "الاستعلام عن مخالفات المركبات\nالخطوة 2 من 2: بيانات المركبة\nأرقام اللوحة *\nحروف اللوحة *\nاستعلام\nإجمالي المخالفات المستحقة: 550 ج.م"


def _step1_dom(nid: str = "") -> List[Dict[str, Any]]:
    return [_inp("nid", "الرقم القومي *", "s1", nid, section_label="الاستعلام عن مخالفات المركبات"), _btn("next", "التالي", "s1")]


def _step2_dom() -> List[Dict[str, Any]]:
    return [
        _inp("pd", "أرقام اللوحة *", "s2", section_label="الاستعلام عن مخالفات المركبات"),
        _inp("pl", "حروف اللوحة *", "s2", section_label="الاستعلام عن مخالفات المركبات"),
        _btn("go", "استعلام", "s2"),
    ]


class TestF2MultiStepFormIsNotTheResult:

    def test_next_step_inputs_are_asked_not_completed(self, client):
        d1 = _post(client, _step1_dom(), STEP1_TEXT)
        assert d1["status"] == "awaiting_user_input"
        assert [f["ref"] for f in d1["goal_state"]["awaiting"]["fields"]] == ["nid"]

        # The client sends the sensitive answer as a vault token
        d2 = _post(client, _step1_dom(), STEP1_TEXT, d1["goal_state"], user_inputs={"nid": "{secret}"}, vault_hints=["secret"])
        assert any(s.startswith("fill:nid:") for s in _step_strings(d2))

        d3 = _post(client, _step1_dom("{secret}"), STEP1_TEXT, d2["goal_state"],
                   last_action_result={"action": "fill", "text_changed": False}, vault_hints=["secret"])
        assert d3["status"] == "requires_confirmation"

        d4 = _post(client, _step1_dom("{secret}"), STEP1_TEXT, d3["goal_state"], user_response="yes", vault_hints=["secret"])
        assert any(s.startswith("click:next") for s in _step_strings(d4))

        # The step-1 form is gone and step 2 appears. The hidden result text was already in page_text.
        d5 = _post(client, _step2_dom(), STEP2_TEXT, d4["goal_state"],
                   last_action_result={"action": "click", "text_changed": True, "added_visible_count": 3}, vault_hints=["secret"])
        assert d5["status"] != "goal_complete", "The next step of the form is not the result"
        assert "550" not in d5.get("reply", "")
        assert d5["status"] == "awaiting_user_input"
        assert sorted(f["ref"] for f in d5["goal_state"]["awaiting"]["fields"]) == ["pd", "pl"]


# ── F3: site empties a field Atlas filled and marks it invalid, with an unlinked message ──

FORM_TEXT = "الاستعلام\nالرقم القومي *\nأرقام اللوحة *\nحروف اللوحة *\nاستعلام"


def _submitted_state(page_text: str) -> Dict[str, Any]:
    gs = GoalState(
        goal=GOAL,
        status="in_progress",
        active_milestone_id="m1",
        milestones=[Milestone(id="m1", description="الاستعلام", is_final=True, status="active")],
        plan_steps=[
            PlanStep(action="fill", element_id="nid", value="{secret}"),
            PlanStep(action="fill", element_id="pd", value="1234"),
            PlanStep(action="fill", element_id="pl", value="أبج"),
            PlanStep(action="click", element_id="go", description="Submit form (استعلام)", reason="act"),
        ],
        dom_state={
            "last_step_was_submit": True,
            "pending_form_id": "inq",
            "filled_form_refs": ["nid", "pd", "pl"],
            "page_text": page_text,
            "ids": ["nid", "pd", "pl", "go"],
        },
    )
    return gs.model_dump()


class TestF3SiteClearedFieldIsErrored:

    def test_cleared_and_invalid_field_without_linked_message_is_reasked(self, client):
        dom = [
            _inp("nid", "الرقم القومي *", "inq", "{secret}"),
            _inp("pd", "أرقام اللوحة *", "inq", "", required=False, invalid=True),
            _inp("pl", "حروف اللوحة *", "inq", "أبج"),
            _btn("go", "استعلام", "inq"),
        ]
        d = _post(client, dom, FORM_TEXT + "\nأرقام اللوحة غير صحيحة", _submitted_state(FORM_TEXT),
                  last_action_result={"action": "click", "text_changed": True, "added_visible_count": 1})
        assert d["status"] == "awaiting_user_input", "A validation error must not be reported as success"
        assert "تم اكتمال الهدف" not in d.get("reply", "")
        assert [f["ref"] for f in d["goal_state"]["awaiting"]["fields"]] == ["pd"]

    def test_full_reset_after_success_is_not_an_error(self, client):
        dom = [
            _inp("nid", "الرقم القومي *", "inq", ""),
            _inp("pd", "أرقام اللوحة *", "inq", ""),
            _inp("pl", "حروف اللوحة *", "inq", ""),
            _btn("go", "استعلام", "inq"),
            {"ref": "res", "id": "res", "tag": "div", "role": "region", "resolved_label": "النتيجة", "visible": True},
        ]
        d = _post(client, dom, FORM_TEXT + "\nإجمالي المخالفات المستحقة: 550 ج.م", _submitted_state(FORM_TEXT),
                  last_action_result={"action": "click", "text_changed": True, "added_visible_count": 2})
        assert d["status"] == "goal_complete"
        assert "550" in d["reply"]


# ── F4: every resume word hands a still-open sign-up popup back ──

SIGNUP_DOM = [
    {"ref": "su-h", "id": "su-h", "tag": "h2", "inner_text": "إنشاء حساب جديد", "resolved_label": "إنشاء حساب جديد", "in_modal": True, "visible": True},
    {"ref": "su-nid", "id": "su-nid", "tag": "input", "type": "text", "resolved_label": "الرقم القومي", "form_id": "su", "in_modal": True, "visible": True},
    {"ref": "su-phone", "id": "su-phone", "tag": "input", "type": "tel", "resolved_label": "رقم الهاتف", "form_id": "su", "in_modal": True, "visible": True},
    {"ref": "su-close", "id": "su-close", "tag": "button", "type": "button", "aria_label": "إغلاق", "resolved_label": "إغلاق", "in_modal": True, "visible": True},
    {"ref": "su-submit", "id": "su-submit", "tag": "button", "type": "submit", "resolved_label": "إنشاء حساب", "form_id": "su", "in_modal": True, "visible": True},
]


class TestF4ResumeWordsWithSignupStillOpen:

    @pytest.mark.parametrize("word", ["تم", "كمل", "خلصت", "done", "continue"])
    def test_resume_word_repeats_signup_handoff(self, client, word):
        d1 = _post(client, SIGNUP_DOM, "إنشاء حساب جديد")
        assert d1["status"] == "awaiting_user_input"
        d2 = _post(client, SIGNUP_DOM, "إنشاء حساب جديد", d1["goal_state"], user_response=word)
        assert d2["status"] == "awaiting_user_input"
        assert d2["reply"] == t("auth_signup_still_open", "ar-EG")
        assert d2["goal_state"]["awaiting"]["fields"] == []
        assert not d2.get("steps"), "Atlas must not act on the sign-up popup (no close, no fill)"


# ── F5: submit tie in a single-password form ──

class TestF5LoginWordWinsSubmitTie:

    def test_create_account_submit_before_login_submit_is_still_login(self):
        nodes = [
            {"ref": "h", "id": "h", "tag": "h2", "inner_text": "تسجيل الدخول", "resolved_label": "تسجيل الدخول", "in_modal": True},
            {"ref": "e", "id": "e", "tag": "input", "type": "email", "resolved_label": "البريد الإلكتروني", "form_id": "lf", "in_modal": True},
            {"ref": "p", "id": "p", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "lf", "in_modal": True},
            {"ref": "c", "id": "c", "tag": "button", "type": "submit", "resolved_label": "إنشاء حساب جديد", "form_id": "lf", "in_modal": True},
            {"ref": "s", "id": "s", "tag": "button", "type": "submit", "resolved_label": "تسجيل الدخول", "form_id": "lf", "in_modal": True},
        ]
        res = classify_auth_wall(nodes)
        assert res is not None
        assert res["type"] == "login"
        assert res["submit_ref"] == "s"


# ── F6: slow login gets up to 3 wait hops ──

LOGIN_DOM = [
    {"ref": "lh", "id": "lh", "tag": "h2", "inner_text": "تسجيل الدخول", "resolved_label": "تسجيل الدخول", "in_modal": True, "visible": True},
    {"ref": "lid", "id": "lid", "tag": "input", "type": "text", "resolved_label": "الرقم القومي أو البريد الإلكتروني", "form_id": "lf", "in_modal": True, "current_value": "{login_id}", "visible": True},
    {"ref": "lpw", "id": "lpw", "tag": "input", "type": "password", "resolved_label": "كلمة المرور", "form_id": "lf", "in_modal": True, "current_value": "{password}", "visible": True},
    {"ref": "lsub", "id": "lsub", "tag": "button", "type": "submit", "resolved_label": "تسجيل الدخول", "form_id": "lf", "in_modal": True, "visible": True},
]


class TestF6SlowLoginWaits:

    def test_three_wait_hops_then_failure(self, client):
        gs = GoalState(goal=GOAL, status="in_progress", dom_state={"last_step_was_login_submit": True}).model_dump()
        for hop in (1, 2, 3):
            d = _post(client, LOGIN_DOM, "تسجيل الدخول", gs)
            assert d["status"] == "in_progress", f"wait hop {hop}"
            assert not d.get("vault_clear"), f"wait hop {hop} must keep the saved login"
            assert d["goal_state"]["dom_state"]["login_wait_hops"] == hop
            gs = d["goal_state"]
        d = _post(client, LOGIN_DOM, "تسجيل الدخول", gs)
        assert d.get("vault_clear") == ["login_id", "password"], "After the wait hops it counts as a failed login"


# ── F7: summary picks the total line with a number ──

class TestF7SummaryPrefersNumberedTotal:

    def test_total_cell_and_value_cell_are_joined(self, client):
        dom = [
            _inp("nid", "الرقم القومي *", "inq", "{secret}"),
            _inp("pd", "أرقام اللوحة *", "inq", "1234"),
            _inp("pl", "حروف اللوحة *", "inq", "أبج"),
            _btn("go", "استعلام", "inq"),
            {"ref": "res", "id": "res", "tag": "table", "visible": True},
        ]
        before = "يرجى إدخال البيانات المطلوبة للاستعلام عن إجمالي المخالفات المسجلة.\n" + FORM_TEXT
        after = before + "\nرقم المخالفة\tتاريخ المخالفة\tالمبلغ\n1024\t2026-05-12\t350 جنيه\nالإجمالي\t350 جنيه"
        d = _post(client, dom, after, _submitted_state(before),
                  last_action_result={"action": "click", "text_changed": True, "added_visible_count": 2})
        assert d["status"] == "goal_complete"
        assert "الإجمالي 350 جنيه" in d["reply"]
        assert "يرجى إدخال" not in d["reply"]

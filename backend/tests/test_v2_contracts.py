"""
Unit Tests for Atlas v2 Contracts (Track 0)
backend/tests/test_v2_contracts.py
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.models.action import ActionType
from app.models.dom import DomNode, MenuInfo, SelectOption
from app.models.goal import (
    Branch,
    Budget,
    FieldPlan,
    FormPlan,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
    InputField,
    Milestone,
    PlanStep,
    UserInputRequest,
)
from app.routes.chat import ChatRequest, ChatResponse


class TestV2Contracts:
    def test_all_v2_action_types_valid(self):
        """Validates all action verbs defined in §9.1 including multi-click verbs."""
        actions = [
            "click", "open", "double_click", "triple_click", "fill", "scroll", "focus",
            "select_option", "set_checkbox", "set_radio", "press_key", "upload_file", "wait_for"
        ]
        for act in actions:
            step = PlanStep(action=act, element_id="atlas-001")
            assert step.action == act

        # Verify multi-click PlanStep
        multi_step = PlanStep(action="click", element_id="atlas-001", click_count=3)
        assert multi_step.click_count == 3
        assert multi_step.action == "click"

    def test_select_option_and_dom_node_v2(self):
        """Validates DomNode v2 with options, disabled, and form attributes."""
        opt1 = SelectOption(value="us", label="United States", selected=True)
        opt2 = SelectOption(value="ca", label="Canada", selected=False)

        node = DomNode(
            id="atlas-sel-1",
            tag="select",
            type="select-one",
            inner_text=None,
            placeholder=None,
            aria_label="Country",
            href=None,
            name="country",
            ref="el_7f3a9c2b1d",
            form_id="form_register",
            required=True,
            disabled=False,
            options=[opt1, opt2],
            section_label="Billing Address",
        )
        assert node.ref == "el_7f3a9c2b1d"
        assert node.form_id == "form_register"
        assert node.required is True
        assert node.disabled is False
        assert len(node.options) == 2
        assert node.options[0].selected is True
        assert node.section_label == "Billing Address"

    def test_field_plan_and_form_plan_contracts(self):
        """Validates FieldPlan and FormPlan models (§9.4)."""
        f1 = FieldPlan(
            ref="el_email",
            action="fill",
            value="{profile.email}",
            source="profile",
            confidence=0.98,
            rationale="Autofilled from user profile",
        )
        f2 = FieldPlan(
            ref="el_pwd",
            action="fill",
            value="{password}",
            source="vault",
            confidence=1.0,
        )

        form = FormPlan(
            form_id="form_reg",
            fields=[f1, f2],
            submit_ref="el_submit_btn",
            missing_required=["el_phone"],
            blockers=["captcha"],
        )

        assert form.form_id == "form_reg"
        assert len(form.fields) == 2
        assert form.submit_ref == "el_submit_btn"
        # submit_ref must NOT be in fields
        assert all(f.ref != form.submit_ref for f in form.fields)
        assert form.missing_required == ["el_phone"]
        assert form.blockers == ["captcha"]

    def test_budget_and_branch_models(self):
        """Validates Budget, Branch, and UserInputRequest models (§9.5)."""
        budget = Budget(max_hops=10, max_field_ops=50, max_llm_calls=30)
        assert budget.max_hops == 10
        assert budget.hop_count == 0

        branch = Branch(id="b-1", milestone_ids=["m-1", "m-2"], status="active")
        assert branch.id == "b-1"
        assert branch.status == "active"

        ask = UserInputRequest(
            kind="otp",
            prompt="Please enter the 6-digit verification code sent to your phone",
            field_ref="el_otp_input",
            resumable=True,
        )
        assert ask.kind == "otp"
        assert ask.resumable is True

    def test_goal_state_next_pending_milestone(self):
        """Validates next_pending_milestone() helper on GoalState."""
        m1 = Milestone(id="m-1", description="Visit store", status="completed")
        m2 = Milestone(id="m-2", description="Select product", status="active")
        m3 = Milestone(id="m-3", description="Checkout", status="pending")

        state = GoalState(
            goal="Buy shoes",
            milestones=[m1, m2, m3],
            active_milestone_id="m-2",
        )

        next_m = state.next_pending_milestone()
        assert next_m is not None
        assert next_m.id == "m-3"
        assert next_m.description == "Checkout"

        # Advance milestone 3
        m3.status = "completed"
        assert state.next_pending_milestone() is None


class TestV3Contracts:
    """Validates Contract v3 enhancements: latent nodes, exploration metadata, multi-field inputs, and language."""

    def test_action_type_includes_reveal(self):
        """Validates that 'reveal' is accepted by ActionType and PlanStep."""
        step = PlanStep(
            action="reveal",
            element_id="atlas-toggle-001",
            reason="reveal_menu",
            expect="Submenu containing services list",
        )
        assert step.action == "reveal"
        assert step.reason == "reveal_menu"
        assert step.expect == "Submenu containing services list"

    def test_plan_step_reason_literals_and_validation(self):
        """Validates exploration reasons: reveal_menu, navigate, search, backtrack, act."""
        valid_reasons = ["reveal_menu", "navigate", "search", "backtrack", "act"]
        for r in valid_reasons:
            step = PlanStep(action="click", element_id="atlas-002", reason=r)
            assert step.reason == r

        # Defaults to None
        default_step = PlanStep(action="click", element_id="atlas-002")
        assert default_step.reason is None
        assert default_step.expect is None

        # Invalid reason raises ValidationError
        with pytest.raises(ValidationError):
            PlanStep(action="click", element_id="atlas-002", reason="invalid_reason")

    def test_dom_node_v3_latent_fields_roundtrip(self):
        """Validates DomNode v3 latent navigation fields and MenuInfo round-trip."""
        menu = MenuInfo(haspopup="true", expanded=False, controls="dropdown-01")
        node = DomNode(
            id="atlas-latent-1",
            tag="a",
            inner_text="Traffic Violations",
            visible=False,
            reveal_via="atlas-toggle-menu",
            menu=menu,
            landmark="nav",
            breadcrumb=["Home", "Citizen Services", "Traffic"],
        )
        data = node.model_dump()
        assert data["visible"] is False
        assert data["reveal_via"] == "atlas-toggle-menu"
        assert data["menu"]["haspopup"] == "true"
        assert data["landmark"] == "nav"
        assert data["breadcrumb"] == ["Home", "Citizen Services", "Traffic"]

        restored = DomNode.model_validate(data)
        assert restored.visible is False
        assert restored.reveal_via == "atlas-toggle-menu"
        assert restored.menu.haspopup == "true"
        assert restored.landmark == "nav"
        assert restored.breadcrumb == ["Home", "Citizen Services", "Traffic"]

        # Default values check
        bare_node = DomNode(tag="button")
        assert bare_node.visible is True
        assert bare_node.reveal_via is None
        assert bare_node.menu is None
        assert bare_node.landmark is None
        assert bare_node.breadcrumb is None

    def test_dom_node_landmark_validation(self):
        """Validates landmark enum restrictions."""
        for lm in ["header", "nav", "main", "footer", "aside"]:
            n = DomNode(tag="div", landmark=lm)
            assert n.landmark == lm

        with pytest.raises(ValidationError):
            DomNode(tag="div", landmark="sidebar")

    def test_input_field_and_user_input_request_v3(self):
        """Validates InputField and multi-field UserInputRequest v3."""
        f1 = InputField(
            ref="el_nat_id",
            label="National ID",
            kind="number",
            sensitive=False,
            pattern=r"^\d{14}$",
            maxlength=14,
            required=True,
        )
        f2 = InputField(
            ref="el_plate_chars",
            label="Plate Letters",
            kind="text",
            sensitive=False,
            maxlength=3,
            required=True,
        )
        f3 = InputField(
            ref="el_gov",
            label="Governorate",
            kind="select",
            options=["Cairo", "Giza", "Alexandria"],
        )
        f4 = InputField(
            ref="el_pwd",
            label="Portal Password",
            kind="password",
            sensitive=True,
        )

        assert f3.kind == "select"
        assert f3.sensitive is False
        assert f3.required is True
        assert f3.options == ["Cairo", "Giza", "Alexandria"]

        req = UserInputRequest(
            kind="missing_field",
            prompt="Please provide vehicle and identification details",
            fields=[f1, f2, f3, f4],
        )
        dumped = req.model_dump()
        assert len(dumped["fields"]) == 4
        assert dumped["fields"][0]["ref"] == "el_nat_id"
        assert dumped["fields"][3]["sensitive"] is True

        reloaded = UserInputRequest.model_validate(dumped)
        assert len(reloaded.fields) == 4
        assert reloaded.fields[2].options == ["Cairo", "Giza", "Alexandria"]

    def test_input_field_kind_literals_and_validation(self):
        """Validates all permitted InputField kind literals."""
        valid_kinds = ["text", "number", "select", "date", "phone", "email", "password", "otp", "other"]
        for k in valid_kinds:
            f = InputField(ref="f", kind=k)
            assert f.kind == k

        with pytest.raises(ValidationError):
            InputField(ref="f", kind="unsupported_kind")

    def test_user_input_request_v2_backward_compatibility(self):
        """Validates that v2 single-field UserInputRequest works with empty fields list."""
        legacy = UserInputRequest(
            kind="otp",
            prompt="Enter SMS code",
            field_ref="el_otp",
            resumable=True,
        )
        assert legacy.kind == "otp"
        assert legacy.fields == []

    def test_goal_step_request_user_inputs_roundtrip(self):
        """Validates GoalStepRequest user_inputs mapping and contract_version=3."""
        inputs = {
            "el_nat_id": "00000000000000",
            "el_plate": "123-ABC",
            "el_pwd": "{vault.portal_password}",
        }
        req = GoalStepRequest(
            goal="Inquire vehicle violations",
            current_url="https://example.com/violations",
            user_inputs=inputs,
            contract_version=3,
        )
        assert req.user_inputs == inputs
        assert req.contract_version == 3

        dumped = req.model_dump()
        assert dumped["user_inputs"] == inputs
        restored = GoalStepRequest.model_validate(dumped)
        assert restored.user_inputs == inputs
        assert restored.contract_version == 3

        # Default is None
        default_req = GoalStepRequest(
            goal="Default test",
            current_url="https://example.com",
        )
        assert default_req.user_inputs is None
        assert default_req.contract_version == 2

    def test_goal_step_response_v3_contract_version(self):
        """Validates GoalStepResponse supports contract_version=3."""
        state = GoalState(goal="Test v3")
        resp = GoalStepResponse(
            status="in_progress",
            goal_state=state,
            reply="Navigating to violations page",
            contract_version=3,
            steps=[PlanStep(action="reveal", element_id="atlas-toggle", reason="reveal_menu")],
        )
        assert resp.contract_version == 3
        assert resp.steps[0].action == "reveal"
        assert resp.steps[0].reason == "reveal_menu"

    def test_chat_request_language_and_length_bounds(self):
        """Validates ChatRequest language field with max_length=32 constraint."""
        req = ChatRequest(
            url="https://example.com",
            question="أين أجد مخالفات المرور؟",
            language="ar-EG",
        )
        assert req.language == "ar-EG"

        # Default is None
        bare_req = ChatRequest(url="https://example.com", question="Hello")
        assert bare_req.language is None

        # Exceeding 32 chars raises ValidationError
        with pytest.raises(ValidationError):
            ChatRequest(
                url="https://example.com",
                question="Hello",
                language="a" * 33,
            )

    def test_chat_response_intent_route_and_goal_state(self):
        """Validates ChatResponse intent_route and seed goal_state."""
        state = GoalState(goal="Pay traffic fine")
        resp = ChatResponse(
            status="ok",
            answer="سأساعدك في سداد الغرامة",
            intent_route="goal",
            goal_state=state,
        )
        assert resp.intent_route == "goal"
        assert resp.goal_state is not None
        assert resp.goal_state.goal == "Pay traffic fine"

        # Valid routes: direct, question, goal
        for route in ["direct", "question", "goal"]:
            r = ChatResponse(status="ok", answer="test", intent_route=route)
            assert r.intent_route == route

        # Invalid route raises ValidationError
        with pytest.raises(ValidationError):
            ChatResponse(status="ok", answer="test", intent_route="unsupported")

        # Defaults to None
        default_resp = ChatResponse(status="ok", answer="test")
        assert default_resp.intent_route is None
        assert default_resp.goal_state is None

    def test_chat_route_endpoint_accepts_language_no_422(self):
        """Validates that POST /v1/chat endpoint accepts language='ar-EG' with no 422 error."""
        from app.main import app
        from app.db.connection import get_db

        demo_key = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

        async def override_get_db():
            mock_db = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = MagicMock()
            mock_db.execute = AsyncMock(return_value=mock_result)
            mock_db.add = MagicMock()
            mock_db.commit = AsyncMock()
            mock_db.refresh = AsyncMock()
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db

        try:
            with patch("app.db.connection.validate_api_key", new=AsyncMock(side_effect=lambda db, k: k == demo_key)), \
                 patch("app.agent.llm_client.ping_llm", new=AsyncMock(return_value=True)), \
                 patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value="مرحبا بك في خدمات المرور")):
                with TestClient(app) as client:
                    resp = client.post(
                        "/v1/chat",
                        headers={"X-Atlas-Key": demo_key},
                        json={
                            "url": "https://example.com/portal",
                            "question": "كيف استعلم عن المخالفات؟",
                            "language": "ar-EG",
                        },
                    )
                    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
                    data = resp.json()
                    assert data["status"] == "ok"
                    assert "مرحبا" in data["answer"]
        finally:
            app.dependency_overrides.clear()


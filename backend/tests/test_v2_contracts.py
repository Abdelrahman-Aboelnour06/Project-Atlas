"""
Unit Tests for Atlas v2 Contracts (Track 0)
backend/tests/test_v2_contracts.py
"""

import pytest
from app.models.action import ActionType
from app.models.dom import DomNode, SelectOption
from app.models.goal import (
    Branch,
    Budget,
    FieldPlan,
    FormPlan,
    GoalState,
    Milestone,
    PlanStep,
    UserInputRequest,
)


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

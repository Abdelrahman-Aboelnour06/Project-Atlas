"""
Unit & Integration Tests for Multi-Step Goal Contracts & Mock LLM Provider
backend/tests/test_goal_contracts.py

Verifies:
1. Pydantic v2 schemas: PlanStep, AgenticPlan, Milestone, VerifierResult, GoalState, GoalStepRequest, GoalStepResponse
2. Serialization, deserialization, validation errors, and helper methods on GoalState
3. Backward-compatible re-exports from app.agent.agentic_planner and app.models
4. Deterministic Mock LLM Provider: zero-network ping_llm, canned queue, history tracking, role routing, and generators
"""

import json
import os
import pytest
from unittest.mock import AsyncMock, patch
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
)
import app.models as models_pkg
from app.agent import agentic_planner
from app.agent import llm_client
from app.agent.llm_client import (
    call_llm,
    ping_llm,
    get_model_for_role,
    set_mock_llm_queue,
    set_mock_llm_response,
    get_mock_llm_history,
    clear_mock_llm,
)


# ── Test Suite 1: Contract Serialization & Behavior ────────────────────────────

class TestGoalContractsSerialization:
    def test_plan_step_validation_and_defaults(self):
        # Valid actions
        for action in ("click", "open", "double_click", "fill", "scroll", "focus"):
            step = PlanStep(action=action, element_id="atlas-001")
            assert step.action == action
            assert step.element_id == "atlas-001"
            assert step.delay_ms == 600
            assert step.description == ""
            assert step.value is None

        # Invalid action raises ValidationError
        with pytest.raises(ValidationError):
            PlanStep(action="invalid_hover", element_id="atlas-001")

        # Optional element_id (e.g. for general scroll action)
        scroll_step = PlanStep(action="scroll", element_id=None)
        assert scroll_step.element_id is None

    def test_agentic_plan_roundtrip(self):
        step = PlanStep(action="click", element_id="atlas-005", description="Click submit")
        plan = AgenticPlan(
            type="plan",
            thought="Submit form",
            reply="Submitting your form now.",
            steps=[step],
            requires_confirmation=False,
        )
        data = plan.model_dump()
        assert data["type"] == "plan"
        assert len(data["steps"]) == 1
        assert data["steps"][0]["element_id"] == "atlas-005"

        # Roundtrip JSON
        json_str = plan.model_dump_json()
        restored = AgenticPlan.model_validate_json(json_str)
        assert restored.reply == plan.reply
        assert len(restored.steps) == 1
        assert restored.steps[0].action == "click"

    def test_milestone_defaults_and_roundtrip(self):
        m = Milestone(description="Navigate to search results")
        assert m.id == "m-0"
        assert m.status == "active"
        assert m.steps == []
        assert m.target_url is None

        # Full milestone with steps
        step = PlanStep(action="fill", element_id="atlas-010", value="laptop")
        m2 = Milestone(
            id="m-1",
            description="Enter search query",
            status="completed",
            target_url="https://example.com/search?q=laptop",
            success_criteria="Search results container rendered",
            steps=[step],
            notes="Heuristic matched input box",
        )
        json_data = json.loads(m2.model_dump_json())
        restored = Milestone.model_validate(json_data)
        assert restored.id == "m-1"
        assert restored.status == "completed"
        assert restored.steps[0].value == "laptop"
        assert restored.notes == "Heuristic matched input box"

    def test_verifier_result_model(self):
        vr = VerifierResult(
            status="goal_complete",
            reason="Checkout confirmation message displayed on DOM",
            confidence=0.98,
            signals_detected=["url_changed", "element_disappeared:atlas-001"],
            verification_method="rules",
        )
        assert vr.status == "goal_complete"
        assert vr.confidence == 0.98
        assert len(vr.signals_detected) == 2
        assert vr.verification_method == "rules"

        # Confidence bounds validation
        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="test", confidence=1.5)

        with pytest.raises(ValidationError):
            VerifierResult(status="in_progress", reason="test", confidence=-0.1)

        # Status validation
        with pytest.raises(ValidationError):
            VerifierResult(status="unknown_status", reason="test")

    def test_goal_state_helper_methods(self):
        state = GoalState(goal="Search and buy headphones")
        assert state.hop_count == 0
        assert state.max_hops == 8
        assert state.status == "in_progress"
        assert not state.is_terminal()
        assert not state.exceeded_max_hops()
        assert state.get_active_milestone() is None

        # Test active milestone resolution
        m1 = Milestone(id="m-0", description="First step", status="completed")
        m2 = Milestone(id="m-1", description="Second step", status="active")
        state.milestones = [m1, m2]
        state.active_milestone_id = "m-1"
        assert state.get_active_milestone().id == "m-1"

        # Advance hops under max_hops
        for i in range(1, 8):
            state.advance_hop()
            assert state.hop_count == i
            assert state.status == "in_progress"
            assert not state.is_terminal()

        # 8th hop reaches max_hops -> safety cutoff triggers goal_failed
        state.advance_hop()
        assert state.hop_count == 8
        assert state.exceeded_max_hops()
        assert state.is_terminal()
        assert state.status == "goal_failed"
        assert "maximum allowed hops limit" in state.error_message

        # If goal_complete, advance_hop does not overwrite status
        completed_state = GoalState(goal="Test goal", status="goal_complete", hop_count=7, max_hops=8)
        completed_state.advance_hop()
        assert completed_state.status == "goal_complete"
        assert completed_state.is_terminal()

    def test_goal_step_request_response_roundtrip(self):
        node = DomNode(
            id="atlas-001",
            tag="button",
            type="button",
            inner_text="Search",
            placeholder=None,
            aria_label="Search button",
            href=None,
            name="btn-search",
            role="button",
            resolved_label="Search",
        )
        req = GoalStepRequest(
            goal="Search for shoes",
            current_url="https://shop.example.com",
            dom_map=[node],
            page_text="Welcome to the store. Best shoes in town.",
            session_id="sess-12345",
        )
        req_json = req.model_dump_json()
        restored_req = GoalStepRequest.model_validate_json(req_json)
        assert restored_req.goal == "Search for shoes"
        assert len(restored_req.dom_map) == 1
        assert restored_req.dom_map[0].id == "atlas-001"

        # Build response
        step = PlanStep(action="click", element_id="atlas-001", description="Click search")
        resp = GoalStepResponse(
            status="in_progress",
            goal_state=GoalState(goal="Search for shoes", hop_count=1),
            reply="Clicking the search button for you.",
            steps=[step],
            plan=AgenticPlan(reply="Clicking search", steps=[step]),
            verifier_result=VerifierResult(status="in_progress", reason="Step initiated"),
        )
        resp_json = resp.model_dump_json()
        restored_resp = GoalStepResponse.model_validate_json(resp_json)
        assert restored_resp.status == "in_progress"
        assert restored_resp.goal_state.hop_count == 1
        assert len(restored_resp.steps) == 1
        assert restored_resp.steps[0].action == "click"

    def test_backward_compatibility_agentic_planner_exports(self):
        # PlanStep and AgenticPlan in app.agent.agentic_planner must be the same classes as in app.models.goal
        assert agentic_planner.PlanStep is PlanStep
        assert agentic_planner.AgenticPlan is AgenticPlan

    def test_models_package_reexports(self):
        # Everything re-exported from app.models package
        assert getattr(models_pkg, "PlanStep") is PlanStep
        assert getattr(models_pkg, "AgenticPlan") is AgenticPlan
        assert getattr(models_pkg, "Milestone") is Milestone
        assert getattr(models_pkg, "VerifierResult") is VerifierResult
        assert getattr(models_pkg, "GoalState") is GoalState
        assert getattr(models_pkg, "GoalStepRequest") is GoalStepRequest
        assert getattr(models_pkg, "GoalStepResponse") is GoalStepResponse
        assert getattr(models_pkg, "DomNode") is DomNode
        assert getattr(models_pkg, "ActionType") is ActionType


# ── Test Suite 2: Deterministic Mock LLM Provider ─────────────────────────────

class TestMockLLMProvider:
    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        clear_mock_llm()
        yield
        clear_mock_llm()

    @pytest.mark.asyncio
    async def test_ping_llm_mock_returns_true_with_zero_network(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"), \
             patch("httpx.AsyncClient.get", side_effect=RuntimeError("Network must not be called!")):
            ok = await ping_llm()
            assert ok is True

    @pytest.mark.asyncio
    async def test_mock_canned_queue_fifo(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            set_mock_llm_queue(["first response", "second response"])
            r1 = await call_llm("Prompt 1")
            r2 = await call_llm("Prompt 2")
            assert r1 == "first response"
            assert r2 == "second response"

            # Queue empty: falls back to deterministic generator
            r3 = await call_llm("Tell me a summary of this site", role="summary")
            assert "summary" in r3.lower()

    def test_mock_set_single_response(self):
        set_mock_llm_response("single canned item")
        assert llm_client._mock_canned_queue == ["single canned item"]

    @pytest.mark.asyncio
    async def test_mock_history_tracking(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            await call_llm(
                user_prompt="Find the button",
                system_prompt="Accessibility assistant",
                reasoning=True,
                role="navigator",
                model="test-custom-model",
            )
            history = get_mock_llm_history()
            assert len(history) == 1
            call = history[0]
            assert call["user_prompt"] == "Find the button"
            assert call["system_prompt"] == "Accessibility assistant"
            assert call["reasoning"] is True
            assert call["role"] == "navigator"
            assert call["model"] == "test-custom-model"

            clear_mock_llm()
            assert len(get_mock_llm_history()) == 0

    @pytest.mark.asyncio
    async def test_mock_deterministic_navigator_uses_real_element_ids(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = """
AUTHENTIC USER COMMAND: click checkout
CURRENT INTERACTIVE DOM ELEMENTS:
[{"id": "atlas-042", "label": "Proceed to Checkout"}]
"""
            raw = await call_llm(prompt, role="navigator")
            plan_data = json.loads(raw)
            plan = AgenticPlan.model_validate(plan_data)
            assert plan.type == "plan"
            assert len(plan.steps) >= 1
            assert plan.steps[0].action == "click"
            assert plan.steps[0].element_id == "atlas-042"
            assert plan.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_mock_deterministic_navigator_consequential_confirmation(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = """
AUTHENTIC USER COMMAND: delete my account and purchase items
CURRENT INTERACTIVE DOM ELEMENTS:
[{"id": "atlas-099", "label": "Delete Account"}]
"""
            raw = await call_llm(prompt, role="navigator")
            plan_data = json.loads(raw)
            plan = AgenticPlan.model_validate(plan_data)
            assert plan.type == "confirmation"
            assert plan.requires_confirmation is True
            assert plan.confirmation_prompt is not None
            assert plan.pending_step is not None
            assert plan.pending_step.element_id == "atlas-099"

    @pytest.mark.asyncio
    async def test_mock_deterministic_verifier_outcomes(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            # 1. Goal complete
            raw_complete = await call_llm("Observed signals: order placed, checkout complete", role="verifier")
            vr_complete = VerifierResult.model_validate_json(raw_complete)
            assert vr_complete.status == "goal_complete"
            assert vr_complete.confidence == 1.0

            # 2. Goal failed on unexpected / error
            raw_fail = await call_llm("Observed signals: unexpected error timeout", role="verifier")
            vr_fail = VerifierResult.model_validate_json(raw_fail)
            assert vr_fail.status == "goal_failed"

            # 3. In progress
            raw_progress = await call_llm("Action executed, in progress continue", role="verifier")
            vr_progress = VerifierResult.model_validate_json(raw_progress)
            assert vr_progress.status == "in_progress"

            # 4. Milestone complete
            raw_ms = await call_llm("Page navigated successfully", role="verifier")
            vr_ms = VerifierResult.model_validate_json(raw_ms)
            assert vr_ms.status == "milestone_complete"

    @pytest.mark.asyncio
    async def test_mock_deterministic_planner(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Create plan for milestone", role="planner")
            data = json.loads(raw)
            assert "milestones" in data
            assert len(data["milestones"]) >= 1
            assert data["milestones"][0]["id"] == "m-0"

    def test_per_role_model_resolution(self):
        # 1. Direct model override takes priority
        assert get_model_for_role(model="custom-override-model") == "custom-override-model"
        assert get_model_for_role(model_override="custom-override-model-2") == "custom-override-model-2"

        # 2. Defaults match LLM_MODEL when no role model set (unmasked fallback)
        with patch("app.agent.llm_client.LLM_MODEL", "base-llama-model"):
            assert get_model_for_role() == "base-llama-model"
            assert get_model_for_role(role="planner") == "base-llama-model"
            assert get_model_for_role(role="navigator") == "base-llama-model"
            assert get_model_for_role(role="verifier") == "base-llama-model"

        # 3. Unmasked fallback via os.environ:
        with patch.dict("os.environ", {"LLM_MODEL": "env-fallback-model"}, clear=False):
            os.environ.pop("PLANNER_LLM_MODEL", None)
            assert get_model_for_role(role="planner") == "env-fallback-model"

        # 4. Role-specific configuration via globals patch
        with patch("app.agent.llm_client.PLANNER_LLM_MODEL", "planner-llama-model"), \
             patch("app.agent.llm_client.NAVIGATOR_LLM_MODEL", "navigator-qwen-model"), \
             patch("app.agent.llm_client.VERIFIER_LLM_MODEL", "verifier-nemotron-model"):
            assert get_model_for_role(role="planner") == "planner-llama-model"
            assert get_model_for_role(role="navigator") == "navigator-qwen-model"
            assert get_model_for_role(role="verifier") == "verifier-nemotron-model"

        # 5. Role-specific configuration via environment variable
        with patch.dict("os.environ", {"PLANNER_LLM_MODEL": "env-planner-model"}):
            assert get_model_for_role(role="planner") == "env-planner-model"

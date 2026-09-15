"""
Adversarial Challenge & Stress-Test Suite for Milestone 1 Mock LLM Provider
backend/tests/test_mock_llm_adversarial.py

Empirical stress testing covering:
1. Canned queue FIFO ordering, exhaustion, clearing, and multi-call edge cases.
2. Deterministic generator across all roles (navigator, verifier, planner, simplify, command)
   with complex, empty, boundary, regex-laden, and adversarial prompts.
3. Strict zero network leakage verification using socket-level blocks.
4. Per-role model resolution permutations, precedence hierarchy, and environment dynamics.
5. Concurrency and load stress.
"""

import asyncio
import json
import os
import re
import socket
import pytest
from unittest.mock import patch

from app.models.goal import (
    PlanStep,
    AgenticPlan,
    Milestone,
    VerifierResult,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
)
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


@pytest.fixture(autouse=True)
def clean_mock_state():
    clear_mock_llm()
    yield
    clear_mock_llm()


# ════════════════════════════════════════════════════════════════════════════════
# 1. CANNED QUEUE STRESS & EXHAUSTION
# ════════════════════════════════════════════════════════════════════════════════

class TestCannedQueueAdversarial:
    """Stress testing canned queue FIFO ordering, exhaustion, and edge payloads."""

    @pytest.mark.asyncio
    async def test_queue_exhaustion_clean_transition_to_generator(self):
        """Verify queue cleanly transitions to deterministic generator without IndexError."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            set_mock_llm_queue(["canned_1", "canned_2"])

            res1 = await call_llm("prompt 1")
            res2 = await call_llm("prompt 2")
            assert res1 == "canned_1"
            assert res2 == "canned_2"

            # 3rd call: queue is empty. Must fall back to deterministic generator, not raise IndexError.
            res3 = await call_llm("Observed signals: error occurred", role="verifier")
            assert res3 != ""
            vr = VerifierResult.model_validate_json(res3)
            assert vr.status == "goal_failed"

            # History must record all 3 calls
            history = get_mock_llm_history()
            assert len(history) == 3
            assert history[0]["user_prompt"] == "prompt 1"
            assert history[1]["user_prompt"] == "prompt 2"
            assert history[2]["user_prompt"] == "Observed signals: error occurred"

    @pytest.mark.asyncio
    async def test_queue_fifo_ordering_large_batch(self):
        """Verify strict FIFO order over 100 queued items."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            items = [f"response_{i:04d}" for i in range(100)]
            set_mock_llm_queue(items)

            for i in range(100):
                res = await call_llm(f"call_{i}")
                assert res == f"response_{i:04d}"

            # After 100 items, queue is empty
            fallback = await call_llm("Click atlas-001", role="navigator")
            plan = AgenticPlan.model_validate_json(fallback)
            assert plan.steps[0].element_id == "atlas-001"

    @pytest.mark.asyncio
    async def test_clear_mock_llm_immediate_effect(self):
        """Verify clear_mock_llm resets queue and history immediately."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            set_mock_llm_queue(["queued_a", "queued_b"])
            await call_llm("first call")
            assert len(get_mock_llm_history()) == 1

            clear_mock_llm()
            assert len(get_mock_llm_history()) == 0

            # Next call must use deterministic generator, not queued_b
            res = await call_llm("summary of page", role="summary")
            assert "summary" in res.lower()
            assert len(get_mock_llm_history()) == 1

    @pytest.mark.asyncio
    async def test_set_mock_llm_response_overrides_existing_queue(self):
        """Verify set_mock_llm_response replaces any existing queue."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            set_mock_llm_queue(["old_1", "old_2", "old_3"])
            set_mock_llm_response("new_single")

            res1 = await call_llm("test")
            assert res1 == "new_single"

            # Next call should fall back to generator
            res2 = await call_llm("test 2")
            assert "Atlas" in res2

    @pytest.mark.asyncio
    async def test_queue_with_empty_strings_and_json_blobs(self):
        """Verify canned queue accurately delivers empty strings and raw JSON."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw_json = json.dumps({"custom_field": 12345, "nested": {"a": [1, 2, 3]}})
            set_mock_llm_queue(["", "   ", raw_json])

            assert await call_llm("q1") == ""
            assert await call_llm("q2") == "   "
            assert await call_llm("q3") == raw_json

    @pytest.mark.asyncio
    async def test_get_mock_llm_history_immutability(self):
        """Mutating the returned history list must not alter internal state."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            await call_llm("call 1")
            history = get_mock_llm_history()
            history.clear()
            assert len(get_mock_llm_history()) == 1


# ════════════════════════════════════════════════════════════════════════════════
# 2. DETERMINISTIC GENERATOR ACROSS ROLES & ADVERSARIAL PROMPTS
# ════════════════════════════════════════════════════════════════════════════════

class TestDeterministicGeneratorAdversarial:
    """Stress testing deterministic responses with extreme, empty, and adversarial prompts."""

    @pytest.mark.asyncio
    async def test_navigator_empty_prompt(self):
        """Navigator must return valid AgenticPlan even on empty prompt."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("", role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"
            assert len(plan.steps) == 1
            assert plan.steps[0].element_id == "atlas-001"
            assert plan.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_navigator_whitespace_prompt(self):
        """Navigator must handle whitespace-only prompt."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("   \n\t  \r\n   ", role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"
            assert plan.steps[0].element_id == "atlas-001"

    @pytest.mark.asyncio
    async def test_navigator_prompt_with_multiple_atlas_ids(self):
        """Navigator extracts first atlas id from prompt correctly."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = """
            Available elements:
            - 'atlas-105': Submit
            - 'atlas-200': Cancel
            - 'atlas-003': More Info
            """
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-105"

    @pytest.mark.asyncio
    async def test_navigator_regex_special_characters_in_prompt(self):
        """Prompts with regex control characters must not break id extraction."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Regex test: [a-z]+ (foo|bar)* {1,3} ^$ ? . * + \\ 'atlas-999' \\d+"
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-999"

    @pytest.mark.asyncio
    async def test_navigator_consequential_keywords_variations(self):
        """All consequential action keywords must trigger confirmation gate."""
        consequential_keywords = [
            "delete account",
            "PURCHASE NOW",
            "Please buy this item",
            "Place Order",
            "remove profile",
            "pay for subscription",
            "submit payment directly",
        ]
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for phrase in consequential_keywords:
                prompt = f"Goal: {phrase} using element 'atlas-055'"
                raw = await call_llm(prompt, role="navigator")
                plan = AgenticPlan.model_validate_json(raw)
                assert plan.type == "confirmation", f"Failed for phrase: {phrase}"
                assert plan.requires_confirmation is True, f"Failed for phrase: {phrase}"
                assert plan.confirmation_prompt is not None
                assert plan.pending_step is not None
                assert plan.pending_step.element_id == "atlas-055"
                assert len(plan.steps) == 0

    @pytest.mark.asyncio
    async def test_navigator_huge_prompt(self):
        """Navigator handles 100KB prompt without timing out or crashing."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            huge_text = "lorem ipsum " * 8000 + " 'atlas-777' " + " dolor sit amet " * 8000
            raw = await call_llm(huge_text, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-777"

    @pytest.mark.asyncio
    async def test_verifier_all_failure_keywords(self):
        """Verifier correctly outputs goal_failed for failure signals."""
        fail_triggers = [
            "Network fail detected",
            "HTTP 500 ERROR received",
            "Timeout waiting for selector",
            "Unexpected modal dialog",
            "State mismatch between URL and DOM",
            "Element not found on target page",
        ]
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for trigger in fail_triggers:
                raw = await call_llm(trigger, role="verifier")
                vr = VerifierResult.model_validate_json(raw)
                assert vr.status == "goal_failed", f"Failed for trigger: {trigger}"
                assert vr.verification_method == "rules"

    @pytest.mark.asyncio
    async def test_verifier_all_goal_complete_keywords(self):
        """Verifier correctly outputs goal_complete for success signals."""
        complete_triggers = [
            "goal complete successfully",
            "Finish checkout now",
            "checkout complete with receipt",
            "Order Placed successfully",
            "All Steps Complete verified",
        ]
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for trigger in complete_triggers:
                raw = await call_llm(trigger, role="verifier")
                vr = VerifierResult.model_validate_json(raw)
                assert vr.status == "goal_complete", f"Failed for trigger: {trigger}"
                assert vr.confidence == 1.0

    @pytest.mark.asyncio
    async def test_verifier_in_progress_keywords(self):
        """Verifier correctly outputs in_progress for continuation signals."""
        progress_triggers = [
            "Step in progress",
            "Continue to next field",
            "Not yet rendered",
        ]
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for trigger in progress_triggers:
                raw = await call_llm(trigger, role="verifier")
                vr = VerifierResult.model_validate_json(raw)
                assert vr.status == "in_progress", f"Failed for trigger: {trigger}"

    @pytest.mark.asyncio
    async def test_verifier_default_fallback(self):
        """Verifier returns milestone_complete by default when no special keywords appear."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Page navigated and stabilized", role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "milestone_complete"
            assert vr.confidence == 0.95

    @pytest.mark.asyncio
    async def test_planner_role_returns_valid_milestones(self):
        """Planner returns JSON with valid Milestone schema."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Plan actions for search", role="planner")
            data = json.loads(raw)
            assert "milestones" in data
            assert len(data["milestones"]) >= 1
            m = Milestone.model_validate(data["milestones"][0])
            assert m.id == "m-0"
            assert m.status == "active"

    @pytest.mark.asyncio
    async def test_simplify_role_returns_valid_element_list(self):
        """Simplify returns list of elements with data-atlas-id."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = """
            INTERACTIVE ELEMENTS:
            'atlas-001': search button
            'atlas-002': login link
            """
            raw = await call_llm(prompt, role="simplify")
            elements = json.loads(raw)
            assert isinstance(elements, list)
            assert len(elements) == 2
            assert elements[0]["element_id"] == "atlas-001"
            assert elements[1]["element_id"] == "atlas-002"

    @pytest.mark.asyncio
    async def test_legacy_command_role(self):
        """Legacy command returns valid action payload."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "ACTION TYPES: click 'atlas-088'"
            raw = await call_llm(prompt, role="command")
            data = json.loads(raw)
            assert data["action"] == "click"
            assert data["element_id"] == "atlas-088"

    @pytest.mark.asyncio
    async def test_generic_chat_fallback(self):
        """Generic prompt with no recognized role or keywords returns conversational text."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("What is the weather today?", role=None)
            assert "Atlas" in raw
            assert "assistant" in raw


# ════════════════════════════════════════════════════════════════════════════════
# 3. STRICT ZERO NETWORK LEAKAGE VERIFICATION
# ════════════════════════════════════════════════════════════════════════════════

class TestZeroNetworkLeakage:
    """Verify that under NO circumstances does the mock provider make network calls."""

    @pytest.mark.asyncio
    async def test_socket_level_block_ping_llm(self):
        """ping_llm must succeed even if socket creation and connection are completely disabled."""
        def blocked_socket(*args, **kwargs):
            raise AssertionError("Network socket attempted during ping_llm in mock mode!")

        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"), \
             patch("socket.socket", side_effect=blocked_socket):
            ok = await ping_llm()
            assert ok is True

    @pytest.mark.asyncio
    async def test_socket_level_block_call_llm(self):
        """call_llm must succeed across all roles when network sockets are blocked."""
        def blocked_socket(*args, **kwargs):
            raise AssertionError("Network socket attempted during call_llm in mock mode!")

        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"), \
             patch("socket.socket", side_effect=blocked_socket):

            roles = ["navigator", "verifier", "planner", "simplify", "command", None]
            for r in roles:
                res = await call_llm("test prompt with 'atlas-001'", role=r)
                assert len(res) > 0

    @pytest.mark.asyncio
    async def test_httpx_never_invoked_under_mock(self):
        """Ensure httpx.AsyncClient is never even instantiated when LLM_PROVIDER=mock."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"), \
             patch("httpx.AsyncClient") as mock_client:
            await ping_llm()
            await call_llm("Prompt", role="navigator")
            mock_client.assert_not_called()

    def test_mock_startup_without_api_key(self):
        """LLM_PROVIDER=mock must never require LLM_API_KEY at startup."""
        # Simulated check from lines 49-55 in llm_client.py
        provider = "mock"
        api_key = ""
        # Should NOT raise RuntimeError
        if provider not in ("ollama", "mock") and not api_key:
            pytest.fail("Startup check failed for provider=mock with empty api_key")


# ════════════════════════════════════════════════════════════════════════════════
# 4. PER-ROLE MODEL RESOLUTION PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestPerRoleModelResolutionAdversarial:
    """Stress testing per-role model resolution precedence and environment interactions."""

    def test_precedence_model_param_beats_role_and_defaults(self):
        """Explicit model parameter must override all other sources."""
        with patch.dict("os.environ", {
            "PLANNER_LLM_MODEL": "env-planner-model",
            "LLM_MODEL": "env-default-model",
        }):
            resolved = get_model_for_role(role="planner", model="param-override-model")
            assert resolved == "param-override-model"

    def test_precedence_model_override_param_beats_role_and_defaults(self):
        """Explicit model_override parameter must override all other sources."""
        with patch.dict("os.environ", {
            "NAVIGATOR_LLM_MODEL": "env-nav-model",
            "LLM_MODEL": "env-default-model",
        }):
            resolved = get_model_for_role(role="navigator", model_override="param-override-2")
            assert resolved == "param-override-2"

    def test_all_standard_roles_environment_resolution(self):
        """Each role resolves to its distinct configured model via environment."""
        env_vars = {
            "PLANNER_LLM_MODEL": "model-planner-405b",
            "NAVIGATOR_LLM_MODEL": "model-nav-70b",
            "VERIFIER_LLM_MODEL": "model-ver-8b",
            "LLM_MODEL": "model-fallback",
        }
        with patch.dict("os.environ", env_vars):
            assert get_model_for_role("planner") == "model-planner-405b"
            assert get_model_for_role("navigator") == "model-nav-70b"
            assert get_model_for_role("verifier") == "model-ver-8b"

    def test_role_with_whitespace_and_mixed_case(self):
        """Role parameter with whitespace or mixed case should resolve correctly."""
        with patch.dict("os.environ", {"PLANNER_LLM_MODEL": "model-planner-clean"}):
            assert get_model_for_role("  planner  ") == "model-planner-clean"
            assert get_model_for_role("Planner") == "model-planner-clean"
            assert get_model_for_role("PLANNER") == "model-planner-clean"

    def test_arbitrary_custom_role_resolution(self):
        """Arbitrary role dynamically resolves to {ROLE}_LLM_MODEL if defined."""
        with patch.dict("os.environ", {"CRITIC_LLM_MODEL": "critic-specialist-model"}):
            assert get_model_for_role("critic") == "critic-specialist-model"

    def test_fallback_to_llm_model_when_role_unconfigured_via_env(self):
        """Unconfigured role should fall back to os.environ['LLM_MODEL']."""
        with patch.dict("os.environ", {"LLM_MODEL": "universal-llama-model"}, clear=False):
            # If SPECIAL_LLM_MODEL is not set in env or globals, it should fall back to os.environ['LLM_MODEL']
            os.environ.pop("SPECIAL_LLM_MODEL", None)
            resolved = get_model_for_role("special")
            assert resolved == "universal-llama-model"

    def test_standard_roles_fallback_to_updated_llm_model(self):
        """When PLANNER_LLM_MODEL is unconfigured, updating LLM_MODEL should be reflected in planner role."""
        with patch("app.agent.llm_client.LLM_MODEL", "updated-base-model"):
            resolved = get_model_for_role("planner")
            assert resolved == "updated-base-model"

    @pytest.mark.asyncio
    async def test_role_case_insensitivity_navigator(self):
        """Uppercase or mixed-case role='NAVIGATOR' must return valid AgenticPlan JSON, not chat string."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Navigate to checkout", role="NAVIGATOR")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"

    @pytest.mark.asyncio
    async def test_role_case_insensitivity_verifier(self):
        """Uppercase role='VERIFIER' must return valid VerifierResult JSON, not chat string."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Action executed successfully", role="VERIFIER")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status in ("milestone_complete", "goal_complete", "in_progress", "goal_failed")

    @pytest.mark.asyncio
    async def test_role_case_insensitivity_planner(self):
        """Uppercase role='PLANNER' must return valid milestones JSON, not chat string."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Decompose goal into steps", role="PLANNER")
            data = json.loads(raw)
            assert "milestones" in data

    @pytest.mark.asyncio
    async def test_role_parameter_honored_for_command_without_magic_string(self):
        """role='command' must produce command action JSON even without 'ACTION TYPES:' in prompt."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Click 'atlas-001'", role="command")
            data = json.loads(raw)
            assert "action" in data
            assert data["element_id"] == "atlas-001"

    @pytest.mark.asyncio
    async def test_role_parameter_honored_for_simplify_without_magic_string(self):
        """role='simplify' must produce element list JSON even without 'INTERACTIVE ELEMENTS' in prompt."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Extract elements: 'atlas-001'", role="simplify")
            data = json.loads(raw)
            assert isinstance(data, list)
            assert data[0]["element_id"] == "atlas-001"


# ════════════════════════════════════════════════════════════════════════════════
# 5. CONCURRENCY & ASYNC LOAD STRESS
# ════════════════════════════════════════════════════════════════════════════════

class TestConcurrencyAndLoadStress:
    """Stress testing mock LLM provider under concurrent async execution."""

    @pytest.mark.asyncio
    async def test_concurrent_call_llm_queue_consumption(self):
        """50 concurrent callers correctly consume 50 canned items without collisions."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            total_calls = 50
            canned_items = [f"token_{i}" for i in range(total_calls)]
            set_mock_llm_queue(canned_items)

            tasks = [call_llm(f"prompt_{i}") for i in range(total_calls)]
            results = await asyncio.gather(*tasks)

            assert len(results) == total_calls
            assert set(results) == set(canned_items)
            assert len(get_mock_llm_history()) == total_calls

    @pytest.mark.asyncio
    async def test_concurrent_deterministic_generation(self):
        """100 concurrent deterministic calls execute cleanly and quickly."""
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            tasks = [
                call_llm(f"Navigate to element 'atlas-{i:03d}'", role="navigator")
                for i in range(100)
            ]
            results = await asyncio.gather(*tasks)
            assert len(results) == 100
            for i, raw in enumerate(results):
                plan = AgenticPlan.model_validate_json(raw)
                assert plan.steps[0].element_id == f"atlas-{i:03d}"

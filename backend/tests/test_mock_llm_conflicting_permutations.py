"""
Empirical Challenge & Stress-Test Suite: Conflicting Keyword Injection Permutations
backend/tests/test_mock_llm_conflicting_permutations.py

Thoroughly exercises:
1. role=verifier receiving prompts with 'milestone', 'steps', 'simplify', 'action types'
2. role=planner receiving prompts with 'signals_detected', 'steps', 'action types', 'verifier'
3. role=simplify receiving prompts with 'milestone', 'verifier', 'steps', 'command'
4. role=command receiving prompts with 'milestone', 'verifier', 'simplify', 'steps'
5. role=navigator receiving prompts with 'milestone', 'verifier', 'simplify', 'signals_detected'
6. All roles subjected to a saturated conflicting keyword prompt simultaneously
7. Cross-injection between system_prompt and user_prompt
8. Role aliases and case variations under conflicting keyword injections
"""

import json
import pytest
from unittest.mock import patch

from app.models.goal import (
    AgenticPlan,
    Milestone,
    VerifierResult,
)
from app.agent.llm_client import (
    call_llm,
    clear_mock_llm,
)


@pytest.fixture(autouse=True)
def clean_mock_state():
    clear_mock_llm()
    yield
    clear_mock_llm()


# ════════════════════════════════════════════════════════════════════════════════
# 1. ROLE=VERIFIER CONFLICTING KEYWORD PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestVerifierConflictingKeywords:
    """Verify role='verifier' receives prompts with milestone, steps, simplify, etc."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "milestones",
        "steps",
        "step-by-step",
        "simplify",
        "interactive elements",
        "action types:",
        "authentic user command",
        "milestone steps simplify",
    ])
    async def test_verifier_isolated_from_foreign_keywords_default_outcome(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Evaluate current state with foreign keyword: {kw}. Element 'atlas-101' observed."
            raw = await call_llm(prompt, role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "milestone_complete"
            assert vr.verification_method == "rules"
            assert "dom_mutation_verified" in vr.signals_detected

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "steps",
        "simplify",
        "action types",
    ])
    async def test_verifier_isolated_from_foreign_keywords_with_failure_signal(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Verification check: error occurred during {kw} execution for 'atlas-002'"
            raw = await call_llm(prompt, role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "goal_failed"
            assert "state_mismatch" in vr.signals_detected

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "steps",
        "simplify",
    ])
    async def test_verifier_isolated_from_foreign_keywords_with_goal_complete(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Target goal complete after {kw} processing for 'atlas-003'"
            raw = await call_llm(prompt, role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "goal_complete"
            assert "url_match" in vr.signals_detected

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "steps",
        "simplify",
    ])
    async def test_verifier_isolated_from_foreign_keywords_with_in_progress(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Verification in progress for {kw} on 'atlas-004'"
            raw = await call_llm(prompt, role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "in_progress"

    @pytest.mark.asyncio
    async def test_verifier_casing_and_whitespace_with_conflicting_keywords(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for role_variant in ("verifier", "VERIFIER", " Verifier ", "\tverifier\n"):
                raw = await call_llm("milestone steps simplify", role=role_variant)
                vr = VerifierResult.model_validate_json(raw)
                assert vr.status == "milestone_complete"


# ════════════════════════════════════════════════════════════════════════════════
# 2. ROLE=PLANNER CONFLICTING KEYWORD PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestPlannerConflictingKeywords:
    """Verify role='planner' receives prompts with signals_detected, steps, action types, etc."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "signals_detected",
        "steps",
        "action types:",
        "post-action",
        "VERIFIER",
        "simplify",
        "authentic user command",
        "signals_detected steps action types",
    ])
    async def test_planner_isolated_from_foreign_keywords(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Decompose plan under conditions: {kw}. Target page element 'atlas-055'"
            raw = await call_llm(prompt, role="planner")
            data = json.loads(raw)
            assert "milestones" in data
            assert isinstance(data["milestones"], list)
            assert len(data["milestones"]) > 0
            # Validate against Pydantic Milestone model
            for m in data["milestones"]:
                validated = Milestone.model_validate(m)
                assert validated.id == "m-0"
                assert validated.status == "active"

    @pytest.mark.asyncio
    async def test_planner_casing_and_whitespace_with_conflicting_keywords(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for role_variant in ("planner", "PLANNER", " Planner ", "\tplanner\n"):
                raw = await call_llm("signals_detected steps action types", role=role_variant)
                data = json.loads(raw)
                assert "milestones" in data
                Milestone.model_validate(data["milestones"][0])


# ════════════════════════════════════════════════════════════════════════════════
# 3. ROLE=SIMPLIFY CONFLICTING KEYWORD PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestSimplifyConflictingKeywords:
    """Verify role='simplify' receives prompts with milestone, verifier, steps, etc."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "verifier",
        "steps",
        "signals_detected",
        "post-action",
        "action types:",
        "authentic user command",
        "milestone verifier steps",
    ])
    async def test_simplify_isolated_from_foreign_keywords(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Extract interactive elements with foreign terms {kw}: 'atlas-010', 'atlas-020'"
            raw = await call_llm(prompt, role="simplify")
            elements = json.loads(raw)
            assert isinstance(elements, list)
            assert len(elements) >= 2
            ids = [e["element_id"] for e in elements]
            assert "atlas-010" in ids
            assert "atlas-020" in ids
            for el in elements:
                assert "element_id" in el
                assert "label" in el
                assert "category" in el

    @pytest.mark.asyncio
    async def test_simplify_aliases_and_casing_with_conflicting_keywords(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for role_variant in ("simplify", "simplifier", "SIMPLIFY", " Simplifier ", "\tsimplify\n"):
                raw = await call_llm("milestone verifier steps 'atlas-077'", role=role_variant)
                elements = json.loads(raw)
                assert isinstance(elements, list)
                assert elements[0]["element_id"] == "atlas-077"


# ════════════════════════════════════════════════════════════════════════════════
# 4. ROLE=COMMAND CONFLICTING KEYWORD PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestCommandConflictingKeywords:
    """Verify role='command' receives prompts with milestone, verifier, simplify, etc."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "verifier",
        "simplify",
        "signals_detected",
        "post-action",
        "steps",
        "authentic user command",
        "milestone verifier simplify",
    ])
    async def test_command_isolated_from_foreign_keywords(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Parse user action mentioning {kw} on target 'atlas-088'"
            raw = await call_llm(prompt, role="command")
            cmd = json.loads(raw)
            assert isinstance(cmd, dict)
            assert cmd["action"] == "click"
            assert cmd["element_id"] == "atlas-088"
            assert "milestones" not in cmd
            assert "verification_method" not in cmd

    @pytest.mark.asyncio
    async def test_command_aliases_and_casing_with_conflicting_keywords(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for role_variant in ("command", "action", "parser", "COMMAND", "ACTION", "PARSER", " command "):
                raw = await call_llm("milestone verifier simplify 'atlas-099'", role=role_variant)
                cmd = json.loads(raw)
                assert isinstance(cmd, dict)
                assert cmd["element_id"] == "atlas-099"
                assert cmd["action"] == "click"


# ════════════════════════════════════════════════════════════════════════════════
# 5. ROLE=NAVIGATOR CONFLICTING KEYWORD PERMUTATIONS
# ════════════════════════════════════════════════════════════════════════════════

class TestNavigatorConflictingKeywords:
    """Verify role='navigator' receives prompts with milestone, verifier, simplify, etc."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kw", [
        "milestone",
        "verifier",
        "signals_detected",
        "post-action",
        "simplify",
        "action types:",
        "milestone verifier simplify signals_detected",
    ])
    async def test_navigator_isolated_from_foreign_keywords(self, kw):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = f"Navigate next step for {kw} clicking 'atlas-044'"
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"
            assert plan.steps[0].element_id == "atlas-044"
            assert plan.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_navigator_consequential_action_with_conflicting_keywords(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Delete account and cancel milestone with verifier post-action signals on 'atlas-099'"
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "confirmation"
            assert plan.requires_confirmation is True
            assert plan.pending_step is not None
            assert plan.pending_step.element_id == "atlas-099"

    @pytest.mark.asyncio
    async def test_navigator_aliases_and_casing(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            for role_variant in ("navigator", "navigation", "NAVIGATOR", " Navigation ", "\tnavigator\n"):
                raw = await call_llm("milestone verifier simplify 'atlas-012'", role=role_variant)
                plan = AgenticPlan.model_validate_json(raw)
                assert plan.steps[0].element_id == "atlas-012"


# ════════════════════════════════════════════════════════════════════════════════
# 6. ALL-IN-ONE CONFLICTING KEYWORD SATURATION STRESS TEST
# ════════════════════════════════════════════════════════════════════════════════

class TestAllKeywordsSaturationStress:
    """
    Constructs a prompt saturated with conflicting keywords from EVERY role:
    'milestone verifier signals_detected post-action steps simplify AUTHENTIC USER COMMAND ACTION TYPES: summary'
    and verifies that explicit role routing guarantees the correct schema for each role.
    """

    SATURATED_PROMPT = (
        "milestone milestones verifier signals_detected post-action steps "
        "simplify interactive elements AUTHENTIC USER COMMAND ACTION TYPES: "
        "summary 'atlas-777'"
    )

    @pytest.mark.asyncio
    async def test_verifier_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="verifier")
            vr = VerifierResult.model_validate_json(raw)
            assert vr.verification_method == "rules"
            assert vr.status == "milestone_complete"

    @pytest.mark.asyncio
    async def test_planner_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="planner")
            data = json.loads(raw)
            assert "milestones" in data
            Milestone.model_validate(data["milestones"][0])

    @pytest.mark.asyncio
    async def test_simplify_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="simplify")
            elements = json.loads(raw)
            assert isinstance(elements, list)
            assert elements[0]["element_id"] == "atlas-777"

    @pytest.mark.asyncio
    async def test_command_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="command")
            cmd = json.loads(raw)
            assert isinstance(cmd, dict)
            assert cmd["element_id"] == "atlas-777"

    @pytest.mark.asyncio
    async def test_navigator_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-777"

    @pytest.mark.asyncio
    async def test_summary_saturated_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(self.SATURATED_PROMPT, role="summary")
            assert "summary" in raw.lower()
            assert "{" not in raw


# ════════════════════════════════════════════════════════════════════════════════
# 7. SYSTEM PROMPT VS USER PROMPT CROSS-INJECTION
# ════════════════════════════════════════════════════════════════════════════════

class TestCrossInjectionSystemUserPrompts:
    """
    Verifies that conflicting keywords placed inside system_prompt do not
    override or hijack the explicit caller role.
    """

    @pytest.mark.asyncio
    async def test_verifier_with_planner_system_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(
                user_prompt="Observed 'atlas-001' on screen",
                system_prompt="You are a planner. Return milestones and plan steps.",
                role="verifier",
            )
            vr = VerifierResult.model_validate_json(raw)
            assert vr.status == "milestone_complete"

    @pytest.mark.asyncio
    async def test_planner_with_verifier_system_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(
                user_prompt="Goal: purchase shoes",
                system_prompt="You are VERIFIER. Evaluate post-action signals_detected.",
                role="planner",
            )
            data = json.loads(raw)
            assert "milestones" in data
            Milestone.model_validate(data["milestones"][0])

    @pytest.mark.asyncio
    async def test_simplify_with_navigator_system_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(
                user_prompt="Find buttons: 'atlas-005'",
                system_prompt="AUTHENTIC USER COMMAND with 'steps' and agentic execution",
                role="simplify",
            )
            elements = json.loads(raw)
            assert isinstance(elements, list)
            assert elements[0]["element_id"] == "atlas-005"

    @pytest.mark.asyncio
    async def test_command_with_milestone_system_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(
                user_prompt="Click element 'atlas-009'",
                system_prompt="Organize active milestone and decomposition steps",
                role="command",
            )
            cmd = json.loads(raw)
            assert isinstance(cmd, dict)
            assert cmd["element_id"] == "atlas-009"

    @pytest.mark.asyncio
    async def test_navigator_with_all_roles_system_prompt(self):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm(
                user_prompt="Proceed with 'atlas-050'",
                system_prompt="milestone verifier simplify signals_detected ACTION TYPES:",
                role="navigator",
            )
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-050"


# ════════════════════════════════════════════════════════════════════════════════
# 8. HEURISTIC FALLBACK WHEN ROLE IS NONE OR UNRECOGNIZED
# ════════════════════════════════════════════════════════════════════════════════

class TestHeuristicFallbackWhenRoleNoneOrUnrecognized:
    """
    Verifies that when role is None or an unrecognized string, the isolated
    heuristic prompt fallback correctly detects keywords and returns appropriate schemas.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_verifier(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("VERIFIER check signals_detected on 'atlas-001'", role=role_val)
            vr = VerifierResult.model_validate_json(raw)
            assert vr.verification_method == "rules"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_planner(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Decompose active milestone for shopping", role=role_val)
            data = json.loads(raw)
            assert "milestones" in data
            Milestone.model_validate(data["milestones"][0])

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_navigator(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("AUTHENTIC USER COMMAND: click 'atlas-022'", role=role_val)
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.steps[0].element_id == "atlas-022"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_simplify(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("INTERACTIVE ELEMENTS simplify 'atlas-033'", role=role_val)
            elements = json.loads(raw)
            assert isinstance(elements, list)
            assert elements[0]["element_id"] == "atlas-033"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_command(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("ACTION TYPES: click 'atlas-044'", role=role_val)
            cmd = json.loads(raw)
            assert isinstance(cmd, dict)
            assert cmd["element_id"] == "atlas-044"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_summary(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Give me a summary of this page", role=role_val)
            assert "summary" in raw.lower()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role_val", [None, "", "unknown_custom_role"])
    async def test_fallback_to_default_greeting(self, role_val):
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            raw = await call_llm("Hello, who are you?", role=role_val)
            assert "I am Atlas" in raw

"""
Role Precedence & Prompt Isolation Adversarial Test Suite
backend/tests/test_mock_llm_role_precedence.py

Demonstrates role hijacking defects in _generate_deterministic_mock_response:
When an explicit role ('navigator', 'planner', 'command', 'simplify') is specified,
presence of keywords belonging to other roles (e.g. 'milestone', 'post-action', 'VERIFIER')
in the user prompt, page text, or system prompt must NOT hijack the response schema.
"""

import pytest
from unittest.mock import patch

from app.models.goal import AgenticPlan, Milestone, VerifierResult
from app.agent.llm_client import call_llm, clear_mock_llm


@pytest.fixture(autouse=True)
def clean_mock():
    clear_mock_llm()
    yield
    clear_mock_llm()


class TestRolePrecedenceOverPromptKeywords:
    """Verifies that explicit role takes strict precedence over prompt keyword heuristics."""

    @pytest.mark.asyncio
    async def test_navigator_role_not_hijacked_by_milestone_keyword(self):
        """
        In Phase 1 / Milestone 2, Navigator resolves the active milestone against DOM.
        Prompts will naturally contain the word 'milestone'.
        Navigator MUST return an AgenticPlan, NOT planner milestones JSON.
        """
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Resolve active milestone: Complete checkout on page. Target element 'atlas-042'"
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"
            assert plan.steps[0].element_id == "atlas-042"

    @pytest.mark.asyncio
    async def test_navigator_role_not_hijacked_by_verifier_keywords(self):
        """
        If a webpage or goal references 'post-action' or 'VERIFIER',
        Navigator MUST return an AgenticPlan, NOT VerifierResult JSON.
        """
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Click the email verifier button 'atlas-011' for post-action confirmation"
            raw = await call_llm(prompt, role="navigator")
            plan = AgenticPlan.model_validate_json(raw)
            assert plan.type == "plan"
            assert plan.steps[0].element_id == "atlas-011"

    @pytest.mark.asyncio
    async def test_planner_role_not_hijacked_by_verifier_keywords(self):
        """
        If a planner prompt includes 'post-action' or 'signals_detected',
        Planner MUST return milestones JSON, NOT VerifierResult JSON.
        """
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Plan steps including post-action verification checkpoints"
            raw = await call_llm(prompt, role="planner")
            # Should deserialize into milestone structure, not verifier result
            assert "milestones" in raw
            assert "verification_method" not in raw

    @pytest.mark.asyncio
    async def test_command_role_not_hijacked_by_milestone_keyword(self):
        """
        If a command prompt mentions 'milestone',
        legacy command parser MUST return single action dict, NOT milestones JSON.
        """
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Click milestone button 'atlas-099'"
            raw = await call_llm(prompt, role="command")
            assert "action" in raw
            assert "milestones" not in raw

    @pytest.mark.asyncio
    async def test_simplify_role_not_hijacked_by_milestone_keyword(self):
        """
        If a simplify prompt mentions 'milestone',
        simplify flow MUST return elements list, NOT milestones JSON.
        """
        with patch("app.agent.llm_client.LLM_PROVIDER", "mock"):
            prompt = "Simplify milestone controls: 'atlas-001' and 'atlas-002'"
            raw = await call_llm(prompt, role="simplify")
            assert raw.startswith("[")
            assert "milestones" not in raw

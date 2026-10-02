"""
Tests for Verifier Quorum and Typed Rate-Limit Error
backend/tests/test_verifier_quorum.py
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.agent.llm_client import LLMRateLimited, get_model_for_role
from app.agent.verifier import consolidate, verify_quorum
from app.models.goal import Milestone, VerifierResult


def test_llm_rate_limited_exception():
    """LLMRateLimited is typed and carries retry_after and model attributes."""
    exc = LLMRateLimited("Rate limit exceeded", retry_after=3.5, model="llama-3.3-70b-versatile")
    assert isinstance(exc, Exception)
    assert exc.retry_after == 3.5
    assert exc.model == "llama-3.3-70b-versatile"


def test_verifier_alt_model_config():
    """VERIFIER_ALT_LLM_MODEL is resolved when role='verifier_alt'."""
    with patch.dict("os.environ", {"VERIFIER_ALT_LLM_MODEL": "qwen3.6-27b"}):
        model = get_model_for_role(role="verifier_alt")
        assert model == "qwen3.6-27b"


def test_consolidate_unanimous_goal_complete():
    """Quorum requires unanimous agreement for goal_complete."""
    results = [
        VerifierResult(status="goal_complete", reason="Evidence 1", confidence=0.9),
        VerifierResult(status="goal_complete", reason="Evidence 2", confidence=0.95),
        VerifierResult(status="goal_complete", reason="Evidence 3", confidence=0.85),
    ]
    verdict = consolidate(results)
    assert verdict.status == "goal_complete"


def test_consolidate_any_goal_failed_fails_quorum():
    """Any single goal_failed is sufficient to fail the entire quorum."""
    results = [
        VerifierResult(status="goal_complete", reason="Looks done to me", confidence=0.9),
        VerifierResult(status="goal_failed", reason="Payment was rejected", confidence=0.95),
        VerifierResult(status="goal_complete", reason="Confirmation banner seen", confidence=0.8),
    ]
    verdict = consolidate(results)
    assert verdict.status == "goal_failed"
    assert "Payment was rejected" in verdict.reason


def test_consolidate_disagreement_falls_back_to_in_progress():
    """Split vote between goal_complete and in_progress yields in_progress."""
    results = [
        VerifierResult(status="goal_complete", reason="Saw success badge", confidence=0.9),
        VerifierResult(status="in_progress", reason="Still loading balance", confidence=0.8),
        VerifierResult(status="goal_complete", reason="Saw checkmark", confidence=0.9),
    ]
    verdict = consolidate(results)
    assert verdict.status == "in_progress"


@pytest.mark.asyncio
async def test_verify_quorum_execution():
    """verify_quorum runs concurrent variants and consolidates results."""
    milestone = Milestone(id="m-0", description="Purchase item", is_final=True)
    with patch("app.agent.verifier._verify_with_llm", new_callable=AsyncMock) as mock_verify:
        mock_verify.return_value = VerifierResult(
            status="goal_complete",
            reason="Order confirmed",
            confidence=0.95,
        )
        res = await verify_quorum(
            step=None,
            last_action_result=None,
            current_url="http://example.com/done",
            previous_url="http://example.com/checkout",
            dom_map=[],
            milestone=milestone,
            goal="Buy item",
            page_text="Order Confirmed! Thank you!",
            n=3,
        )
        assert res.status == "goal_complete"

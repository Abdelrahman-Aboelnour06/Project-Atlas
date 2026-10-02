"""
Tests for Planner Agent
backend/tests/test_planner.py
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.agent.planner import plan_goal
from app.models.goal import Milestone


@pytest.mark.asyncio
async def test_planner_single_milestone():
    """Single-part goal produces one milestone marked is_final=True."""
    mock_response = """{
        "milestones": [
            {
                "id": "m-0",
                "description": "Search for shoes",
                "is_final": true,
                "satisfied_by_navigation": false,
                "branch_id": "b-0",
                "success_criteria": "Search results are displayed"
            }
        ]
    }"""
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_response
        milestones = await plan_goal("Search for shoes on this page")
        assert len(milestones) == 1
        assert isinstance(milestones[0], Milestone)
        assert milestones[0].is_final is True
        assert milestones[0].branch_id == "b-0"
        assert "Search" in milestones[0].description


@pytest.mark.asyncio
async def test_planner_multi_part_goal_branches():
    """Multi-part goals produce multiple milestones with distinct branch_ids."""
    mock_response = """{
        "milestones": [
            {
                "id": "m-0",
                "description": "Create an account",
                "is_final": false,
                "satisfied_by_navigation": false,
                "branch_id": "b-0",
                "success_criteria": "Account registration completed"
            },
            {
                "id": "m-1",
                "description": "Download the price list",
                "is_final": true,
                "satisfied_by_navigation": false,
                "branch_id": "b-1",
                "success_criteria": "Price list downloaded"
            }
        ]
    }"""
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_response
        milestones = await plan_goal("create an account and download the price list")
        assert len(milestones) == 2
        assert milestones[0].branch_id == "b-0"
        assert milestones[1].branch_id == "b-1"
        assert milestones[0].branch_id != milestones[1].branch_id
        assert milestones[0].is_final is False
        assert milestones[1].is_final is True


@pytest.mark.asyncio
async def test_planner_malformed_json_fallback():
    """Malformed LLM JSON falls back gracefully to a single milestone."""
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = "Sorry, I am not able to parse this as JSON: {"
        milestones = await plan_goal("Order a pizza")
        assert len(milestones) == 1
        assert isinstance(milestones[0], Milestone)
        assert milestones[0].is_final is True
        assert "Order a pizza" in milestones[0].description

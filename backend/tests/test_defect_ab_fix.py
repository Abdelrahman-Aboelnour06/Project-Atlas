"""
Unit & Integration Tests for Defect A and Defect B Traversal Fixes
backend/tests/test_defect_ab_fix.py
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.agent.verifier import verify_step_outcome
from app.models.dom import DomNode
from app.models.goal import GoalState, Milestone, PlanStep


def make_node(id: str, tag: str = "button", inner_text: str = "") -> DomNode:
    return DomNode(
        id=id,
        tag=tag,
        type=None,
        inner_text=inner_text,
        placeholder=None,
        aria_label=None,
        href=None,
        name=None,
    )


class TestDefectAFix:
    """Verifies that navigations do NOT prematurely declare goal_complete (Defect A)."""

    @pytest.mark.asyncio
    async def test_navigation_without_target_match_returns_in_progress(self):
        """
        Regression guard for Defect A:
        When an action causes a URL change (e.g. clicking 'Sign Up' going from /home to /signup),
        the verifier MUST return status='in_progress', NOT 'goal_complete'.
        """
        milestone = Milestone(
            id="m-1",
            description="Create an account on this site",
            status="active",
            target_url=None,
            is_final=True,
            satisfied_by_navigation=False,
        )
        last_action = PlanStep(action="click", element_id="atlas-signup-btn", description="Click Sign Up")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Create an account on this site",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/index.html",
            current_url="https://example.com/signup.html",
            prior_dom_ids=["atlas-signup-btn"],
            current_dom_map=[make_node("atlas-email-input", "input")],
            page_text="Create your new account today.",
        )

        assert res.status == "in_progress", f"Expected in_progress on intermediate navigation, got: {res.status}"
        assert res.verification_method == "rules"
        assert any("url_transition" in s for s in res.signals_detected)
        assert "target not yet reached" in res.reason.lower()

    @pytest.mark.asyncio
    async def test_navigation_with_target_match_non_final_returns_milestone_complete(self):
        """When intermediate milestone target is reached, returns milestone_complete."""
        milestone = Milestone(
            id="m-1",
            description="Reach registration page",
            status="active",
            target_url="https://example.com/register",
            is_final=False,
        )
        last_action = PlanStep(action="click", element_id="atlas-reg-link")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Sign up and order item",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/home",
            current_url="https://example.com/register",
            prior_dom_ids=["atlas-reg-link"],
            current_dom_map=[],
        )

        assert res.status == "milestone_complete"
        assert res.confidence == 1.0
        assert "target_url_matched" in res.signals_detected

    @pytest.mark.asyncio
    async def test_rule_5_element_disappearance_skipped_on_navigation(self):
        """
        Guard against false-positive element disappearance:
        When page changes, missing prior IDs must NOT trigger Rule 5 completion.
        """
        milestone = Milestone(
            id="m-1",
            description="Proceed to next step",
            status="active",
            target_url=None,
        )
        # An action that is not explicit modal dismissal
        last_action = PlanStep(action="click", element_id="atlas-submit", description="Submit form")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Multi-step form flow",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/step1",
            current_url="https://example.com/step2",
            prior_dom_ids=["atlas-submit", "atlas-input-1"],
            current_dom_map=[make_node("atlas-input-2", "input")],
        )

        # Because navigation occurred, Rule 4 evaluates (not Rule 5!) and returns in_progress
        assert res.status == "in_progress"


class TestDefectBFix:
    """Verifies that milestone_complete advances milestones instead of terminating (Defect B)."""

    def test_milestone_advancement_via_goal_step_endpoint(self):
        """
        When verifier yields milestone_complete on an intermediate milestone,
        the goal_step endpoint MUST advance active_milestone and keep goal status in_progress.
        """
        from app.main import app
        from app.db.connection import get_db

        m1 = Milestone(
            id="m-1",
            description="Reach registration page",
            status="active",
            target_url="https://example.com/signup",
            is_final=False,
        )
        m2 = Milestone(
            id="m-2",
            description="Fill and submit registration",
            status="pending",
            is_final=True,
        )

        state = {
            "goal": "Create an account",
            "hop_count": 0,
            "max_hops": 8,
            "status": "in_progress",
            "current_url": "https://example.com/home",
            "active_milestone_id": "m-1",
            "milestones": [m1.model_dump(), m2.model_dump()],
            "plan_steps": [{"action": "click", "element_id": "atlas-signup-btn"}],
        }

        payload = {
            "goal": "Create an account",
            "current_url": "https://example.com/signup",
            "dom_map": [{"id": "atlas-email", "tag": "input", "type": "email"}],
            "page_text": "Sign Up Form",
            "last_action_result": {"status": "success"},
            "goal_state": state,
            "api_key": "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
        }

        async def override_get_db():
            mock_db = AsyncMock()
            yield mock_db

        app.dependency_overrides[get_db] = override_get_db

        from app.models.goal import AgenticPlan

        mock_plan = AgenticPlan(
            reply="Navigating to catalog item",
            steps=[PlanStep(action="click", element_id="atlas-item-btn", description="Click item")],
            requires_confirmation=False,
        )

        with patch(
            "app.db.connection.validate_api_key",
            new=AsyncMock(return_value="demo-tenant-id"),
        ):
            with patch(
                "app.routes.chat.plan_milestone_step",
                new=AsyncMock(return_value=mock_plan),
            ):
                with TestClient(app) as client:
                    resp = client.post("/v1/chat/goal_step", json=payload)

        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()

        # Defect B verification: Goal must NOT have terminated!
        assert data["status"] == "in_progress", f"Expected in_progress, got: {data['status']}"
        assert data["goal_state"]["status"] == "in_progress"

        # Active milestone must now be m-2!
        assert data["goal_state"]["active_milestone_id"] == "m-2"
        milestones = data["goal_state"]["milestones"]
        assert milestones[0]["id"] == "m-1" and milestones[0]["status"] == "completed"
        assert milestones[1]["id"] == "m-2" and milestones[1]["status"] == "active"

        # Next step for m-2 must have been planned!
        assert len(data["steps"]) == 1
        assert data["steps"][0]["action"] in ("click", "fill")
        if data["steps"][0]["action"] == "click":
            assert data["steps"][0]["element_id"] == "atlas-item-btn"
        else:
            assert data["steps"][0]["element_id"] == "atlas-email"

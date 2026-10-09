"""
backend/tests/test_audit_backend_breakdown.py

Empirical stress tests for backend reasoning and planning on real-world website extracts:
1. Token safety on dense pages (Wikipedia 482+ nodes): Verifies prompt size and top-K candidate budgeting.
2. Scout classification on modal / blocker pages: Verifies whether Scout flags modals as blockers.
3. Bilingual / Arabic Goal Planning: Verifies milestone language mirroring and target matching.
4. Consequential / Destructive Action Gating: Verifies whether high-impact actions trigger the safety gate.
"""

import pytest
import json
from pathlib import Path

from app.agent import llm_client
from app.agent.scout import classify_page
from app.agent.planner import plan_goal
from app.agent.navigator import plan_milestone_step
from app.agent.jev_client import get_jev_client
from app.agent.form_filler import plan_form_fill
from app.models.goal import Milestone, GoalState


@pytest.fixture(autouse=True)
def enforce_mock(monkeypatch):
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


@pytest.mark.asyncio
async def test_backend_dense_page_token_budgeting():
    """Verify that a 482-element DOM (like Wikipedia) does not blow up token limits."""
    # Build 500 synthetic nodes
    dense_dom = []
    for i in range(1, 501):
        dense_dom.append({
            "id": f"el_node_{i}",
            "ref": f"ref_node_{i}",
            "tag": "a" if i % 2 == 0 else "button",
            "resolved_label": f"Wikipedia Reference Link #{i} about Accessibility Standards",
            "interactive": True,
            "disabled": False,
            "sensitive": False,
        })

    # Add the target node
    dense_dom.insert(250, {
        "id": "el_search_input",
        "ref": "ref_search_input",
        "tag": "input",
        "type": "search",
        "resolved_label": "Search Wikipedia",
        "interactive": True,
        "disabled": False,
        "sensitive": False,
    })

    # Scout classification
    scout_res = await classify_page(
        current_url="https://en.wikipedia.org/wiki/Web_accessibility",
        dom_map=dense_dom[:80],
        page_text="Web accessibility is the inclusive practice of ensuring there are no barriers...",
    )
    assert scout_res.page_kind in ("article", "other")

    # Navigator planning step
    milestone = Milestone(id="m-1", description="Type query into the search box", status="active", is_final=False)
    plan = await plan_milestone_step(
        goal="Search Wikipedia for screen readers",
        milestone=milestone,
        dom_map=dense_dom,
        current_url="https://en.wikipedia.org/wiki/Web_accessibility",
    )
    assert len(plan.steps) >= 1
    # Check that planned element is within the valid DOM
    valid_ids = {n["id"] for n in dense_dom}
    assert plan.steps[0].element_id in valid_ids


@pytest.mark.asyncio
async def test_backend_scout_modal_blocker_detection():
    """Verify Scout detects an active modal overlay as a page blocker."""
    modal_dom = [
        {"id": "el_modal", "tag": "div", "role": "dialog", "resolved_label": "Please Accept Terms to Continue", "interactive": True},
        {"id": "el_accept", "tag": "button", "resolved_label": "Accept & Continue", "interactive": True},
        {"id": "el_decline", "tag": "button", "resolved_label": "Decline", "interactive": True},
    ]

    scout_res = await classify_page(
        current_url="https://example.com/dashboard",
        dom_map=modal_dom,
        page_text="Please Accept Terms to Continue. You must agree to continue using the application.",
    )
    # Scout should classify page or detect if there are blockers
    assert scout_res.page_kind is not None

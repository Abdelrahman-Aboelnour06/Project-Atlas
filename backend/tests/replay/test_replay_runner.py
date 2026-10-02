"""
Replay Scenarios Test Runner
backend/tests/replay/test_replay_runner.py
Tier 3.5: Replay scenarios driving /v1/chat/goal_step with mock provider (§13.2).
"""

import pytest
from tests.replay.runner import (
    Scenario,
    Hop,
    HopExpectation,
    replay,
)


@pytest.mark.asyncio
async def test_defect_a_navigation_is_not_completion():
    """
    Regression Guard for Defect A:
    Intermediate navigation to /signup.html must return status='in_progress',
    NEVER 'goal_complete'.
    """
    scenario = Scenario(
        name="defect_a_navigation_guard",
        goal="Create an account on this site",
        hops=[
            Hop(
                url="https://example.com/index.html",
                dom_map=[
                    {"id": "btn-signup", "tag": "button", "inner_text": "Sign Up", "role": "button"}
                ],
                page_text="Welcome to the service. Click Sign Up to get started.",
                last_action_result=None,
                expect=HopExpectation(status="in_progress"),
            ),
            Hop(
                url="https://example.com/signup.html",
                dom_map=[
                    {"id": "input-email", "tag": "input", "type": "email", "placeholder": "Email"},
                    {"id": "btn-submit", "tag": "button", "inner_text": "Submit", "disabled": True},
                ],
                page_text="Sign Up Form. Please enter your email.",
                last_action_result={"status": "success", "action": "click", "element_id": "btn-signup"},
                expect=HopExpectation(status="in_progress"),
            ),
        ],
    )

    result = await replay(scenario)
    assert len(result.trace) == 2
    assert result.final["status"] == "in_progress"
    assert result.final["current_url"] == "https://example.com/signup.html"


@pytest.mark.asyncio
async def test_defect_b_milestone_advancement():
    """
    Regression Guard for Defect B:
    Intermediate milestone satisfaction advances to the next milestone
    instead of terminating the entire goal.
    """
    scenario = Scenario(
        name="defect_b_milestone_advancement",
        goal="Sign up and then download statement",
        hops=[
            Hop(
                url="https://example.com/step1",
                dom_map=[{"id": "btn-step1", "tag": "button", "inner_text": "Continue"}],
                page_text="Step 1 complete.",
                canned_llm_responses=[
                    '{"status": "milestone_complete", "reason": "Reached step 2", "confidence": 0.95}'
                ],
                expect=HopExpectation(status="in_progress"),
            ),
        ],
    )

    result = await replay(scenario)
    assert result.final["status"] == "in_progress"


@pytest.mark.asyncio
async def test_consequential_confirmation_gate():
    """
    Consequential action correctly halts execution with requires_confirmation.
    """
    scenario = Scenario(
        name="consequential_confirmation",
        goal="Delete this organization permanently",
        hops=[
            Hop(
                url="https://example.com/settings",
                dom_map=[{"id": "btn-delete", "tag": "button", "inner_text": "Delete Organization"}],
                page_text="Danger zone: permanent deletion.",
                expect=HopExpectation(status="requires_confirmation"),
            ),
        ],
    )

    result = await replay(scenario)
    assert result.final["status"] == "requires_confirmation"
    assert result.trace[0]["requires_confirmation"] is True


@pytest.mark.asyncio
async def test_form_filler_signup_scenario():
    """
    Signup form scenario: Form plan correctly isolates submit_ref from batch fields.
    """
    from app.agent.form_filler import plan_form_fill
    from app.models.dom import DomNode

    from app.agent import llm_client

    dom_nodes = [
        DomNode(id="el-email", tag="input", type="email", ref="el_email_12345", name="email", sensitive=True),
        DomNode(id="el-pass", tag="input", type="password", ref="el_pass_12345", name="password", sensitive=True),
        DomNode(id="el-btn", tag="button", inner_text="Create Account", ref="el_btn_12345", type="submit"),
    ]

    llm_client.set_mock_llm_queue([
        """{
            "form_id": "signup-form",
            "fields": [
                {"ref": "el_email_12345", "action": "fill", "value": "{profile.email}", "source": "profile"},
                {"ref": "el_pass_12345", "action": "fill", "value": "{password}", "source": "vault"}
            ],
            "submit_ref": "el_btn_12345",
            "missing_required": [],
            "blockers": []
        }"""
    ])

    plan = await plan_form_fill(
        form_id="signup-form",
        dom_nodes=dom_nodes,
        goal="Create account with email and password",
        profile_hints=["email"],
    )

    assert plan.submit_ref == "el_btn_12345"
    assert "el_btn_12345" not in [f.ref for f in plan.fields]
    assert any(f.value == "{profile.email}" for f in plan.fields)
    assert any(f.value == "{password}" for f in plan.fields)


@pytest.mark.asyncio
async def test_planner_multi_milestone_scenario():
    """
    Planner decomposes multi-part goal into ordered milestones.
    """
    from app.agent.planner import plan_goal
    from app.agent import llm_client

    llm_client.set_mock_llm_queue([
        """{
            "milestones": [
                {
                    "id": "m-0",
                    "description": "Create an account",
                    "is_final": false,
                    "branch_id": "b-0"
                },
                {
                    "id": "m-1",
                    "description": "Download price list",
                    "is_final": true,
                    "branch_id": "b-1"
                }
            ]
        }"""
    ])

    milestones = await plan_goal("Create an account and download the price list")
    assert len(milestones) >= 2
    assert milestones[-1].is_final is True
    assert milestones[0].id != milestones[1].id


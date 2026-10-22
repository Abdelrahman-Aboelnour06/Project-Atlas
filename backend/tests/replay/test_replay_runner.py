"""
Replay Scenarios Test Runner
backend/tests/replay/test_replay_runner.py
Tier 3.5: Replay scenarios driving /v1/chat/goal_step with mock provider (§13.2).
"""

import pytest
from app.agent import llm_client
from tests.replay.runner import (
    Scenario,
    Hop,
    HopExpectation,
    replay,
)


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforce deterministic mock provider for replay tests."""
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


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


@pytest.mark.asyncio
async def test_healthcare_intake_tokenization_scenario():
    """
    Enterprise Demo Fixture Scenario:
    Healthcare intake form enforces privacy rails: Form plan emits vault and
    profile tokens for sensitive PII and isolates submit_ref without auto-checking consent.
    """
    from app.agent.form_filler import plan_form_fill
    from app.models.dom import DomNode
    from app.agent import llm_client

    dom_nodes = [
        DomNode(id="full-name", tag="input", ref="ref_name", name="full_name"),
        DomNode(id="patient-dob", tag="input", ref="ref_dob", name="date_of_birth", sensitive=True),
        DomNode(id="patient-ssn", tag="input", ref="ref_ssn", name="ssn", sensitive=True),
        DomNode(id="patient-email", tag="input", ref="ref_email", type="email", sensitive=True),
        DomNode(id="consent-hipaa", tag="input", type="checkbox", ref="ref_consent", name="consent_hipaa"),
        DomNode(id="submit-intake-btn", tag="button", inner_text="Submit Patient Intake", ref="ref_submit", type="submit"),
    ]

    llm_client.set_mock_llm_queue([
        """{
            "form_id": "healthcare-intake-form",
            "fields": [
                {"ref": "ref_name", "action": "fill", "value": "{profile.full_name}", "source": "profile"},
                {"ref": "ref_dob", "action": "fill", "value": "{profile.date_of_birth}", "source": "profile"},
                {"ref": "ref_ssn", "action": "fill", "value": "{ssn}", "source": "vault"},
                {"ref": "ref_email", "action": "fill", "value": "{profile.email}", "source": "profile"}
            ],
            "submit_ref": "ref_submit",
            "missing_required": ["ref_consent"],
            "blockers": []
        }"""
    ])

    plan = await plan_form_fill(
        form_id="healthcare-intake-form",
        dom_nodes=dom_nodes,
        goal="Submit patient healthcare intake",
        profile_hints=["full_name", "date_of_birth", "email"],
    )

    assert plan.submit_ref == "ref_submit"
    assert "ref_submit" not in [f.ref for f in plan.fields]
    assert any(f.value == "{ssn}" for f in plan.fields)
    assert any(f.value == "{profile.email}" for f in plan.fields)
    assert "ref_consent" in plan.missing_required


@pytest.mark.asyncio
async def test_checkout_consequential_confirmation_scenario():
    """
    Enterprise Demo Fixture Scenario:
    Checkout payment execution button triggers consequential action gate with status='requires_confirmation'.
    """
    scenario = Scenario(
        name="checkout_consequential_payment_gate",
        goal="Complete payment and place order for items in cart",
        hops=[
            Hop(
                url="https://example.com/demo-site/checkout.html",
                dom_map=[
                    {
                        "id": "pay-now-btn",
                        "tag": "button",
                        "inner_text": "Complete Payment ($95.56) & Place Order",
                        "role": "button",
                        "resolved_label": "Complete Payment and Place Order",
                    }
                ],
                page_text="Order summary: 3 items. Total $95.56. Click Complete Payment to charge card.",
                expect=HopExpectation(status="requires_confirmation"),
            ),
        ],
    )

    result = await replay(scenario)
    assert result.final["status"] == "requires_confirmation"
    assert result.trace[0]["requires_confirmation"] is True


@pytest.mark.asyncio
async def test_finance_statement_tabular_export_scenario():
    """
    Enterprise Demo Fixture Scenario:
    Financial statement export action correctly plans download click.
    """
    scenario = Scenario(
        name="finance_statement_export",
        goal="Download the 2026 financial transactions statement CSV",
        hops=[
            Hop(
                url="https://example.com/demo-site/finance-statement.html",
                dom_map=[
                    {
                        "id": "download-statement-csv",
                        "tag": "a",
                        "inner_text": "Download Statement (CSV)",
                        "role": "link",
                        "resolved_label": "Download Statement (CSV)",
                    }
                ],
                page_text="Statement for Account ending in 4821. Click Download Statement to export CSV.",
                expect=HopExpectation(status="in_progress", action_on_label="download"),
            ),
        ],
    )

    result = await replay(scenario)
    assert len(result.trace) == 1
    steps = result.trace[0].get("steps", [])
    assert any("download" in s.get("description", "").lower() for s in steps)


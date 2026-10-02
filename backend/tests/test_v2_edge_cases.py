"""
Atlas v2 Comprehensive Edge Cases & Safety Rails Test Suite
backend/tests/test_v2_edge_cases.py

Validates edge cases across Planner, Scout, Form Filler, Scheduler, and Chat Pipeline:
1. Planner edge cases:
   - Malformed/corrupted LLM outputs & empty milestone arrays
   - Missing is_final flags enforced on terminal milestones
   - Empty/whitespace goals
2. Scout edge cases:
   - Cloudflare Turnstile / bot challenges
   - SMS/Authenticator OTP input variations
   - Extremely large DOM maps (>100 elements)
   - Malformed JSON fallback to heuristics
3. Form Filler privacy & safety rails:
   - Consent/Terms checkboxes NEVER auto-checked (placed into missing_required)
   - Plaintext passwords strictly replaced with vault token {password}
   - Submit control held back and strictly forbidden from batch fields
   - Date of birth / personal data protection against fabrication
   - Hallucinated refs discarded
4. Scheduler concurrency & backoff:
   - Shared 429 backoff gate under high worker contention
   - Speculative task cancellation on branch resolution
5. Chat loop resilience:
   - Resumption from awaiting_user_input state
   - Empty DOM map resilience
"""

import asyncio
import json
from typing import Any, Dict, List, Optional
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.agent import llm_client
from app.agent.planner import plan_goal
from app.agent.scout import classify_page, ScoutResult
from app.agent.form_filler import plan_form_fill
from app.agent.scheduler import AgentScheduler, Priority
from app.models.dom import DomNode
from app.models.goal import (
    GoalState,
    Milestone,
    PlanStep,
    UserInputRequest,
)

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforce deterministic mock provider."""
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


# ── 1. Planner Edge Cases ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_planner_corrupted_llm_json_fallback():
    """Planner falls back to a valid single milestone when LLM returns unparseable junk."""
    with patch("app.agent.planner.llm_client.call_llm", new=AsyncMock(return_value="<<<INTERNAL ERROR: Model timeout>>>")):
        milestones = await plan_goal("Book a train ticket to Zurich")
        assert len(milestones) == 1
        assert milestones[0].id in ("m-0", "m-1")
        assert milestones[0].is_final is True
        assert "Zurich" in milestones[0].description


@pytest.mark.asyncio
async def test_planner_empty_milestones_fallback():
    """Planner falls back to a valid milestone if LLM returns an empty milestones list."""
    with patch("app.agent.planner.llm_client.call_llm", new=AsyncMock(return_value='{"milestones": []}')):
        milestones = await plan_goal("Export monthly invoices")
        assert len(milestones) == 1
        assert milestones[0].is_final is True
        assert "invoices" in milestones[0].description


@pytest.mark.asyncio
async def test_planner_missing_is_final_enforced():
    """Planner enforces is_final=True on the last milestone if LLM omitted it."""
    raw = json.dumps({
        "milestones": [
            {"id": "m-0", "description": "Step 1", "is_final": False},
            {"id": "m-1", "description": "Step 2", "is_final": False},
        ]
    })
    with patch("app.agent.planner.llm_client.call_llm", new=AsyncMock(return_value=raw)):
        milestones = await plan_goal("Multi-step operation")
        assert len(milestones) == 2
        assert milestones[0].is_final is False
        assert milestones[1].is_final is True


@pytest.mark.asyncio
async def test_planner_whitespace_only_goal():
    """Planner handles empty or whitespace-only goals without raising an exception."""
    milestones = await plan_goal("   \n\t  ")
    assert len(milestones) == 1
    assert milestones[0].is_final is True
    assert "Explore" in milestones[0].description


# ── 2. Scout Edge Cases ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scout_huge_dom_truncation():
    """Scout gracefully handles very large DOMs (>100 elements) without memory or prompt explosion."""
    huge_dom = [
        DomNode(id=f"el-{i}", tag="div", inner_text=f"Item {i}", role="option")
        for i in range(120)
    ]
    result = await classify_page(
        dom_map=huge_dom,
        current_url="https://example.com/huge-catalog",
        page_text="Huge catalog listing with 120 items.",
    )
    assert isinstance(result, ScoutResult)
    assert result.page_kind in ("list", "other")


@pytest.mark.asyncio
async def test_scout_cloudflare_turnstile_detection():
    """Scout detects Cloudflare Turnstile challenge and identifies it as a CAPTCHA blocker."""
    turnstile_dom = [
        DomNode(
            id="cf-turnstile-wrapper",
            tag="div",
            inner_text="Verify you are human. Cloudflare Ray ID: 8872a1.",
            aria_label="Cloudflare Turnstile verification challenge",
        ),
        DomNode(id="btn-verify", tag="button", inner_text="Verify"),
    ]
    result = await classify_page(
        dom_map=turnstile_dom,
        current_url="https://example.com/turnstile",
        page_text="Checking your browser before accessing the website. Please complete the security check.",
    )
    assert result.page_kind == "captcha"
    assert "captcha" in result.blockers


@pytest.mark.asyncio
async def test_scout_two_factor_otp_detection():
    """Scout detects 2FA / OTP verification inputs and sets otp blocker."""
    otp_dom = [
        DomNode(
            id="otp-box",
            tag="input",
            type="text",
            name="security_code",
            resolved_label="One-Time Verification Code",
        ),
        DomNode(id="verify-submit", tag="button", inner_text="Confirm Code"),
    ]
    result = await classify_page(
        dom_map=otp_dom,
        current_url="https://example.com/mfa-verify",
        page_text="A 6-digit one-time code has been sent to your mobile device.",
    )
    assert "otp" in result.blockers


@pytest.mark.asyncio
async def test_scout_corrupted_llm_uses_heuristics():
    """Scout falls back cleanly to heuristics when LLM call throws or returns HTML."""
    dom = [
        DomNode(id="f-name", tag="input", type="text", name="name", resolved_label="Name"),
        DomNode(id="f-email", tag="input", type="email", name="email", resolved_label="Email"),
        DomNode(id="f-btn", tag="button", type="submit", inner_text="Register"),
    ]
    with patch("app.agent.scout.llm_client.call_llm", new=AsyncMock(side_effect=Exception("Connection reset"))):
        result = await classify_page(
            dom_map=dom,
            current_url="https://example.com/signup",
            page_text="Please sign up below.",
        )
        assert result.page_kind == "form"
        assert len(result.blockers) == 0


# ── 3. Form Filler Privacy & Safety Rails ─────────────────────────────────────

@pytest.mark.asyncio
async def test_form_filler_never_auto_consents_terms():
    """Hard Rule 3: Terms/consent checkboxes MUST NEVER be checked by the agent."""
    dom = [
        DomNode(id="f1", ref="ref-name", tag="input", type="text", name="name", resolved_label="Name"),
        DomNode(id="f2", ref="ref-terms", tag="input", type="checkbox", name="terms", resolved_label="I agree to Terms and Conditions", required=True),
        DomNode(id="f3", ref="ref-submit", tag="button", type="submit", inner_text="Submit"),
    ]
    # Simulate adversarial LLM that outputs a command to check the terms box
    adversarial_llm_reply = json.dumps({
        "form_id": "signup-form",
        "fields": [
            {"ref": "ref-name", "action": "fill", "value": "Alice", "source": "user"},
            {"ref": "ref-terms", "action": "set_checkbox", "value": "true", "source": "user"},
        ],
        "submit_ref": "ref-submit",
        "missing_required": [],
        "blockers": [],
    })
    with patch("app.agent.form_filler.llm_client.call_llm", new=AsyncMock(return_value=adversarial_llm_reply)):
        plan = await plan_form_fill(
            form_id="signup-form",
            dom_nodes=dom,
            goal="Sign up for an account",
            profile_hints=["name"],
        )
        # Terms checkbox MUST NOT be present in batch fields
        field_refs = [f.ref for f in plan.fields]
        assert "ref-terms" not in field_refs
        # Terms checkbox MUST be flagged in missing_required
        assert "ref-terms" in plan.missing_required


@pytest.mark.asyncio
async def test_form_filler_sensitive_password_tokenized():
    """Hard Rule 3 (Privacy): Sensitive fields get vault tokens, NEVER literal plaintext passwords."""
    dom = [
        DomNode(id="p1", ref="ref-pass", tag="input", type="password", name="pwd", sensitive=True, resolved_label="Password"),
        DomNode(id="p2", ref="ref-sub", tag="button", type="submit", inner_text="Login"),
    ]
    # Simulate LLM returning a plaintext password string
    leak_attempt_reply = json.dumps({
        "form_id": "login-form",
        "fields": [
            {"ref": "ref-pass", "action": "fill", "value": "SuperSecretPassword123!", "source": "user"},
        ],
        "submit_ref": "ref-sub",
        "missing_required": [],
        "blockers": [],
    })
    with patch("app.agent.form_filler.llm_client.call_llm", new=AsyncMock(return_value=leak_attempt_reply)):
        plan = await plan_form_fill(
            form_id="login-form",
            dom_nodes=dom,
            goal="Log into service",
            profile_hints=[],
        )
        assert len(plan.fields) == 1
        assert plan.fields[0].ref == "ref-pass"
        # Value MUST be converted to {password} vault token
        assert plan.fields[0].value == "{password}"
        assert plan.fields[0].source == "vault"


@pytest.mark.asyncio
async def test_form_filler_submit_held_back_never_in_fields():
    """Hard Rule 7: submit_ref is held back and MUST NEVER appear inside fields[]."""
    dom = [
        DomNode(id="f-email", ref="ref-email", tag="input", type="email", name="email", resolved_label="Email"),
        DomNode(id="f-sub", ref="ref-submit", tag="button", type="submit", inner_text="Submit Form"),
    ]
    adversarial_reply = json.dumps({
        "form_id": "form-1",
        "fields": [
            {"ref": "ref-email", "action": "fill", "value": "{profile.email}", "source": "profile"},
            {"ref": "ref-submit", "action": "click", "value": None, "source": "user"},
        ],
        "submit_ref": "ref-submit",
        "missing_required": [],
        "blockers": [],
    })
    with patch("app.agent.form_filler.llm_client.call_llm", new=AsyncMock(return_value=adversarial_reply)):
        plan = await plan_form_fill(
            form_id="form-1",
            dom_nodes=dom,
            goal="Submit email",
            profile_hints=["email"],
        )
        assert plan.submit_ref == "ref-submit"
        field_refs = [f.ref for f in plan.fields]
        assert "ref-submit" not in field_refs


@pytest.mark.asyncio
async def test_form_filler_unsourced_dob_never_fabricated():
    """Privacy: Agent never invents a birth date without user profile hint."""
    dom = [
        DomNode(id="dob", ref="ref-dob", tag="input", type="date", name="birth_date", resolved_label="Date of Birth", required=True),
        DomNode(id="s-btn", ref="ref-btn", tag="button", type="submit", inner_text="Next"),
    ]
    adversarial_reply = json.dumps({
        "form_id": "kyc-form",
        "fields": [
            {"ref": "ref-dob", "action": "fill", "value": "1990-01-01", "source": "generated"},
        ],
        "submit_ref": "ref-btn",
        "missing_required": [],
        "blockers": [],
    })
    with patch("app.agent.form_filler.llm_client.call_llm", new=AsyncMock(return_value=adversarial_reply)):
        plan = await plan_form_fill(
            form_id="kyc-form",
            dom_nodes=dom,
            goal="Complete KYC",
            profile_hints=["email", "phone"],  # No DOB provided
        )
        # Fabricated DOB must be rejected and flagged in missing_required
        assert not any(f.ref == "ref-dob" for f in plan.fields)
        assert "ref-dob" in plan.missing_required


@pytest.mark.asyncio
async def test_form_filler_hallucinated_ref_discarded():
    """Form Filler discards refs hallucinated by the model that do not exist in DOM."""
    dom = [
        DomNode(id="field-1", ref="ref-1", tag="input", type="text", name="first_name", resolved_label="First Name"),
    ]
    hallucinated_reply = json.dumps({
        "form_id": "form-1",
        "fields": [
            {"ref": "ref-1", "action": "fill", "value": "Bob", "source": "user"},
            {"ref": "hallucinated-ref-999", "action": "fill", "value": "Evil", "source": "user"},
        ],
        "submit_ref": None,
        "missing_required": [],
        "blockers": [],
    })
    with patch("app.agent.form_filler.llm_client.call_llm", new=AsyncMock(return_value=hallucinated_reply)):
        plan = await plan_form_fill(
            form_id="form-1",
            dom_nodes=dom,
            goal="Fill name",
            profile_hints=[],
        )
        assert len(plan.fields) == 1
        assert plan.fields[0].ref == "ref-1"


# ── 4. Scheduler Concurrency Edge Cases ───────────────────────────────────────

class FakeLLM:
    def __init__(self):
        self._delays = {}
        self._responses = {}
        self._cancelled = {}

    def delay(self, role: str, s: float):
        self._delays[role] = s
        return self

    def respond(self, role: str, r: Any):
        self._responses[role] = r
        return self

    def cancelled(self, role: str) -> bool:
        return self._cancelled.get(role, False)

    async def call(self, role: str, **kwargs):
        d = self._delays.get(role, 0.0)
        if d > 0:
            try:
                await asyncio.sleep(d)
            except asyncio.CancelledError:
                self._cancelled[role] = True
                raise
        return self._responses.get(role, "ok")


@pytest.mark.asyncio
async def test_scheduler_shared_backoff_gate():
    """All workers honor shared backoff gate when 429 rate limit is armed."""
    scheduler = AgentScheduler()

    # Arm backoff
    scheduler._arm_backoff("groq-default", retry_after=0.1)

    # Immediate check should be backed off
    assert scheduler.is_backed_off("groq-default") is True

    # Wait for backoff expiry
    await asyncio.sleep(0.15)
    assert scheduler.is_backed_off("groq-default") is False


@pytest.mark.asyncio
async def test_scheduler_speculative_cancellation():
    """run_speculative_turn cancels speculative task when verdict is terminal."""
    from app.agent.scheduler import run_speculative_turn
    from app.models.goal import Budget, AgenticPlan, VerifierResult

    fake_llm = FakeLLM()
    fake_llm.delay("verifier", 0.01).respond(
        "verifier",
        VerifierResult(status="goal_complete", reason="Done"),
    )
    fake_llm.delay("navigator", 0.25).respond(
        "navigator",
        AgenticPlan(reply="Step", steps=[PlanStep(action="click", element_id="btn-1")]),
    )

    scheduler = AgentScheduler()
    state = GoalState(goal="Test cancellation", budget=Budget(max_llm_calls=5))

    resp = await run_speculative_turn(
        scheduler=scheduler,
        state=state,
        verifier_fn=lambda: fake_llm.call("verifier"),
        navigator_fn=lambda: fake_llm.call("navigator"),
    )

    assert resp.status == "goal_complete"
    assert fake_llm.cancelled("navigator") is True


# ── 5. Chat Loop Edge Cases ───────────────────────────────────────────────────

@pytest.fixture
def api_client():
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    with patch("app.db.connection.validate_api_key", new=AsyncMock(return_value="demo-tenant-id")):
        with TestClient(app) as client:
            yield client
    app.dependency_overrides.clear()


def test_chat_resumes_from_awaiting_user_input(api_client):
    """User response resolves awaiting_user_input and transitions back to in_progress."""
    paused_state = {
        "goal": "Verify identity",
        "hop_count": 1,
        "max_hops": 8,
        "status": "awaiting_user_input",
        "current_url": "https://example.com/verify",
        "awaiting": {
            "kind": "otp",
            "prompt": "Enter the one-time code sent to your phone.",
            "resumable": True,
        },
        "milestones": [
            {"id": "m-0", "description": "Verify identity", "status": "active"}
        ],
    }
    payload = {
        "goal": "Verify identity",
        "current_url": "https://example.com/account",
        "dom_map": [
            {"id": "atlas-001", "tag": "button", "inner_text": "Continue to Dashboard", "role": "button"}
        ],
        "page_text": "Verification successful! Click continue to proceed to your dashboard.",
        "goal_state": paused_state,
        "user_response": "123456",
        "api_key": DEMO_API_KEY,
    }

    res = api_client.post("/v1/chat/goal_step", json=payload)
    assert res.status_code == 200
    data = res.json()

    # State must have resumed from awaiting_user_input to in_progress
    assert data["status"] == "in_progress"
    assert data["goal_state"]["awaiting"] is None
    assert len(data["steps"]) >= 1


def test_chat_empty_dom_map_first_hop(api_client):
    """Initial hop with empty DOM map executes safely without exceptions."""
    payload = {
        "goal": "Explore blank page",
        "current_url": "about:blank",
        "dom_map": [],
        "api_key": DEMO_API_KEY,
    }

    res = api_client.post("/v1/chat/goal_step", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["status"] == "in_progress"
    assert data["goal_state"]["hop_count"] == 1
    assert len(data["goal_state"]["milestones"]) >= 1

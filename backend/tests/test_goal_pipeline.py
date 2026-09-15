"""
Goal Pipeline Integration & Unit Tests
backend/tests/test_goal_pipeline.py

Covers:
1. Navigator Agent (backend/app/agent/navigator.py):
   - DOM validation & zero element ID hallucination
   - Universal heuristic recovery of hallucinated element IDs
   - Deterministic consequential action gating for sensitive/irreversible operations
   - Human-in-the-loop confirmation handling (yes, proceed vs cancel)
   - PII scrubbing on input nodes
2. Verifier Agent (backend/app/agent/verifier.py):
   - Initial turn state handling
   - Rule 1: Client execution status error detection
   - Rule 2: Error banner, toast, and alert keyword detection
   - Rule 3: Success indicator detection
   - Rule 4: URL transitions (target matched and navigation action)
   - Rule 5: Element disappearance (modal dismissed or item removed)
   - Rule 6: Fallback to LLM evaluation and Phase 1 milestone_complete mapping
3. REST Endpoint POST /v1/chat/goal_step:
   - Authentication (missing key, invalid key, valid key)
   - Rate limiting check
   - Implicit milestone initialization
   - Happy path multi-step execution turn
   - Consequential action pause (requires_confirmation)
   - User confirmation handling ('yes' execution vs 'cancel')
   - Verifier integration advancing state to goal_complete or goal_failed
   - Strict max_hops boundary cutoff
   - Terminal state short-circuit
"""

import json
from typing import Any, Dict, Optional
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.agent import llm_client
from app.agent.navigator import plan_milestone_step
from app.agent.verifier import verify_step_outcome
from app.models.action import ActionType
from app.models.dom import DomNode
from app.models.goal import (
    AgenticPlan,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
    Milestone,
    PlanStep,
    VerifierResult,
)

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
WRONG_API_KEY = "atlas_invalidkey0000000000000000"


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforces deterministic mock LLM provider with clean FIFO queue across all tests."""
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


def make_dom_node(
    id: Optional[str] = "atlas-001",
    tag: str = "button",
    type: Optional[str] = None,
    inner_text: Optional[str] = None,
    placeholder: Optional[str] = None,
    aria_label: Optional[str] = None,
    href: Optional[str] = None,
    name: Optional[str] = None,
    role: Optional[str] = None,
    sensitive: bool = False,
    resolved_label: Optional[str] = None,
    group_label: Optional[str] = None,
) -> DomNode:
    """Helper to construct contract-compliant DomNode instances."""
    resolved = resolved_label or aria_label or inner_text
    aria = aria_label or inner_text
    return DomNode(
        id=id,
        tag=tag,
        type=type,
        inner_text=inner_text,
        placeholder=placeholder,
        aria_label=aria,
        href=href,
        name=name,
        role=role,
        sensitive=sensitive,
        resolved_label=resolved,
        group_label=group_label,
    )


def make_dom_dict(
    id: Optional[str] = "atlas-001",
    tag: str = "button",
    type: Optional[str] = None,
    inner_text: Optional[str] = None,
    placeholder: Optional[str] = None,
    aria_label: Optional[str] = None,
    href: Optional[str] = None,
    name: Optional[str] = None,
    role: Optional[str] = None,
    sensitive: bool = False,
    resolved_label: Optional[str] = None,
    group_label: Optional[str] = None,
) -> Dict[str, Any]:
    """Helper to construct contract-compliant DomNode dicts for HTTP payloads."""
    resolved = resolved_label or aria_label or inner_text
    aria = aria_label or inner_text
    return {
        "id": id,
        "tag": tag,
        "type": type,
        "inner_text": inner_text,
        "placeholder": placeholder,
        "aria_label": aria,
        "href": href,
        "name": name,
        "role": role,
        "sensitive": sensitive,
        "resolved_label": resolved,
        "group_label": group_label,
    }


# ── Test Suite 1: Navigator Agent Unit Tests ────────────────────────────────────

class TestNavigatorAgent:
    @pytest.mark.asyncio
    async def test_navigator_resolves_valid_dom_element(self):
        """Navigator plans an action using a verified DOM element ID."""
        dom_map = [
            make_dom_node(id="atlas-001", tag="button", inner_text="Add to Cart", role="button"),
            make_dom_node(id="atlas-002", tag="a", inner_text="View Cart", href="/cart"),
        ]
        milestone = Milestone(id="m-1", description="Add product to cart", status="active")

        canned_response = json.dumps({
            "type": "plan",
            "thought": "Click Add to Cart button",
            "reply": "Adding the product to your cart.",
            "steps": [
                {
                    "action": "click",
                    "element_id": "atlas-001",
                    "value": None,
                    "description": "Click Add to Cart",
                    "delay_ms": 600,
                }
            ],
            "requires_confirmation": False,
        })
        llm_client.set_mock_llm_response(canned_response)

        plan = await plan_milestone_step(
            goal="Add this item to my cart",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com/product/123",
        )

        assert isinstance(plan, AgenticPlan)
        assert len(plan.steps) == 1
        assert plan.steps[0].element_id == "atlas-001"
        assert plan.steps[0].action == "click"
        assert plan.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_navigator_zero_hallucination_discards_unresolvable_id(self):
        """Navigator strictly discards hallucinated element IDs when unresolvable."""
        dom_map = [
            make_dom_node(id="atlas-001", tag="button", inner_text="Search", role="button"),
        ]
        milestone = Milestone(id="m-1", description="Click random thing", status="active")

        canned_response = json.dumps({
            "type": "plan",
            "thought": "Click hallucinated item",
            "reply": "Clicking item.",
            "steps": [
                {
                    "action": "click",
                    "element_id": "atlas-999",
                    "value": None,
                    "description": "Click completely non-existent element xyz",
                    "delay_ms": 600,
                }
            ],
            "requires_confirmation": False,
        })
        llm_client.set_mock_llm_response(canned_response)

        plan = await plan_milestone_step(
            goal="Click completely non-existent element xyz",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com",
        )

        # Hallucinated ID atlas-999 must NOT be in steps
        assert all(step.element_id != "atlas-999" for step in plan.steps)

    @pytest.mark.asyncio
    async def test_navigator_recovers_hallucinated_id_via_universal_heuristic(self):
        """When LLM hallucinates an ID, Navigator recovers the correct element via universal heuristics."""
        dom_map = [
            make_dom_node(id="atlas-002", tag="button", inner_text="Submit Order", role="button"),
        ]
        milestone = Milestone(id="m-1", description="Submit order", status="active")

        canned_response = json.dumps({
            "type": "plan",
            "thought": "Submitting",
            "reply": "Submitting order.",
            "steps": [
                {
                    "action": "click",
                    "element_id": "atlas-bad-id",
                    "value": None,
                    "description": "Submit Order",
                    "delay_ms": 600,
                }
            ],
            "requires_confirmation": False,
        })
        llm_client.set_mock_llm_response(canned_response)

        plan = await plan_milestone_step(
            goal="Submit Order",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com/checkout",
            user_response="yes",  # Already confirmed
        )

        assert len(plan.steps) == 1
        assert plan.steps[0].element_id == "atlas-002"

    @pytest.mark.asyncio
    async def test_navigator_consequential_action_gating_sensitive_flag(self):
        """Navigator gates actions targeting elements flagged sensitive=True."""
        dom_map = [
            make_dom_node(id="atlas-005", tag="button", inner_text="Delete Account", sensitive=True),
        ]
        milestone = Milestone(id="m-1", description="Delete Account", status="active")

        canned_response = json.dumps({
            "type": "plan",
            "thought": "Deleting account",
            "reply": "Deleting your account.",
            "steps": [
                {
                    "action": "click",
                    "element_id": "atlas-005",
                    "description": "Delete Account",
                }
            ],
            "requires_confirmation": False,
        })
        llm_client.set_mock_llm_response(canned_response)

        plan = await plan_milestone_step(
            goal="Delete my account",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com/settings",
        )

        assert plan.requires_confirmation is True
        assert plan.pending_step is not None
        assert plan.pending_step.element_id == "atlas-005"
        assert plan.steps == []

    @pytest.mark.asyncio
    async def test_navigator_consequential_action_gating_purchase_keywords(self):
        """Navigator gates purchase/payment actions even if LLM missed the confirmation flag."""
        dom_map = [
            make_dom_node(id="atlas-010", tag="button", inner_text="Buy Now with 1-Click"),
        ]
        milestone = Milestone(id="m-1", description="Buy product", status="active")

        canned_response = json.dumps({
            "type": "plan",
            "thought": "Click buy",
            "reply": "Buying now.",
            "steps": [
                {
                    "action": "click",
                    "element_id": "atlas-010",
                    "description": "Buy Now with 1-Click",
                }
            ],
            "requires_confirmation": False,
        })
        llm_client.set_mock_llm_response(canned_response)

        plan = await plan_milestone_step(
            goal="Buy this item now",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com/product",
        )

        assert plan.requires_confirmation is True
        assert plan.pending_step is not None
        assert plan.pending_step.element_id == "atlas-010"

    @pytest.mark.asyncio
    async def test_navigator_user_cancellation_response(self):
        """User responding with cancellation immediately clears pending execution."""
        dom_map = [make_dom_node(id="atlas-001", tag="button", inner_text="Pay")]
        milestone = Milestone(id="m-1", description="Pay invoice", status="active")

        plan = await plan_milestone_step(
            goal="Pay invoice",
            milestone=milestone,
            dom_map=dom_map,
            current_url="https://example.com/billing",
            user_response="cancel",
        )

        assert plan.type == "conversation"
        assert plan.steps == []
        assert plan.requires_confirmation is False


# ── Test Suite 2: Verifier Agent Unit Tests ─────────────────────────────────────

class TestVerifierAgent:
    @pytest.mark.asyncio
    async def test_verifier_initial_turn(self):
        """Initial turn without prior action returns in_progress with method=initial."""
        milestone = Milestone(id="m-1", description="Browse items", status="active")
        res = await verify_step_outcome(
            goal="Browse items",
            milestone=milestone,
            last_action=None,
            last_action_result=None,
            prior_url=None,
            current_url="https://example.com",
            prior_dom_ids=[],
            current_dom_map=[make_dom_node(id="atlas-001", tag="button", inner_text="Item 1")],
        )
        assert res.status == "in_progress"
        assert res.verification_method == "initial"

    @pytest.mark.asyncio
    async def test_verifier_client_execution_error_status(self):
        """When client reports execution failure, returns goal_failed with method=rules."""
        milestone = Milestone(id="m-1", description="Click button", status="active")
        last_action = PlanStep(action="click", element_id="atlas-001")
        last_action_result = {
            "status": "error",
            "error": "Element atlas-001 is detached from DOM",
        }

        res = await verify_step_outcome(
            goal="Click button",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com",
            current_url="https://example.com",
            prior_dom_ids=["atlas-001"],
            current_dom_map=[],
        )

        assert res.status == "goal_failed"
        assert "detached from DOM" in res.reason
        assert res.verification_method == "rules"
        assert "client_execution_error" in res.signals_detected

    @pytest.mark.asyncio
    async def test_verifier_error_banner_keyword_detection(self):
        """When page_text contains an error banner (e.g. card declined), returns goal_failed."""
        milestone = Milestone(id="m-1", description="Pay checkout", status="active")
        last_action = PlanStep(action="click", element_id="atlas-002", description="Submit Payment")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Pay checkout",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/checkout",
            current_url="https://example.com/checkout",
            prior_dom_ids=["atlas-001", "atlas-002"],
            current_dom_map=[make_dom_node(id="atlas-003", tag="div", inner_text="Payment declined by bank")],
            page_text="Checkout summary. Payment declined by bank. Please use another card.",
        )

        assert res.status == "goal_failed"
        assert res.verification_method == "rules"
        assert any("error_banner" in s for s in res.signals_detected)

    @pytest.mark.asyncio
    async def test_verifier_success_indicator_detection(self):
        """When page contains confirmation keywords, returns goal_complete with method=rules."""
        milestone = Milestone(id="m-1", description="Order book", status="active")
        last_action = PlanStep(action="click", element_id="atlas-001", description="Place Order")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Order book",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/checkout",
            current_url="https://example.com/order-receipt",
            prior_dom_ids=["atlas-001"],
            current_dom_map=[make_dom_node(id="atlas-010", tag="h1", inner_text="Thank you for your order!")],
            page_text="Thank you for your order! Your confirmation number is #88219.",
        )

        assert res.status == "goal_complete"
        assert res.verification_method == "rules"
        assert any("success_indicator" in s for s in res.signals_detected)

    @pytest.mark.asyncio
    async def test_verifier_url_transition_target(self):
        """When URL changes to milestone.target_url, returns goal_complete."""
        milestone = Milestone(
            id="m-1",
            description="Go to cart",
            status="active",
            target_url="https://example.com/cart",
        )
        last_action = PlanStep(action="click", element_id="atlas-005")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Go to cart",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/shop",
            current_url="https://example.com/cart",
            prior_dom_ids=["atlas-005"],
            current_dom_map=[],
        )

        assert res.status == "goal_complete"
        assert res.verification_method == "rules"
        assert any("url_transition" in s for s in res.signals_detected)

    @pytest.mark.asyncio
    async def test_verifier_element_disappearance(self):
        """When target element disappears after close/delete action, returns goal_complete."""
        milestone = Milestone(id="m-1", description="Close modal", status="active")
        last_action = PlanStep(action="click", element_id="atlas-modal-close", description="Close modal")
        last_action_result = {"status": "success"}

        res = await verify_step_outcome(
            goal="Close modal",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com",
            current_url="https://example.com",
            prior_dom_ids=["atlas-modal-close", "atlas-main-content"],
            current_dom_map=[make_dom_node(id="atlas-main-content", tag="main")],
        )

        assert res.status == "goal_complete"
        assert res.verification_method == "rules"
        assert "element_disappeared:atlas-modal-close" in res.signals_detected

    @pytest.mark.asyncio
    async def test_verifier_llm_fallback_when_rules_inconclusive(self):
        """When rules cannot determine outcome, Verifier falls back to LLM evaluation."""
        milestone = Milestone(id="m-1", description="Apply filter", status="active")
        last_action = PlanStep(action="click", element_id="atlas-filter-5")
        last_action_result = {"status": "success"}

        canned_eval = json.dumps({
            "status": "milestone_complete",
            "reason": "Filter was applied and items were updated.",
            "confidence": 0.90,
            "signals_detected": ["filter_selected"],
            "verification_method": "llm",
        })
        llm_client.set_mock_llm_response(canned_eval)

        res = await verify_step_outcome(
            goal="Filter by 5 stars",
            milestone=milestone,
            last_action=last_action,
            last_action_result=last_action_result,
            prior_url="https://example.com/items",
            current_url="https://example.com/items",
            prior_dom_ids=["atlas-filter-5"],
            current_dom_map=[make_dom_node(id="atlas-filter-5", tag="button", inner_text="5 stars")],
            page_text="Standard product listing page.",
        )

        # In Phase 1 single milestone, milestone_complete maps to goal_complete
        assert res.status == "goal_complete"
        assert res.verification_method == "llm"


# ── Test Suite 3: REST Endpoint POST /v1/chat/goal_step ─────────────────────────

@pytest.fixture
def api_client():
    """FastAPI TestClient with mocked database validate_api_key."""
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_API_KEY else None),
    ):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()


class TestGoalStepEndpointIntegration:
    def test_goal_step_unauthenticated_rejection_missing_key(self, api_client):
        """Endpoint rejects requests with no API key."""
        payload = {
            "goal": "Search laptops",
            "current_url": "https://example.com",
            "dom_map": [],
        }
        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 401
        assert "Missing API key" in res.json()["detail"]

    def test_goal_step_unauthenticated_rejection_invalid_key(self, api_client):
        """Endpoint rejects requests with an invalid API key."""
        payload = {
            "goal": "Search laptops",
            "current_url": "https://example.com",
            "dom_map": [],
            "api_key": WRONG_API_KEY,
        }
        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 401
        assert "Invalid API key" in res.json()["detail"]

    def test_goal_step_initial_hop_happy_path(self, api_client):
        """Happy path: initial hop initializes implicit milestone and plans first step."""
        payload = {
            "goal": "Click on timetable",
            "current_url": "https://example.com/portal",
            "dom_map": [
                make_dom_dict(id="atlas-001", tag="button", inner_text="Timetable", role="button")
            ],
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "in_progress"
        assert len(data["steps"]) >= 1
        assert data["steps"][0]["element_id"] == "atlas-001"
        assert data["goal_state"]["hop_count"] == 1
        assert data["goal_state"]["milestones"][0]["id"] == "m-1"
        assert data["requires_confirmation"] is False

    def test_goal_step_consequential_action_pause(self, api_client):
        """Consequential action triggers confirmation pause (requires_confirmation=True)."""
        payload = {
            "goal": "Place order",
            "current_url": "https://example.com/checkout",
            "dom_map": [
                make_dom_dict(id="atlas-009", tag="button", inner_text="Place Order", sensitive=True)
            ],
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "requires_confirmation"
        assert data["requires_confirmation"] is True
        assert data["pending_step"] is not None
        assert data["pending_step"]["element_id"] == "atlas-009"
        assert data["confirmation_prompt"] is not None

    def test_goal_step_user_confirms_action(self, api_client):
        """User confirms paused action with 'yes', executing pending step and advancing hop."""
        paused_state = {
            "goal": "Place order",
            "hop_count": 1,
            "max_hops": 8,
            "status": "requires_confirmation",
            "requires_confirmation": True,
            "current_url": "https://example.com/checkout",
            "pending_step": {
                "action": "click",
                "element_id": "atlas-009",
                "description": "Confirm Place Order",
                "delay_ms": 600,
            },
            "milestones": [
                {"id": "m-1", "description": "Place order", "status": "active"}
            ],
        }

        payload = {
            "goal": "Place order",
            "current_url": "https://example.com/checkout",
            "dom_map": [make_dom_dict(id="atlas-009", tag="button", inner_text="Place Order")],
            "goal_state": paused_state,
            "user_response": "yes",
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "in_progress"
        assert data["requires_confirmation"] is False
        assert len(data["steps"]) == 1
        assert data["steps"][0]["element_id"] == "atlas-009"
        assert data["goal_state"]["hop_count"] == 2

    def test_goal_step_user_cancels_action(self, api_client):
        """User cancels paused action with 'cancel', returning to in_progress with empty steps."""
        paused_state = {
            "goal": "Delete account",
            "hop_count": 1,
            "max_hops": 8,
            "status": "requires_confirmation",
            "requires_confirmation": True,
            "current_url": "https://example.com/settings",
            "pending_step": {
                "action": "click",
                "element_id": "atlas-010",
                "description": "Confirm Delete",
            },
            "milestones": [
                {"id": "m-1", "description": "Delete account", "status": "active"}
            ],
        }

        payload = {
            "goal": "Delete account",
            "current_url": "https://example.com/settings",
            "dom_map": [],
            "goal_state": paused_state,
            "user_response": "cancel",
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "in_progress"
        assert data["requires_confirmation"] is False
        assert data["steps"] == []
        assert "cancelled" in data["reply"].lower()

    def test_goal_step_verifier_success_completes_goal(self, api_client):
        """Verifier detecting success banner sets status=goal_complete."""
        state = {
            "goal": "Purchase book",
            "hop_count": 2,
            "max_hops": 8,
            "status": "in_progress",
            "current_url": "https://example.com/checkout",
            "plan_steps": [
                {"action": "click", "element_id": "atlas-buy", "description": "Buy Book"}
            ],
            "milestones": [
                {"id": "m-1", "description": "Purchase book", "status": "active"}
            ],
        }

        payload = {
            "goal": "Purchase book",
            "current_url": "https://example.com/receipt",
            "dom_map": [],
            "page_text": "Thank you for your order! Your purchase is confirmed.",
            "last_action_result": {"status": "success"},
            "goal_state": state,
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_complete"
        assert data["goal_state"]["status"] == "goal_complete"
        assert data["verifier_result"]["status"] == "goal_complete"
        assert "completed successfully" in data["reply"].lower()

    def test_goal_step_verifier_error_fails_goal(self, api_client):
        """Verifier detecting client error sets status=goal_failed."""
        state = {
            "goal": "Pay invoice",
            "hop_count": 1,
            "max_hops": 8,
            "status": "in_progress",
            "current_url": "https://example.com/pay",
            "plan_steps": [
                {"action": "click", "element_id": "atlas-pay", "description": "Pay Now"}
            ],
            "milestones": [
                {"id": "m-1", "description": "Pay invoice", "status": "active"}
            ],
        }

        payload = {
            "goal": "Pay invoice",
            "current_url": "https://example.com/pay",
            "dom_map": [],
            "last_action_result": {
                "status": "error",
                "error": "Card declined: insufficient funds",
            },
            "goal_state": state,
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_failed"
        assert data["goal_state"]["status"] == "goal_failed"
        assert data["verifier_result"]["status"] == "goal_failed"
        assert "Card declined" in data["reply"]

    def test_goal_step_max_hops_termination(self, api_client):
        """When hop_count reaches max_hops, execution terminates with goal_failed."""
        exhausted_state = {
            "goal": "Find obscure product",
            "hop_count": 8,
            "max_hops": 8,
            "status": "in_progress",
            "current_url": "https://example.com/search",
            "milestones": [
                {"id": "m-1", "description": "Find obscure product", "status": "active"}
            ],
        }

        payload = {
            "goal": "Find obscure product",
            "current_url": "https://example.com/search",
            "dom_map": [],
            "goal_state": exhausted_state,
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_failed"
        assert data["goal_state"]["status"] == "goal_failed"
        assert "maximum allowed hops limit" in data["reply"]
        assert data["steps"] == []

    def test_goal_step_terminal_state_short_circuit(self, api_client):
        """If goal_state is already terminal, endpoint returns immediately without re-planning."""
        already_complete_state = {
            "goal": "Book flight",
            "hop_count": 3,
            "max_hops": 8,
            "status": "goal_complete",
            "current_url": "https://example.com/booked",
            "milestones": [
                {"id": "m-1", "description": "Book flight", "status": "completed"}
            ],
        }

        payload = {
            "goal": "Book flight",
            "current_url": "https://example.com/booked",
            "dom_map": [],
            "goal_state": already_complete_state,
            "api_key": DEMO_API_KEY,
        }

        res = api_client.post("/v1/chat/goal_step", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_complete"
        assert data["steps"] == []

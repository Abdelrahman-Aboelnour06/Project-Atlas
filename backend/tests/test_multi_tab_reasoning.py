"""
Integration & Reasoning Test Suite: Multi-Tab Reasoning, Kill-Switch, & Golden Replays
File: backend/tests/test_multi_tab_reasoning.py

Milestone 4 (R4) Requirements Verification:
1. Feature Flag / Kill Switch (/v1/config):
   - GET /v1/config returns {"multiTab": {"enabled": True, ...}} by default.
   - Env var MULTITAB_ENABLED ("0", "false", "no", "off", "disabled") disables multi-tab.
   - Env var ATLAS_MULTITAB_ENABLED fallback.
2. Single-Tab Fallback:
   - When multiTab is disabled, suppresses multi-tab steps (no switch_tab, no close_tab, no switch_tab_id).
3. Capability Gating:
   - Only emit switch_tab when client declares "switch_tab" in capabilities.
4. Active Tab Validation:
   - Target tab_id must exist in active session tabs (payload.tab_context.tabs).
5. TabContext Ingestion & Security Gates:
   - Unconfirmed cross-origin child popup gates execution with requires_origin_confirmation=True.
   - Confirmed cross-origin popup proceeds.
   - Resumption with "yes" satisfies origin confirmation.
   - resume_reason="popup_blocked" returns assisted_click dict.
   - close_hint=True returns close_tab=True and switch_tab_id=opener_tab_id.
6. Handoff Budget Enforcement:
   - Budget handoff_count increments on tab transitions.
   - Exceeding max_handoffs terminates goal with goal_failed.
7. Multi-Tab Golden Replays:
   - Multi-step multi-window OAuth flow replay across opener and popup tabs.
"""

import os
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.connection import get_db
from app.agent import llm_client
from app.models.goal import (
    Budget,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
    Milestone,
    PlanStep,
    TabContext,
    TabInfo,
    VerifierResult,
)
from app.routes.config import is_multitab_enabled

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
AUTH_HEADERS = {"X-Atlas-Key": DEMO_API_KEY}


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforces deterministic mock LLM provider across all tests."""
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")


@pytest.fixture
def api_client():
    """FastAPI TestClient with mocked database auth."""
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


# ── 1. Feature Flag / Kill Switch Tests (/v1/config) ─────────────────────────

class TestConfigKillSwitch:
    """Tests GET /v1/config endpoint and environment variable kill-switch toggles."""

    def test_config_endpoint_default(self, api_client, monkeypatch):
        monkeypatch.delenv("MULTITAB_ENABLED", raising=False)
        monkeypatch.delenv("ATLAS_MULTITAB_ENABLED", raising=False)

        res = api_client.get("/v1/config")
        assert res.status_code == 200
        data = res.json()
        assert "multiTab" in data
        assert data["multiTab"]["enabled"] is True
        assert data["multiTab"]["maxHandoffs"] == 4
        assert data["multiTab"]["leaseTtlSeconds"] == 20
        assert data["version"] == "0.3.0"

    @pytest.mark.parametrize("falsy_value", ["false", "0", "no", "off", "disabled", "FALSE", "No"])
    def test_config_endpoint_disabled_values(self, api_client, monkeypatch, falsy_value):
        monkeypatch.setenv("MULTITAB_ENABLED", falsy_value)
        assert is_multitab_enabled() is False

        res = api_client.get("/v1/config")
        assert res.status_code == 200
        data = res.json()
        assert data["multiTab"]["enabled"] is False

    def test_config_endpoint_atlas_env_var_fallback(self, api_client, monkeypatch):
        monkeypatch.delenv("MULTITAB_ENABLED", raising=False)
        monkeypatch.setenv("ATLAS_MULTITAB_ENABLED", "false")
        assert is_multitab_enabled() is False

        res = api_client.get("/v1/config")
        assert res.status_code == 200
        assert res.json()["multiTab"]["enabled"] is False


# ── 2. Capability Gating Tests ───────────────────────────────────────────────

class TestCapabilityGating:
    """Verifies that switch_tab actions are ONLY emitted when declared in capabilities."""

    def test_switch_tab_emitted_when_capability_declared(self, api_client):
        """When client declares switch_tab capability, backend emits switch_tab on close_hint."""
        payload = {
            "goal": "Authorize identity in popup window",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "contract_version": 2,
            "capabilities": ["switch_tab", "tab_context", "assisted_click"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth", "is_child": True, "is_active": True},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["close_tab"] is True
        assert data["switch_tab_id"] == 100
        assert len(data["steps"]) == 1
        assert data["steps"][0]["action"] == "switch_tab"
        assert data["steps"][0]["tab_id"] == 100

    def test_switch_tab_suppressed_when_capability_missing(self, api_client):
        """When client lacks switch_tab capability, switch_tab is suppressed."""
        payload = {
            "goal": "Authorize identity in popup window",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "contract_version": 2,
            "capabilities": ["tab_context", "assisted_click"],  # NO switch_tab
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth", "is_child": True, "is_active": True},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Suppressed due to lack of capability
        assert data["switch_tab_id"] is None
        assert not any(s.get("action") == "switch_tab" for s in data["steps"])

    def test_switch_tab_suppressed_for_empty_capabilities(self, api_client):
        """Legacy or minimal client with empty capabilities list suppresses switch_tab."""
        payload = {
            "goal": "Authorize identity in popup window",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "contract_version": 2,
            "capabilities": [],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth", "is_child": True, "is_active": True},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] is None
        assert not any(s.get("action") == "switch_tab" for s in data["steps"])


# ── 3. Active Tab Validation Tests ───────────────────────────────────────────

class TestActiveTabValidation:
    """Verifies that target tab IDs must exist in active session tabs."""

    def test_active_tab_validation_accepts_registered_tab(self, api_client):
        """Valid target tab present in tab_context.tabs is accepted."""
        payload = {
            "goal": "Switch back to opener",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 202,
                "opener_tab_id": 200,
                "tabs": [
                    {"tab_id": 200, "url": "https://example.com"},
                    {"tab_id": 202, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] == 200
        assert data["steps"][0]["tab_id"] == 200

    def test_active_tab_validation_rejects_unregistered_tab(self, api_client):
        """Attempting to switch to unknown tab ID not in session tabs is rejected."""
        payload = {
            "goal": "Switch to rogue tab",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 202,
                "opener_tab_id": 999,  # Rogue tab not in tabs list!
                "tabs": [
                    {"tab_id": 200, "url": "https://example.com"},
                    {"tab_id": 202, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Suppressed because tab 999 is not in session tabs
        assert data["switch_tab_id"] is None
        assert not any(s.get("tab_id") == 999 for s in data["steps"])


# ── 4. Single-Tab Fallback under Kill-Switch Tests ────────────────────────────

class TestSingleTabFallback:
    """Verifies single-tab fallback behavior when MULTITAB_ENABLED is false."""

    def test_single_tab_fallback_under_kill_switch(self, api_client, monkeypatch):
        monkeypatch.setenv("MULTITAB_ENABLED", "false")

        payload = {
            "goal": "Authorize in popup",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [{"id": "auth-btn", "role": "button", "tag": "button", "inner_text": "Authorize"}],
            "capabilities": ["switch_tab", "tab_context"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com"},
                    {"tab_id": 101, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        # Under kill-switch: multi-tab directives are strictly suppressed
        assert data["close_tab"] is None
        assert data["switch_tab_id"] is None
        assert not any(s.get("action") == "switch_tab" for s in data["steps"])


# ── 5. TabContext Ingestion & Security Gates Tests ───────────────────────────

class TestTabContextSecurityGates:
    """Tests cross-origin gating, popup blocked interception, and close hints."""

    def test_cross_origin_boundary_requires_confirmation(self, api_client):
        """Cross-origin child popup with unconfirmed origin pauses execution for confirmation."""
        payload = {
            "goal": "Sign in with provider",
            "current_url": "https://idp.external-service.org/login",
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 50,
                "opener_tab_id": 40,
                "tabs": [
                    {"tab_id": 40, "url": "https://example.com/dashboard", "is_opener": True},
                    {"tab_id": 50, "url": "https://idp.external-service.org/login", "is_child": True},
                ],
                "origin_confirmed": False,  # Not yet confirmed!
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "requires_confirmation"
        assert data["requires_confirmation"] is True
        assert data["requires_origin_confirmation"] is True
        assert "Cross-origin window detected" in data["reply"]

    def test_cross_origin_boundary_confirmed_proceeds(self, api_client):
        """Confirmed cross-origin child popup does not halt for origin confirmation."""
        payload = {
            "goal": "Sign in with provider",
            "current_url": "https://idp.external-service.org/login",
            "dom_map": [{"id": "login-input", "role": "textbox", "tag": "input"}],
            "tab_context": {
                "self_tab_id": 50,
                "opener_tab_id": 40,
                "tabs": [
                    {"tab_id": 40, "url": "https://example.com/dashboard", "is_opener": True},
                    {"tab_id": 50, "url": "https://idp.external-service.org/login", "is_child": True},
                ],
                "origin_confirmed": True,  # Confirmed!
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["requires_origin_confirmation"] is False
        assert data["status"] != "requires_confirmation" or not data.get("requires_origin_confirmation")

    def test_cross_origin_confirmation_resumption_yes(self, api_client):
        """User responding 'yes' to origin confirmation prompt clears gate."""
        # Initial paused state
        initial_state = GoalState(
            goal="Sign in with provider",
            current_url="https://idp.external-service.org/login",
            status="requires_confirmation",
            requires_confirmation=True,
            confirmation_prompt="Notice: Cross-origin window detected",
        )

        payload = {
            "goal": "Sign in with provider",
            "current_url": "https://idp.external-service.org/login",
            "dom_map": [],
            "goal_state": initial_state.model_dump(),
            "user_response": "Yes, proceed",
            "tab_context": {
                "self_tab_id": 50,
                "opener_tab_id": 40,
                "tabs": [
                    {"tab_id": 40, "url": "https://example.com/dashboard", "is_opener": True},
                    {"tab_id": 50, "url": "https://idp.external-service.org/login", "is_child": True},
                ],
                "origin_confirmed": False,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["requires_origin_confirmation"] is False
        assert data["goal_state"]["requires_confirmation"] is False

    def test_popup_blocked_emits_assisted_click(self, api_client):
        """When resume_reason='popup_blocked', backend returns assisted_click payload."""
        payload = {
            "goal": "Open login popup",
            "current_url": "https://example.com/login",
            "dom_map": [
                {"id": "btn-sso", "role": "button", "tag": "button", "text": "Sign in with SSO", "attributes": {"aria-haspopup": "true"}},
            ],
            "capabilities": ["assisted_click", "switch_tab", "tab_context"],
            "tab_context": {
                "self_tab_id": 10,
                "opener_tab_id": None,
                "tabs": [{"tab_id": 10, "url": "https://example.com/login"}],
                "resume_reason": "popup_blocked",
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["assisted_click"] is not None
        assert data["assisted_click"]["element_id"] == "btn-sso"
        assert "popup was blocked" in data["assisted_click"]["prompt"].lower()


# ── 6. Handoff Budget Enforcement Tests ──────────────────────────────────────

class TestHandoffBudget:
    """Verifies that budget.handoff_count is tracked and max_handoffs is enforced."""

    def test_handoff_count_increments_on_switch(self, api_client):
        """Tab transition increments goal_state.budget.handoff_count."""
        state = GoalState(
            goal="Multi-tab task",
            current_url="https://auth.example.com",
            budget=Budget(max_handoffs=4, handoff_count=1),
        )

        payload = {
            "goal": "Multi-tab task",
            "current_url": "https://auth.example.com",
            "dom_map": [],
            "goal_state": state.model_dump(),
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": "https://example.com"},
                    {"tab_id": 2, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["goal_state"]["budget"]["handoff_count"] == 2
        assert data["switch_tab_id"] == 1

    def test_handoff_budget_exhaustion_terminates_goal(self, api_client):
        """Exceeding max_handoffs terminates goal with goal_failed."""
        state = GoalState(
            goal="Multi-tab task",
            current_url="https://auth.example.com",
            budget=Budget(max_handoffs=4, handoff_count=4),
        )

        payload = {
            "goal": "Multi-tab task",
            "current_url": "https://auth.example.com",
            "dom_map": [],
            "goal_state": state.model_dump(),
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": "https://example.com"},
                    {"tab_id": 2, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "goal_failed"
        assert "maximum allowed tab handoffs" in data["reply"]


# ── 7. Multi-Tab Golden Replay Multi-Step Flow ───────────────────────────────

class TestMultiTabGoldenReplay:
    """End-to-end multi-step multi-window golden replay scenario."""

    def test_golden_replay_oauth_flow(self, api_client):
        """
        Executes a 4-hop multi-tab replay:
        - Hop 1: Opener tab triggers SSO login.
        - Hop 2: Child popup adopted with resume_reason='child_ready'.
        - Hop 3: Child popup auth completed, emits close_hint=True. Directs switch back to opener.
        - Hop 4: Opener resumes and verifier marks goal_complete.
        """
        # ── Hop 1: Opener page (tab 100) ──
        hop1_payload = {
            "goal": "Log in with SSO and check my dashboard",
            "current_url": "https://example.com/login",
            "dom_map": [
                {"id": "btn-sso", "role": "button", "tag": "button", "inner_text": "Sign in with SSO"},
            ],
            "capabilities": ["switch_tab", "tab_context", "assisted_click"],
            "tab_context": {
                "self_tab_id": 100,
                "opener_tab_id": None,
                "tabs": [{"tab_id": 100, "url": "https://example.com/login", "is_opener": True, "is_active": True}],
                "resume_reason": "initial",
            },
        }

        res1 = api_client.post("/v1/chat/goal_step", json=hop1_payload, headers=AUTH_HEADERS)
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["status"] == "in_progress"
        state1 = data1["goal_state"]
        assert len(state1["milestones"]) >= 1

        # ── Hop 2: Child popup window adopted (tab 101) ──
        hop2_payload = {
            "goal": "Log in with SSO and check my dashboard",
            "current_url": "https://auth.example.com/login",
            "dom_map": [
                {"id": "auth-allow-btn", "role": "button", "tag": "button", "inner_text": "Authorize Identity"},
            ],
            "goal_state": state1,
            "capabilities": ["switch_tab", "tab_context", "assisted_click"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/login", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/login", "is_child": True, "is_active": True},
                ],
                "resume_reason": "child_ready",
                "origin_confirmed": True,
                "close_hint": False,
            },
        }

        res2 = api_client.post("/v1/chat/goal_step", json=hop2_payload, headers=AUTH_HEADERS)
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["status"] == "in_progress"
        state2 = data2["goal_state"]

        # ── Hop 3: Child popup auth completed (close_hint=True) ──
        hop3_payload = {
            "goal": "Log in with SSO and check my dashboard",
            "current_url": "https://auth.example.com/callback?success=true",
            "dom_map": [],
            "goal_state": state2,
            "capabilities": ["switch_tab", "tab_context", "assisted_click"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/login", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/callback", "is_child": True},
                ],
                "resume_reason": "child_ready",
                "origin_confirmed": True,
                "close_hint": True,
            },
        }

        res3 = api_client.post("/v1/chat/goal_step", json=hop3_payload, headers=AUTH_HEADERS)
        assert res3.status_code == 200
        data3 = res3.json()
        assert data3["close_tab"] is True
        assert data3["switch_tab_id"] == 100
        assert data3["steps"][0]["action"] == "switch_tab"
        assert data3["steps"][0]["tab_id"] == 100
        assert data3["goal_state"]["budget"]["handoff_count"] == 1
        state3 = data3["goal_state"]

        # ── Hop 4: Opener page resumed after popup close ──
        # Mark active milestone as target URL reached or verified
        state3["milestones"][0]["target_url"] = "https://example.com/dashboard"
        hop4_payload = {
            "goal": "Log in with SSO and check my dashboard",
            "current_url": "https://example.com/dashboard",
            "dom_map": [
                {"id": "user-profile", "role": "main", "tag": "div", "inner_text": "Welcome to your Dashboard"},
            ],
            "goal_state": state3,
            "last_action_result": {"status": "success", "action": "switch_tab"},
            "capabilities": ["switch_tab", "tab_context", "assisted_click"],
            "tab_context": {
                "self_tab_id": 100,
                "opener_tab_id": None,
                "tabs": [{"tab_id": 100, "url": "https://example.com/dashboard", "is_opener": True, "is_active": True}],
                "resume_reason": "child_ready",
                "origin_confirmed": True,
            },
        }

        res4 = api_client.post("/v1/chat/goal_step", json=hop4_payload, headers=AUTH_HEADERS)
        assert res4.status_code == 200
        data4 = res4.json()
        # Verifier Rule 4 URL transition or LLM verifier reaches goal_complete
        assert data4["status"] == "goal_complete"
        assert data4["goal_state"]["status"] == "goal_complete"

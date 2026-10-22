"""
Empirical Adversarial Stress Test Suite: Backend Multi-Tab Reasoning, Capability Gating, & Kill-Switch
File: backend/tests/test_challenger_m4_stress.py

Challenger 1 (Backend Stress Challenger) — Project Atlas Milestone 4 (v0.2.0 -> v0.3.0)

Adversarial Challenge Dimensions:
1. Capability Gating Bypass Attempts:
   - Omitting 'switch_tab' capability.
   - Empty capabilities list [].
   - Null capabilities payload.
   - Corrupted / casing / whitespace / injection capability strings.
   - Injected switch_tab steps preserved vs filtered when mixed with other actions.
2. Target Tab ID Manipulation:
   - Non-existent target tab ID (not in tabs).
   - Negative tab IDs (-1, -999).
   - Massive tab IDs (int64 overflow / boundary).
   - Opener pointing to self_tab_id (reflexive switch loop).
   - Empty tabs list with non-null opener.
   - Duplicate tab IDs in session tabs.
   - Cross-session foreign tab IDs.
3. MULTITAB_ENABLED Toggle & Kill-Switch:
   - Various disabled truth values: "0", "false", "no", "off", "disabled", uppercase & padded.
   - Enabled truth values: "1", "true", "yes", "on", "enabled", default fallback.
   - Precedence: MULTITAB_ENABLED vs ATLAS_MULTITAB_ENABLED.
   - Single-tab fallback strictness (strips close_tab, switch_tab_id, switch_tab steps).
   - Concurrent evaluation under multi-threaded execution.
4. Malformed or Partial tab_context Payloads:
   - Omitted tab_context (legacy compatibility).
   - Missing required fields (self_tab_id, url in TabInfo) -> HTTP 422.
   - Malformed data types (string for tab_id, dict for tabs, invalid bools) -> HTTP 422.
   - XSS / SQLi / null byte fuzzing in resume_reason and string fields.
   - Cross-origin boundary security: subdomains, different ports, scheme mismatch, confirmation cancel.
   - Scalability / stress with 500 session tabs.
"""

import os
import concurrent.futures
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
)
from app.routes.config import is_multitab_enabled
from app.routes.chat import _apply_capability_and_tab_gating, _get_url_origin

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
AUTH_HEADERS = {"X-Atlas-Key": DEMO_API_KEY}


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforces deterministic mock LLM provider across all stress tests."""
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


# =============================================================================
# 1. CAPABILITY GATING BYPASS ATTEMPTS
# =============================================================================

class TestChallengerCapabilityGatingBypass:
    """Adversarial stress-testing of capability gating rails."""

    def test_bypass_omitting_switch_tab(self, api_client):
        """Client declaring other capabilities but omitting switch_tab must NEVER receive switch_tab."""
        payload = {
            "goal": "Authorize OAuth flow in popup",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["assisted_click", "tab_context", "form_fill"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app", "is_opener": True},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth", "is_child": True},
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

    def test_bypass_empty_capabilities(self, api_client):
        """Client explicitly sending empty list capabilities [] must suppress all multi-tab actions."""
        payload = {
            "goal": "Authorize in popup",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": [],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app"},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth"},
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

    def test_bypass_null_capabilities_returns_422(self, api_client):
        """Explicitly sending null for capabilities must be rejected by Pydantic schema with 422."""
        payload = {
            "goal": "Null capabilities attack",
            "current_url": "https://auth.example.com/oauth",
            "capabilities": None,  # Null capabilities
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    def test_bypass_non_string_capability_items_returns_422(self, api_client):
        """Capabilities list containing complex objects or dicts must be rejected with 422."""
        payload = {
            "goal": "Invalid capability types attack",
            "current_url": "https://auth.example.com/oauth",
            "capabilities": [{"action": "switch_tab", "allow": True}],
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    @pytest.mark.parametrize("corrupt_cap", [
        "SWITCH_TAB",           # Uppercase
        " switch_tab",          # Leading space
        "switch_tab ",          # Trailing space
        "switch_tab\x00",       # Null byte injection
        "switch_tab_v2",        # Suffix
        "switch_tab.admin",     # Dot notation
        "switch-tab",           # Kebab-case
        "__proto__",            # Prototype pollution attempt
        "*",                    # Wildcard attempt
        "switch_tabs",          # Plural
    ])
    def test_bypass_invalid_capability_strings(self, api_client, corrupt_cap):
        """Near-miss or corrupted capability strings must NOT grant switch_tab capability."""
        payload = {
            "goal": "Authorize OAuth flow in popup",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": [corrupt_cap],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://example.com/app"},
                    {"tab_id": 101, "url": "https://auth.example.com/oauth"},
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

    def test_mixed_steps_filtering_preserves_legitimate_actions(self):
        """
        Direct test of _apply_capability_and_tab_gating:
        When capabilities lack switch_tab, switch_tab actions are removed,
        but click/fill/scroll steps must remain untouched.
        """
        tab_ctx = TabContext(
            self_tab_id=101,
            opener_tab_id=100,
            tabs=[
                TabInfo(tab_id=100, url="https://example.com"),
                TabInfo(tab_id=101, url="https://auth.example.com"),
            ],
            close_hint=False,
            origin_confirmed=True,
        )
        resp = GoalStepResponse(
            status="in_progress",
            goal_state=GoalState(goal="Test goal", current_url="https://auth.example.com"),
            reply="Mixed actions step",
            steps=[
                PlanStep(action="click", element_id="btn-submit", description="Click submit"),
                PlanStep(action="switch_tab", tab_id=100, description="Switch to opener"),
                PlanStep(action="scroll", value="down", description="Scroll page"),
            ],
            switch_tab_id=100,
            close_tab=True,
        )

        # Without switch_tab capability:
        filtered = _apply_capability_and_tab_gating(
            resp=resp,
            multitab_enabled=True,
            capabilities=["tab_context", "assisted_click"],  # NO switch_tab
            tab_context=tab_ctx,
        )

        assert filtered.switch_tab_id is None
        action_names = [s.action for s in filtered.steps]
        assert action_names == ["click", "scroll"]
        assert "switch_tab" not in action_names


# =============================================================================
# 2. TARGET TAB ID MANIPULATION
# =============================================================================

class TestChallengerTargetTabIdManipulation:
    """Adversarial stress-testing against tab ID manipulation, cross-session hijacking, and boundaries."""

    def test_nonexistent_tab_id_in_close_hint(self, api_client):
        """Attempting to switch to opener_tab_id not present in tabs list must be suppressed."""
        payload = {
            "goal": "Switch to rogue tab",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 202,
                "opener_tab_id": 88888,  # Rogue tab not in session
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
        assert data["switch_tab_id"] is None
        assert not any(s.get("tab_id") == 88888 for s in data["steps"])

    @pytest.mark.parametrize("malformed_id", [-1, -999, -2147483648])
    def test_negative_tab_id_handling(self, api_client, malformed_id):
        """Negative tab IDs as opener target must be rejected when not in tabs list."""
        payload = {
            "goal": "Negative tab ID attack",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 100,
                "opener_tab_id": malformed_id,
                "tabs": [{"tab_id": 100, "url": "https://auth.example.com"}],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] is None
        assert not any(s.get("tab_id") == malformed_id for s in data["steps"])

    def test_empty_tabs_list_with_opener_id(self, api_client):
        """If tab_context has opener_tab_id but tabs list is empty, switch_tab must be suppressed."""
        payload = {
            "goal": "Empty tabs exploit",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [],  # Empty tabs list!
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] is None
        assert not any(s.get("action") == "switch_tab" for s in data["steps"])

    def test_duplicate_tab_ids_in_session(self, api_client):
        """Session tabs with duplicate IDs should resolve safely without crashing or leaking."""
        payload = {
            "goal": "Duplicate tabs test",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,
                "tabs": [
                    {"tab_id": 100, "url": "https://legit.example.com"},
                    {"tab_id": 100, "url": "https://phishing.example.com"},
                    {"tab_id": 101, "url": "https://auth.example.com"},
                ],
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] == 100

    def test_reflexive_tab_switch_prevention(self, api_client):
        """When self_tab_id == opener_tab_id, origin confirmation should not loop or falsely trigger."""
        payload = {
            "goal": "Reflexive tab",
            "current_url": "https://example.com/page",
            "dom_map": [{"id": "btn", "role": "button", "tag": "button", "inner_text": "Click"}],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 50,
                "opener_tab_id": 50,  # Same tab!
                "tabs": [{"tab_id": 50, "url": "https://example.com/page"}],
                "origin_confirmed": False,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Should not require origin confirmation because self_tab_id == opener_tab_id
        assert data.get("requires_origin_confirmation") is not True


# =============================================================================
# 3. MULTITAB_ENABLED TOGGLE & KILL-SWITCH CONCURRENCY
# =============================================================================

class TestChallengerKillSwitchAndConcurrency:
    """Stress-testing the MULTITAB_ENABLED toggle under edge cases and multithreading."""

    @pytest.mark.parametrize("falsy_str", [
        "0", "false", "no", "off", "disabled",
        "FALSE", "False", "NO", "No", "OFF", "DISABLED", "Disabled",
        "  false  ", " 0\n", "\toff\t",
    ])
    def test_all_falsy_env_var_variants(self, monkeypatch, falsy_str):
        """Tests that all case variations and padded falsy strings disable multi-tab."""
        monkeypatch.setenv("MULTITAB_ENABLED", falsy_str)
        assert is_multitab_enabled() is False

    @pytest.mark.parametrize("truthy_str", [
        "1", "true", "yes", "on", "enabled",
        "TRUE", "True", "YES", "ON", "ENABLED",
        "  true  ",
    ])
    def test_all_truthy_env_var_variants(self, monkeypatch, truthy_str):
        """Tests that truthy strings keep multi-tab enabled."""
        monkeypatch.setenv("MULTITAB_ENABLED", truthy_str)
        assert is_multitab_enabled() is True

    def test_precedence_multitab_over_atlas(self, monkeypatch):
        """MULTITAB_ENABLED must take precedence over ATLAS_MULTITAB_ENABLED."""
        monkeypatch.setenv("MULTITAB_ENABLED", "false")
        monkeypatch.setenv("ATLAS_MULTITAB_ENABLED", "true")
        assert is_multitab_enabled() is False

        monkeypatch.setenv("MULTITAB_ENABLED", "true")
        monkeypatch.setenv("ATLAS_MULTITAB_ENABLED", "false")
        assert is_multitab_enabled() is True

    def test_fallback_when_multitab_unset(self, monkeypatch):
        """When MULTITAB_ENABLED is unset, ATLAS_MULTITAB_ENABLED governs."""
        monkeypatch.delenv("MULTITAB_ENABLED", raising=False)
        monkeypatch.setenv("ATLAS_MULTITAB_ENABLED", "false")
        assert is_multitab_enabled() is False

        monkeypatch.setenv("ATLAS_MULTITAB_ENABLED", "true")
        assert is_multitab_enabled() is True

    def test_empty_string_env_var_defaults_to_true(self, monkeypatch):
        """Empty string MULTITAB_ENABLED='' defaults safely to True."""
        monkeypatch.setenv("MULTITAB_ENABLED", "")
        assert is_multitab_enabled() is True

    def test_multithreaded_concurrent_toggle_evaluation(self, monkeypatch):
        """Evaluates is_multitab_enabled() across 50 concurrent threads during toggle changes."""
        results = []

        def worker(thread_idx: int):
            # Interleave reads with monkeypatch toggle
            if thread_idx % 2 == 0:
                monkeypatch.setenv("MULTITAB_ENABLED", "true")
            else:
                monkeypatch.setenv("MULTITAB_ENABLED", "false")
            return is_multitab_enabled()

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(worker, i) for i in range(50)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        assert len(results) == 50
        assert all(isinstance(r, bool) for r in results)

    def test_concurrent_config_requests(self, api_client):
        """Fires 20 concurrent HTTP requests to /v1/config to verify stability and response consistency."""
        def call_config():
            return api_client.get("/v1/config")

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(call_config) for _ in range(20)]
            responses = [f.result() for f in concurrent.futures.as_completed(futures)]

        for res in responses:
            assert res.status_code == 200
            data = res.json()
            assert "multiTab" in data
            assert data["version"] == "0.3.0"

    def test_single_tab_fallback_strips_close_tab_and_switch_tab_id(self, api_client, monkeypatch):
        """When kill-switch is active, verify that close_tab and switch_tab_id are strictly None."""
        monkeypatch.setenv("MULTITAB_ENABLED", "false")

        payload = {
            "goal": "Child window completion attempt",
            "current_url": "https://auth.example.com/oauth",
            "dom_map": [],
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
        assert data["close_tab"] is None
        assert data["switch_tab_id"] is None
        assert not any(s.get("action") == "switch_tab" for s in data["steps"])


# =============================================================================
# 4. MALFORMED OR PARTIAL TAB_CONTEXT PAYLOADS
# =============================================================================

class TestChallengerMalformedTabContext:
    """Stress-testing schema validation, boundary conditions, and fuzzing on tab_context."""

    def test_omitted_tab_context_succeeds_as_legacy(self, api_client):
        """Omission of tab_context operates in pure single-tab mode without error."""
        payload = {
            "goal": "Search documentation",
            "current_url": "https://example.com/docs",
            "dom_map": [{"id": "search-input", "role": "searchbox", "tag": "input"}],
            "contract_version": 2,
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] is None
        assert data["close_tab"] is None

    def test_empty_dict_tab_context_returns_422(self, api_client):
        """Sending empty dict {} for tab_context violates required self_tab_id field."""
        payload = {
            "goal": "Malformed tab context",
            "current_url": "https://example.com",
            "tab_context": {},  # Missing required self_tab_id
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    @pytest.mark.parametrize("invalid_self_id", ["not_an_int", None, [100], {"id": 100}])
    def test_invalid_self_tab_id_type_returns_422(self, api_client, invalid_self_id):
        """Non-integer self_tab_id triggers 422 Unprocessable Entity."""
        payload = {
            "goal": "Invalid self_tab_id",
            "current_url": "https://example.com",
            "tab_context": {
                "self_tab_id": invalid_self_id,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    def test_missing_tab_id_in_tabs_list_returns_422(self, api_client):
        """TabInfo missing required tab_id returns 422."""
        payload = {
            "goal": "Missing tab_id",
            "current_url": "https://example.com",
            "tab_context": {
                "self_tab_id": 10,
                "tabs": [{"url": "https://example.com"}],  # Missing tab_id
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    def test_missing_url_in_tabs_list_returns_422(self, api_client):
        """TabInfo missing required url returns 422."""
        payload = {
            "goal": "Missing url",
            "current_url": "https://example.com",
            "tab_context": {
                "self_tab_id": 10,
                "tabs": [{"tab_id": 10}],  # Missing url
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 422

    @pytest.mark.parametrize("fuzz_str", [
        "'; DROP TABLE tabs; --",                   # SQL injection
        "<script>alert(document.cookie)</script>",  # XSS
        "A" * 5000,                                 # Buffer flood
        "../../../etc/passwd",                      # Path traversal
        "\x00\x01\x02\x03",                         # Binary control chars
    ])
    def test_fuzzing_resume_reason_safe_handling(self, api_client, fuzz_str):
        """Adversarial / injection strings in resume_reason must be handled without crash or 500."""
        payload = {
            "goal": "Fuzzing test",
            "current_url": "https://example.com",
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 1,
                "resume_reason": fuzz_str,
                "tabs": [{"tab_id": 1, "url": "https://example.com"}],
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        # Must return clean 200 or 422 (never 500 internal server error)
        assert res.status_code in (200, 422)

    def test_high_volume_tabs_scalability_stress(self, api_client):
        """Stress-tests active session with 500 registered tabs for performance and memory safety."""
        large_tabs = [
            {"tab_id": i, "url": f"https://example{i}.org/page", "title": f"Tab {i}"}
            for i in range(500)
        ]
        payload = {
            "goal": "Scalability stress",
            "current_url": "https://example499.org/page",
            "dom_map": [],
            "capabilities": ["switch_tab"],
            "tab_context": {
                "self_tab_id": 499,
                "opener_tab_id": 0,
                "tabs": large_tabs,
                "close_hint": True,
                "origin_confirmed": True,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["switch_tab_id"] == 0
        assert data["steps"][0]["tab_id"] == 0


# =============================================================================
# 5. CROSS-ORIGIN SECURITY & ORIGIN PARSING BOUNDARIES
# =============================================================================

class TestChallengerCrossOriginSecurity:
    """Stress-testing URL origin resolution, ports, subdomains, and user confirmations."""

    @pytest.mark.parametrize("opener_url,child_url,expected_cross_origin", [
        ("https://example.com/app", "https://example.com/other", False),               # Same origin
        ("https://example.com/app", "https://sub.example.com/login", True),            # Subdomain mismatch
        ("http://example.com/app", "https://example.com/app", True),                   # Scheme mismatch
        ("https://example.com:8080/app", "https://example.com:8081/app", True),        # Port mismatch
    ])
    def test_cross_origin_detection_matrix(self, api_client, opener_url, child_url, expected_cross_origin):
        """Validates cross-origin detection across scheme, domain, subdomain, and port variations."""
        payload = {
            "goal": "Cross origin test",
            "current_url": child_url,
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": opener_url, "is_opener": True},
                    {"tab_id": 2, "url": child_url, "is_child": True},
                ],
                "origin_confirmed": False,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()

        if expected_cross_origin:
            assert data["requires_origin_confirmation"] is True
            assert data["status"] == "requires_confirmation"
        else:
            assert data.get("requires_origin_confirmation") is not True

    def test_defect_cross_origin_default_port_normalization(self, api_client):
        """
        Adversarial Finding #1:
        RFC 6454 / W3C HTML Living Standard states default ports (80/443) should serialize to origin without port.
        Because _get_url_origin uses urlsplit without stripping default ports, 'https://example.com:443' and
        'https://example.com' are treated as cross-origin, prompting the user unnecessarily.
        """
        payload = {
            "goal": "Cross origin default port test",
            "current_url": "https://example.com/app",
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": "https://example.com:443/app", "is_opener": True},
                    {"tab_id": 2, "url": "https://example.com/app", "is_child": True},
                ],
                "origin_confirmed": False,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Should NOT require origin confirmation since they are the exact same origin
        assert data.get("requires_origin_confirmation") is not True

    def test_defect_cross_origin_bypass_when_opener_omitted_from_tabs(self, api_client):
        """
        Adversarial Finding #2:
        In chat.py:526-530, if opener_tab is not in tab_ctx.tabs and prior_url is None:
        opener_url is None, op_orig is '', and 'if op_orig and curr_orig and op_orig != curr_orig'
        evaluates to False!
        Attack: An unconfirmed popup on https://attacker.com claiming opener_tab_id: 100 with tabs: []
        evades origin confirmation and proceeds autonomously!
        """
        payload = {
            "goal": "Cross origin evasion attack",
            "current_url": "https://attacker.com/steal",
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 101,
                "opener_tab_id": 100,  # Opener ID provided
                "tabs": [{"tab_id": 101, "url": "https://attacker.com/steal"}],  # Opener 100 omitted!
                "origin_confirmed": False,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Fail-safe security requires origin confirmation when opener cannot be verified
        assert data.get("requires_origin_confirmation") is True

    def test_defect_cross_origin_bypass_for_non_http_schemes(self, api_client):
        """
        Adversarial Finding #3:
        In chat.py:209-210, _get_url_origin returns '' if netloc is empty.
        Non-HTTP schemes like data:text/html or file:/// have empty netloc, causing curr_orig to be '',
        bypassing the cross-origin origin confirmation gate.
        """
        payload = {
            "goal": "Data URL evasion",
            "current_url": "data:text/html,<button>steal</button>",
            "dom_map": [],
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": "https://example.com/app", "is_opener": True},
                    {"tab_id": 2, "url": "data:text/html,<button>steal</button>", "is_child": True},
                ],
                "origin_confirmed": False,
            },
        }
        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        # Should require origin confirmation for non-same-origin data: URL
        assert data.get("requires_origin_confirmation") is True

    def test_cross_origin_confirmation_cancel_flow(self, api_client):
        """User responding 'cancel' or 'no' halts consequential action and returns in_progress without executing."""
        initial_state = GoalState(
            goal="Sign in with OAuth",
            current_url="https://idp.evil.com/login",
            status="requires_confirmation",
            requires_confirmation=True,
            confirmation_prompt="Notice: Cross-origin window detected",
        )

        payload = {
            "goal": "Sign in with OAuth",
            "current_url": "https://idp.evil.com/login",
            "dom_map": [],
            "goal_state": initial_state.model_dump(),
            "user_response": "No, cancel",
            "tab_context": {
                "self_tab_id": 2,
                "opener_tab_id": 1,
                "tabs": [
                    {"tab_id": 1, "url": "https://example.com"},
                    {"tab_id": 2, "url": "https://idp.evil.com"},
                ],
                "origin_confirmed": False,
            },
        }

        res = api_client.post("/v1/chat/goal_step", json=payload, headers=AUTH_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "in_progress"
        assert data["requires_confirmation"] is False
        assert len(data["steps"]) == 0
        assert "cancelled" in data["reply"].lower()

    def test_url_origin_helper_edge_cases(self):
        """Tests _get_url_origin under edge cases: None, empty, malformed, non-HTTP schemes."""
        assert _get_url_origin(None) == ""
        assert _get_url_origin("") == ""
        assert _get_url_origin("javascript:void(0)") == ""
        assert _get_url_origin("data:text/html,hello") == ""
        assert _get_url_origin("https://EXAMPLE.COM/Path") == "https://example.com"
        assert _get_url_origin("http://localhost:3000/#fragment") == "http://localhost:3000"

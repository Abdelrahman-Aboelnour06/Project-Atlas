"""
test_websocket.py — WebSocket endpoint tests.

Covers:
  - type:command flow (auth → LLM → parser → response)
  - type:simplify flow (auth → simplify pipeline → response)
  - Invalid API key rejection on every message
  - Malformed JSON handling
  - Missing required fields
  - Correct response shape per Contract 2 (command) and Contract 5 (simplify)

LLM calls are mocked — no Ollama/NIM needed to run these.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


DEMO_API_KEY  = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
WRONG_API_KEY = "atlas_thisiswrongdonotuse000000000000"

SAMPLE_DOM_MAP = [
    {
        "id": "atlas-001", "tag": "button", "type": None,
        "inner_text": "Checkout", "placeholder": None,
        "aria_label": "Checkout", "href": None, "name": None, "role": None,
    },
    {
        "id": "atlas-002", "tag": "input", "type": "email",
        "inner_text": None, "placeholder": "Email",
        "aria_label": "Email", "href": None, "name": "email", "role": None,
    },
]

VALID_COMMAND_RESPONSE = json.dumps({
    "action":     "click",
    "element_id": "atlas-001",
    "value":      None,
    "message":    "Clicked Checkout button",
})

VALID_SIMPLIFY_RESPONSE = json.dumps([
    {"element_id": "atlas-001", "label": "Checkout button", "category": "button"},
    {"element_id": "atlas-002", "label": "Email field",     "category": "input"},
])


@pytest.fixture(scope="module")
def ws_client():
    """TestClient with LLM + DB mocked."""
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()
        mock_db.add    = MagicMock()
        mock_db.commit = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: key == DEMO_API_KEY)), \
         patch("app.agent.llm_client.call_llm",
               new=AsyncMock(return_value=VALID_COMMAND_RESPONSE)), \
         patch("app.agent.simplify_prompt.build_simplify_prompt",
               return_value="mock simplify prompt"), \
         patch("app.agent.simplify_parser.parse_simplify_response",
               return_value=[
                   {"element_id": "atlas-001", "label": "Checkout button", "category": "button"},
                   {"element_id": "atlas-002", "label": "Email field", "category": "input"},
               ]):
        with TestClient(app) as c:
            yield c

    app.dependency_overrides.clear()


# ── type:command flow ─────────────────────────────────────────────────────────

class TestCommandFlow:
    def _send(self, client, payload: dict) -> dict:
        with client.websocket_connect("/v1/agent") as ws:
            ws.send_json(payload)
            return ws.receive_json()

    def _valid_payload(self, command="click checkout"):
        return {
            "session_id": "test-001",
            "api_key":    DEMO_API_KEY,
            "url":        "https://demo.atlas.com",
            "dom_map":    SAMPLE_DOM_MAP,
            "command":    command,
            "type":       "command",
        }

    def test_valid_command_returns_success(self, ws_client):
        response = self._send(ws_client, self._valid_payload())
        assert response["status"] == "success"

    def test_response_has_action_field(self, ws_client):
        response = self._send(ws_client, self._valid_payload())
        assert "action" in response
        assert response["action"] in ("click", "fill", "scroll", "focus")

    def test_response_has_element_id(self, ws_client):
        response = self._send(ws_client, self._valid_payload())
        assert "element_id" in response
        assert response["element_id"] is not None

    def test_response_has_message(self, ws_client):
        response = self._send(ws_client, self._valid_payload())
        assert "message" in response
        assert len(response["message"]) > 0

    def test_response_shape_matches_contract_2(self, ws_client):
        """Contract 2: status, action, element_id, value, message."""
        response = self._send(ws_client, self._valid_payload())
        for field in ("status", "action", "element_id", "value", "message"):
            assert field in response, f"Contract 2 field '{field}' missing from response"

    def test_invalid_api_key_returns_error(self, ws_client):
        payload = self._valid_payload()
        payload["api_key"] = WRONG_API_KEY
        response = self._send(ws_client, payload)
        assert response["status"] == "error"

    def test_api_key_validated_on_every_message(self, ws_client):
        """
        Auth must run per-message, not just on connect.
        Send valid first, then invalid — second must be rejected.
        """
        with ws_client.websocket_connect("/v1/agent") as ws:
            ws.send_json(self._valid_payload())
            r1 = ws.receive_json()
            assert r1["status"] == "success"

            invalid = self._valid_payload()
            invalid["api_key"] = WRONG_API_KEY
            ws.send_json(invalid)
            r2 = ws.receive_json()
            assert r2["status"] == "error"

    def test_malformed_json_returns_error(self, ws_client):
        with ws_client.websocket_connect("/v1/agent") as ws:
            ws.send_text("this is not json {{{{")
            response = ws.receive_json()
        assert response["status"] == "error"

    def test_missing_command_field_returns_error(self, ws_client):
        payload = self._valid_payload()
        del payload["command"]
        response = self._send(ws_client, payload)
        assert response["status"] == "error"

    def test_missing_dom_map_returns_error(self, ws_client):
        payload = self._valid_payload()
        del payload["dom_map"]
        response = self._send(ws_client, payload)
        assert response["status"] == "error"

    def test_missing_type_field_returns_error(self, ws_client):
        """Contract 1 v1.1 requires `type` — missing type must be rejected."""
        payload = self._valid_payload()
        del payload["type"]
        response = self._send(ws_client, payload)
        assert response["status"] == "error"

    def test_unknown_type_returns_error(self, ws_client):
        payload = self._valid_payload()
        payload["type"] = "delete_everything"
        response = self._send(ws_client, payload)
        assert response["status"] == "error"


# ── type:simplify flow ────────────────────────────────────────────────────────

class TestSimplifyFlow:
    def _simplify_payload(self):
        return {
            "session_id": "test-002",
            "api_key":    DEMO_API_KEY,
            "url":        "https://demo.atlas.com",
            "dom_map":    SAMPLE_DOM_MAP,
            "command":    "",
            "type":       "simplify",
        }

    def _send(self, client, payload: dict) -> dict:
        with client.websocket_connect("/v1/agent") as ws:
            ws.send_json(payload)
            return ws.receive_json()

    def test_simplify_returns_success_status(self, ws_client):
        response = self._send(ws_client, self._simplify_payload())
        assert response["status"] == "success"

    def test_simplify_response_has_elements_list(self, ws_client):
        """Contract 5: simplify response must have an `elements` array."""
        response = self._send(ws_client, self._simplify_payload())
        assert "elements" in response, (
            "Simplify response must have an 'elements' field (Contract 5) — "
            "check the agent.py dispatch block for type:'simplify'"
        )

    def test_simplify_elements_have_required_fields(self, ws_client):
        """Contract 5: each element needs element_id, label, category."""
        response = self._send(ws_client, self._simplify_payload())
        elements = response.get("elements", [])
        assert len(elements) > 0, "Simplify response must return at least one element"
        for el in elements:
            assert "element_id" in el, "Missing element_id in simplify element"
            assert "label"      in el, "Missing label in simplify element"
            assert "category"   in el, "Missing category in simplify element"

    def test_simplify_invalid_key_returns_error(self, ws_client):
        payload = self._simplify_payload()
        payload["api_key"] = WRONG_API_KEY
        response = self._send(ws_client, payload)
        assert response["status"] == "error"

    def test_simplify_and_command_both_work_in_same_session(self, ws_client):
        """
        A single WS connection should handle both simplify (on load)
        and command (on user action) without breaking.
        """
        with ws_client.websocket_connect("/v1/agent") as ws:
            # Page load → simplify
            ws.send_json(self._simplify_payload())
            r_simplify = ws.receive_json()
            assert r_simplify["status"] == "success"

            # User speaks → command
            ws.send_json({
                "session_id": "test-003",
                "api_key":    DEMO_API_KEY,
                "url":        "https://demo.atlas.com",
                "dom_map":    SAMPLE_DOM_MAP,
                "command":    "click checkout",
                "type":       "command",
            })
            r_command = ws.receive_json()
            assert r_command["status"] == "success"


# ── Rate limiting ──────────────────────────────────────────────────────────────
# Wiring only — app.agent.rate_limiter's own sliding-window logic has its
# own focused unit tests in test_rate_limiter.py. These confirm
# routes/agent.py actually calls it, in the right order, with the right
# response shape.

class TestRateLimiting:
    def _command_payload(self):
        return {
            "session_id": "test-004",
            "api_key":    DEMO_API_KEY,
            "url":        "https://demo.atlas.com",
            "dom_map":    SAMPLE_DOM_MAP,
            "command":    "click checkout",
            "type":       "command",
        }

    def _simplify_payload(self):
        return {
            "session_id": "test-005",
            "api_key":    DEMO_API_KEY,
            "url":        "https://demo.atlas.com",
            "dom_map":    SAMPLE_DOM_MAP,
            "command":    "",
            "type":       "simplify",
        }

    def test_rate_limited_command_returns_error(self, ws_client):
        with patch("app.agent.rate_limiter.check", return_value=False):
            with ws_client.websocket_connect("/v1/agent") as ws:
                ws.send_json(self._command_payload())
                response = ws.receive_json()
        assert response["status"] == "error"
        assert "rate limit" in response["message"].lower()

    def test_rate_limited_simplify_keeps_contract_5_shape(self, ws_client):
        """Even a rate-limit rejection must keep Contract 5's shape —
        `elements` present (empty), not just a bare error dict."""
        with patch("app.agent.rate_limiter.check", return_value=False):
            with ws_client.websocket_connect("/v1/agent") as ws:
                ws.send_json(self._simplify_payload())
                response = ws.receive_json()
        assert response["status"] == "error"
        assert response["elements"] == []

    def test_invalid_key_never_consumes_a_rate_limit_slot(self, ws_client):
        """Auth runs before the rate limiter — a wrong key must never
        reach (or spend a slot in) another tenant's bucket."""
        with patch("app.agent.rate_limiter.check") as mock_check:
            payload = self._command_payload()
            payload["api_key"] = WRONG_API_KEY
            with ws_client.websocket_connect("/v1/agent") as ws:
                ws.send_json(payload)
                response = ws.receive_json()
        assert response["status"] == "error"
        mock_check.assert_not_called()

    def test_connection_survives_a_rate_limit_rejection(self, ws_client):
        """Rate-limited requests follow the same rule as every other
        error on this endpoint: reply and keep the socket open, not
        close it — the next message on the same connection should still
        succeed once the limiter allows it again."""
        with ws_client.websocket_connect("/v1/agent") as ws:
            with patch("app.agent.rate_limiter.check", return_value=False):
                ws.send_json(self._command_payload())
                blocked = ws.receive_json()
            assert blocked["status"] == "error"

            ws.send_json(self._command_payload())
            allowed = ws.receive_json()
            assert allowed["status"] == "success"

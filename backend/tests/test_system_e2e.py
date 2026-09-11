"""
System End-to-End Test Suite.
Tests the complete multi-service Atlas workflow:
  1. Health check (/health)
  2. Session negotiation (/v1/session/start)
  3. WebSocket connection & handshake (/v1/agent)
  4. Full Simplify AI pipeline (Contract 5)
  5. Full Command AI pipeline (Contract 2)
  6. Accessibility issue reporting (/v1/audit/log)
  7. Fault resilience: recovery after malformed input
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

SAMPLE_DOM = [
    {
        "id": "atlas-001",
        "tag": "button",
        "type": None,
        "inner_text": "Proceed to Checkout",
        "placeholder": None,
        "aria_label": "Checkout button",
        "href": None,
        "name": None,
        "role": None,
    },
    {
        "id": "atlas-002",
        "tag": "input",
        "type": "text",
        "inner_text": None,
        "placeholder": "Enter promo code",
        "aria_label": "Promo Code",
        "href": None,
        "name": "promo",
        "role": None,
    },
]

MOCK_COMMAND_RESPONSE = json.dumps({
    "action": "click",
    "element_id": "atlas-001",
    "value": None,
    "message": "Clicked Proceed to Checkout",
})


@pytest.fixture(scope="module")
def e2e_client():
    from app.main import app
    from app.db.connection import get_db

    async def mock_db():
        db = AsyncMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        yield db

    app.dependency_overrides[get_db] = mock_db

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: key == DEMO_API_KEY)), \
         patch("app.agent.llm_client.call_llm",
               new=AsyncMock(return_value=MOCK_COMMAND_RESPONSE)), \
         patch("app.agent.simplify_prompt.build_simplify_prompt",
               return_value="mock simplify prompt"), \
         patch("app.agent.simplify_parser.parse_simplify_response",
               return_value=[
                   {"element_id": "atlas-001", "label": "Checkout", "category": "button"},
                   {"element_id": "atlas-002", "label": "Promo code", "category": "input"},
               ]):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()


class TestSystemEndToEnd:
    def test_complete_user_lifecycle(self, e2e_client):
        """
        Simulates an entire user session from start to finish.
        """
        # Step 1: Health check
        health_resp = e2e_client.get("/health")
        assert health_resp.status_code == 200
        health_data = health_resp.json()
        assert health_data["status"] == "ok"
        assert health_data["service"] == "atlas-backend"

        # Step 2: Session creation
        session_resp = e2e_client.post(
            "/v1/session/start",
            headers={"X-Atlas-Key": DEMO_API_KEY},
        )
        assert session_resp.status_code == 200
        session_id = session_resp.json()["session_id"]
        assert len(session_id) == 36  # Valid UUID length

        # Step 3 & 4: WebSocket connection and Simplify pipeline
        with e2e_client.websocket_connect("/v1/agent") as ws:
            # 3a. Handshake authentication
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            auth_ack = ws.receive_json()
            assert auth_ack["status"] == "ok"

            # 4. Simplify request
            ws.send_json({
                "session_id": session_id,
                "url": "http://localhost:5500",
                "dom_map": SAMPLE_DOM,
                "command": "",
                "type": "simplify",
            })
            simplify_res = ws.receive_json()
            assert simplify_res["status"] == "success"
            assert "elements" in simplify_res
            assert len(simplify_res["elements"]) == 2
            assert simplify_res["elements"][0]["element_id"] == "atlas-001"
            assert simplify_res["elements"][0]["category"] == "button"

            # 5. Voice Command request
            ws.send_json({
                "session_id": session_id,
                "url": "http://localhost:5500",
                "dom_map": SAMPLE_DOM,
                "command": "click checkout",
                "type": "command",
            })
            command_res = ws.receive_json()
            assert command_res["status"] == "success"
            assert command_res["action"] == "click"
            assert command_res["element_id"] == "atlas-001"
            assert len(command_res["message"]) > 0

            # 6. Fault resilience: send bad JSON text, socket must stay alive
            ws.send_text("bad-payload-not-json")
            err_res = ws.receive_json()
            assert err_res["status"] == "error"

            # 7. Subsequent valid command works without reconnecting
            ws.send_json({
                "session_id": session_id,
                "url": "http://localhost:5500",
                "dom_map": SAMPLE_DOM,
                "command": "click checkout",
                "type": "command",
            })
            res2 = ws.receive_json()
            assert res2["status"] == "success"

        # Step 8: Accessibility telemetry audit logging
        audit_resp = e2e_client.post(
            "/v1/audit/log",
            json={
                "api_key": DEMO_API_KEY,
                "url": "http://localhost:5500",
                "errors": [
                    {
                        "element_id": "atlas-002",
                        "error_type": "missing_accessible_name",
                        "suggestion": "Element missing explicit aria label",
                    }
                ],
            },
        )
        assert audit_resp.status_code == 200
        assert audit_resp.json()["logged"] == 1

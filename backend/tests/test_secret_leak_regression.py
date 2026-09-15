"""
test_secret_leak_regression.py — End-to-end leak regression tests.
Verifies that plaintext secrets NEVER appear in:
  1. Any call to call_llm (or LLM prompt text)
  2. Any WebSocket frame sent back to client
  3. Any argument or return value of trim_log_payload / DB usage log
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
CLIENT_SIDE_SECRET = "super_vaulted_plaintext_hunter2"
RAW_LEAK_SECRET_PASS = "unvaulted_raw_password_xyz999"
RAW_LEAK_SECRET_CARD = "4532015112830366"  # Luhn-valid 16-digit Visa

SAMPLE_DOM = [
    {
        "id": "atlas-p1",
        "tag": "input",
        "type": "password",
        "inner_text": None,
        "placeholder": "Password",
        "aria_label": "Password",
        "href": None,
        "name": "password",
        "role": None,
    },
    {
        "id": "atlas-c1",
        "tag": "input",
        "type": "text",
        "inner_text": None,
        "placeholder": "Credit Card",
        "aria_label": "Card Number",
        "href": None,
        "name": "card",
        "role": None,
    },
]


@pytest.fixture
def ws_leak_test_env():
    from app.main import app
    from app.db.connection import get_db

    captured = {
        "llm_prompts": [],
        "ws_responses": [],
        "trim_log_args": [],
        "db_logs": [],
    }

    async def override_get_db():
        mock_db = AsyncMock()
        mock_db.add = MagicMock(side_effect=lambda entity: captured["db_logs"].append(entity))
        mock_db.commit = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    async def mock_call_llm(user_prompt, system_prompt=None, reasoning=False):
        prompt = f"{system_prompt}\n{user_prompt}" if system_prompt else user_prompt
        captured["llm_prompts"].append(prompt)
        # If token in prompt, echo token in value per Contract 11
        val = "{password}" if "{password}" in prompt else "[REDACTED_password]"
        return json.dumps({
            "action": "fill",
            "element_id": "atlas-p1",
            "value": val,
            "message": f"Filled field with {val}",
        })

    from app.agent import sanitize as sanitize_module
    orig_trim = sanitize_module.trim_log_payload

    def spy_trim_log_payload(*args, **kwargs):
        captured["trim_log_args"].append((args, kwargs))
        return orig_trim(*args, **kwargs)

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: key == DEMO_API_KEY)), \
         patch("app.agent.llm_client.call_llm", side_effect=mock_call_llm), \
         patch.object(sanitize_module, "trim_log_payload", side_effect=spy_trim_log_payload):
        with TestClient(app) as client:
            yield client, captured

    app.dependency_overrides.clear()


class TestSecretLeakRegression:
    """Rigorous regression tests ensuring zero plaintext secrets leak across boundaries."""

    def test_tokenized_command_flow_zero_leak(self, ws_leak_test_env):
        """
        Flow 1: Standard client-side tokenization.
        Real secret is vaulted on client; token {password} is transmitted.
        """
        client, captured = ws_leak_test_env

        # Client tokenized command: real secret CLIENT_SIDE_SECRET never entered the payload
        tokenized_command = "fill my password with {password}"
        payload = {
            "session_id": "sess-tokenized-001",
            "api_key": DEMO_API_KEY,
            "url": "https://secure-checkout.example.com",
            "dom_map": SAMPLE_DOM,
            "command": tokenized_command,
            "type": "command",
        }

        with client.websocket_connect("/v1/agent") as ws:
            ws.send_json(payload)
            reply = ws.receive_json()
            captured["ws_responses"].append(reply)

        all_captured_str = json.dumps({
            "llm_prompts": captured["llm_prompts"],
            "ws_responses": captured["ws_responses"],
            "trim_log_args": [str(a) for a in captured["trim_log_args"]],
            "db_logs": [str(vars(d)) for d in captured["db_logs"] if hasattr(d, "__dict__")],
        })

        # Non-negotiable invariant
        assert CLIENT_SIDE_SECRET not in all_captured_str, (
            f"LEAK DETECTED: {CLIENT_SIDE_SECRET} found in server capture!"
        )
        assert reply["status"] == "success"
        assert reply["value"] == "{password}"

    def test_untokenized_raw_secret_defense_in_depth_zero_leak(self, ws_leak_test_env):
        """
        Flow 2: Client bug / untokenized raw secret.
        Raw password and credit card number enter the payload.
        Server-side sanitize.py must catch and redact before LLM, WS reply, trim_log, or DB.
        """
        client, captured = ws_leak_test_env

        raw_command = f"enter password with {RAW_LEAK_SECRET_PASS} and card with {RAW_LEAK_SECRET_CARD}"
        payload = {
            "session_id": "sess-raw-leak-002",
            "api_key": DEMO_API_KEY,
            "url": "https://emergency.example.com",
            "dom_map": SAMPLE_DOM,
            "command": raw_command,
            "type": "command",
        }

        with client.websocket_connect("/v1/agent") as ws:
            ws.send_json(payload)
            reply = ws.receive_json()
            captured["ws_responses"].append(reply)

        all_captured_str = json.dumps({
            "llm_prompts": captured["llm_prompts"],
            "ws_responses": captured["ws_responses"],
            "trim_log_args": [str(a) for a in captured["trim_log_args"]],
            "db_logs": [str(vars(d)) for d in captured["db_logs"] if hasattr(d, "__dict__")],
        })

        # Non-negotiable invariant: Plaintext secret must NEVER appear anywhere
        assert RAW_LEAK_SECRET_PASS not in all_captured_str, (
            f"LEAK DETECTED: {RAW_LEAK_SECRET_PASS} appeared in backend capture!"
        )
        assert RAW_LEAK_SECRET_CARD not in all_captured_str, (
            f"LEAK DETECTED: {RAW_LEAK_SECRET_CARD} appeared in backend capture!"
        )

        # Assert redactions took effect
        assert "[REDACTED_password]" in all_captured_str
        assert "[REDACTED_cc_number]" in all_captured_str

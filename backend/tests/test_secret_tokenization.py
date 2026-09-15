"""
test_secret_tokenization.py — Unit tests for server-side secret scanning and defense-in-depth redaction.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.agent.sanitize import scan_for_raw_secrets, redact_raw_secrets, is_luhn_valid

DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
LUHN_VALID_CARD = "4532015112830366"
LUHN_INVALID_CARD = "4532015112830367"
SAMPLE_SSN = "123-45-6789"


class TestSecretScanningUnit:
    """Unit tests for scan_for_raw_secrets and Luhn validation."""

    def test_luhn_validator(self):
        assert is_luhn_valid(LUHN_VALID_CARD) is True
        assert is_luhn_valid(LUHN_INVALID_CARD) is False
        assert is_luhn_valid("123") is False

    def test_scan_flags_luhn_valid_card(self):
        command = f"My card is {LUHN_VALID_CARD} please use it"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "cc_number"
        assert hits[0]["start"] == command.index(LUHN_VALID_CARD)
        assert hits[0]["end"] == hits[0]["start"] + len(LUHN_VALID_CARD)
        # Invariant: Secret value itself is NEVER returned in the hit metadata
        assert "value" not in hits[0]
        assert LUHN_VALID_CARD not in str(hits[0].values())

    def test_scan_flags_ssn_shaped_string(self):
        command = f"My SSN is {SAMPLE_SSN} for verification"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "ssn"
        assert hits[0]["start"] == command.index(SAMPLE_SSN)
        assert hits[0]["end"] == hits[0]["start"] + len(SAMPLE_SSN)
        assert "value" not in hits[0]
        assert SAMPLE_SSN not in str(hits[0].values())

    def test_scan_ignores_ordinary_sentence(self):
        ordinary = "Please scroll down to the bottom and click on the submit button"
        hits = scan_for_raw_secrets(ordinary)
        assert hits == []

    def test_scan_flags_verbatim_password(self):
        command = "fill my password with SuperSecretPass99"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "password"
        assert "SuperSecretPass99" not in str(hits[0].values())

    def test_scan_flags_otp(self):
        command = "my otp is 123456"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "otp"
        assert "123456" not in str(hits[0].values())

    def test_scan_flags_expiry(self):
        command = "my credit card expiry is 12/26"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "cc_expiry"
        assert "12/26" not in str(hits[0].values())

    def test_scan_compound_command_with_username_and_password(self):
        command = "fill username with alice and password with SuperSecretPass99"
        hits = scan_for_raw_secrets(command)
        assert len(hits) == 1
        assert hits[0]["category"] == "password"
        assert "SuperSecretPass99" not in str(hits[0].values())
        sanitized, _ = redact_raw_secrets(command)
        assert "alice" in sanitized
        assert "SuperSecretPass99" not in sanitized
        assert "[REDACTED_password]" in sanitized

    def test_scan_ignores_already_tokenized_commands(self):
        tokenized = "fill my password with {password} and card with {cc_number}"
        hits = scan_for_raw_secrets(tokenized)
        assert hits == []

    def test_redact_raw_secrets_replaces_spans(self):
        command = f"card: {LUHN_VALID_CARD}, ssn: {SAMPLE_SSN}"
        sanitized, hits = redact_raw_secrets(command)
        assert LUHN_VALID_CARD not in sanitized
        assert SAMPLE_SSN not in sanitized
        assert "[REDACTED_cc_number]" in sanitized
        assert "[REDACTED_ssn]" in sanitized
        assert len(hits) == 2


@pytest.fixture
def ws_client():
    """TestClient with DB and LLM mocked."""
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    mock_llm_reply = json.dumps({
        "action": "fill",
        "element_id": "atlas-001",
        "value": "[REDACTED_password]",
        "message": "Filled field",
    })

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: key == DEMO_API_KEY)), \
         patch("app.agent.llm_client.call_llm",
               new=AsyncMock(return_value=mock_llm_reply)):
        with TestClient(app) as c:
            yield c

    app.dependency_overrides.clear()


class TestWebSocketDefenseInDepth:
    """Verify that WS command payload containing raw secret gets redacted before build_prompt is called."""

    def test_raw_secret_redacted_before_build_prompt(self, ws_client):
        from app.agent import prompt as command_prompt

        untokenized_secret = "raw_untokenized_password_xyz987"
        raw_command = f"enter password with {untokenized_secret}"

        payload = {
            "session_id": "test-sec-001",
            "api_key": DEMO_API_KEY,
            "url": "https://secure.example.com",
            "dom_map": [
                {
                    "id": "atlas-001",
                    "tag": "input",
                    "type": "password",
                    "inner_text": None,
                    "placeholder": "Password",
                    "aria_label": "Password",
                    "href": None,
                    "name": "password",
                    "role": None,
                }
            ],
            "command": raw_command,
            "type": "command",
        }

        with patch.object(command_prompt, "build_prompt", wraps=command_prompt.build_prompt) as spy_build_prompt:
            with ws_client.websocket_connect("/v1/agent") as ws:
                ws.send_json(payload)
                response = ws.receive_json()

            assert response["status"] == "success"
            assert spy_build_prompt.called

            # Check argument passed to build_prompt: (safe_dom, safe_command)
            prompt_command_arg = spy_build_prompt.call_args[0][1]
            assert untokenized_secret not in prompt_command_arg, (
                "CRITICAL SECURITY FAILURE: Untokenized secret was passed into build_prompt!"
            )
            assert "[REDACTED_password]" in prompt_command_arg

"""
test_b0_challenger_stress.py — Empirical Challenger stress test suite for Track B0.
Tests:
- CSWSH Origin validation and origin spoofing attacks
- Plaintext api_key absence in response and message bodies
- Authentication brute-force throttling & policy violation (WS 1008)
- Edge case payloads: malformed JSON, non-object JSON, missing fields, invalid types
- Unicode, Arabic, RTL, and injection payloads in chat and summary pipelines
- 3000-char truncation enforcement in chat_prompt and summary_prompt
- PII violation rejection on sensitive DOM nodes
- Rate limit enforcement and LLMError graceful degradation on chat & summary
- Correlation ID preservation across success and error responses
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.db.connection import get_db
from app.agent.llm_client import LLMError
from app.agent.chat_prompt import build_chat_prompt
from app.agent.summary_prompt import build_summary_prompt


DEMO_API_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
TENANT_UUID = uuid.UUID("11111111-1111-1111-1111-111111111111")

SAMPLE_DOM = [
    {
        "element_id": "atlas-001",
        "tag": "button",
        "role": "button",
        "label": "Checkout",
        "text": "Checkout",
        "classes": ["btn", "btn-primary"],
        "attributes": {},
        "is_interactive": True,
        "is_visible": True,
    }
]


@pytest.fixture(scope="module")
def stress_client():
    async def override_get_db():
        mock_db = AsyncMock()

        async def mock_execute(query, *args, **kwargs):
            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = []
            mock_result.scalar_one_or_none.return_value = MagicMock(tenant_id=TENANT_UUID)
            return mock_result

        mock_db.execute = mock_execute
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.rollback = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: TENANT_UUID if key == DEMO_API_KEY else None)), \
         patch("app.agent.llm_client.ping_llm", new=AsyncMock(return_value=True)):
        with TestClient(app) as c:
            yield c

    app.dependency_overrides.clear()


# ==============================================================================
# 1. CSWSH Handshake Security & Origin Spoofing
# ==============================================================================

class TestCSWSHOriginSecurity:
    @pytest.mark.parametrize("evil_origin", [
        "https://evil-attacker.com",
        "http://attacker.org:8080",
        "http://localhost.evil.com",
        "http://127.0.0.1.attacker.com",
        "http://evil.com/localhost",
        "http://192.168.1.100",
        "http://10.0.0.1",
        "https://phishing-site.xyz",
    ])
    def test_cswsh_rejects_untrusted_and_spoofed_origins(self, stress_client, evil_origin):
        with pytest.raises(WebSocketDisconnect) as exc:
            with stress_client.websocket_connect("/v1/agent", headers={"Origin": evil_origin}) as ws:
                ws.receive_json()
        assert exc.value.code == 1008

    @pytest.mark.parametrize("trusted_origin", [
        "chrome-extension://cmcapeohojfahogcedidaampamhiecac",
        "CHROME-EXTENSION://CMCAPEOHOJFAHOGCEDIDAAMPAMHIECAC",
        "moz-extension://b4b5722e-1b33-4f10-9c1a-7b3b9b4f9c1a",
        "http://localhost",
        "http://localhost:3000",
        "http://LOCALHOST:8080",
        "http://127.0.0.1:8000",
        "http://127.0.0.1",
        "http://[::1]:8000",
    ])
    def test_cswsh_accepts_valid_origins(self, stress_client, trusted_origin):
        with stress_client.websocket_connect("/v1/agent", headers={"Origin": trusted_origin}) as ws:
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            res = ws.receive_json()
            assert res.get("status") == "ok"


# ==============================================================================
# 2. Plaintext API Key & Authentication Security
# ==============================================================================

class TestAuthAndKeyExposureSecurity:
    def test_api_key_not_leaked_in_auth_success_response(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            res = ws.receive_json()
            assert res.get("status") == "ok"
            raw_text = str(res)
            assert DEMO_API_KEY not in raw_text

    def test_api_key_not_leaked_in_auth_error_response(self, stress_client):
        fake_secret_key = "super_secret_unauthorized_key_99999"
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": fake_secret_key})
            res = ws.receive_json()
            assert res.get("status") == "error"
            raw_text = str(res)
            assert fake_secret_key not in raw_text
            assert "Invalid or inactive API key." in res.get("message")

    def test_per_message_api_key_not_leaked_in_chat_reply(self, stress_client):
        mock_llm = AsyncMock(return_value="Answer from AI")
        with patch("app.agent.llm_client.call_llm", new=mock_llm):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({
                    "session_id": "test-sec-01",
                    "api_key": DEMO_API_KEY,
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "hello",
                    "type": "chat",
                    "page_text": "text"
                })
                res = ws.receive_json()
                assert res.get("status") == "success"
                assert DEMO_API_KEY not in str(res)

    def test_unauthenticated_chat_rejected(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({
                "session_id": "test-unauth-01",
                "url": "https://example.com",
                "dom_map": SAMPLE_DOM,
                "command": "hello",
                "type": "chat",
            })
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert "Not authenticated" in res.get("message")

    def test_repeated_per_message_auth_failures_disconnect(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            # 1
            ws.send_json({
                "session_id": "test-bad-01",
                "api_key": "bad_key_1",
                "url": "https://example.com",
                "dom_map": SAMPLE_DOM,
                "command": "hello",
                "type": "chat",
            })
            assert ws.receive_json().get("status") == "error"
            # 2
            ws.send_json({
                "session_id": "test-bad-02",
                "api_key": "bad_key_2",
                "url": "https://example.com",
                "dom_map": SAMPLE_DOM,
                "command": "hello",
                "type": "chat",
            })
            assert ws.receive_json().get("status") == "error"
            # 3 -> Disconnect
            ws.send_json({
                "session_id": "test-bad-03",
                "api_key": "bad_key_3",
                "url": "https://example.com",
                "dom_map": SAMPLE_DOM,
                "command": "hello",
                "type": "chat",
            })
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1008


# ==============================================================================
# 3. Payload Edge Cases & Resilience on /v1/agent
# ==============================================================================

class TestPayloadEdgeCasesAndResilience:
    def test_malformed_json_keeps_connection_alive(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_text("THIS IS NOT JSON {{{[[[")
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert "Invalid JSON payload" in res.get("message")

            # Verify connection is still open and can authenticate
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            assert ws.receive_json().get("status") == "ok"

    def test_non_dict_json_keeps_connection_alive(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json(["an", "array", "not", "object"])
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert "Payload must be a JSON object" in res.get("message")

    @pytest.mark.parametrize("missing_field", ["session_id", "url", "dom_map", "command", "type"])
    def test_missing_required_fields_returns_validation_error(self, stress_client, missing_field):
        payload = {
            "session_id": "test-sess",
            "url": "https://example.com",
            "dom_map": SAMPLE_DOM,
            "command": "test command",
            "type": "chat",
            "page_text": "sample",
        }
        del payload[missing_field]

        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            assert ws.receive_json().get("status") == "ok"

            ws.send_json(payload)
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert f"Invalid message ({missing_field})" in res.get("message")

    def test_invalid_type_rejected(self, stress_client):
        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            assert ws.receive_json().get("status") == "ok"

            ws.send_json({
                "session_id": "test-sess",
                "url": "https://example.com",
                "dom_map": SAMPLE_DOM,
                "command": "test command",
                "type": "unsupported_action",
            })
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert "Invalid message (type)" in res.get("message")


# ==============================================================================
# 4. Chat & Summary Deep Pipeline Stress (Unicode, RTL, Truncation, Injection)
# ==============================================================================

class TestChatAndSummaryPipelineStress:
    def test_arabic_and_rtl_chat_pipeline(self, stress_client):
        arabic_question = "ما هي المنتجات الطبية المتوفرة؟"
        arabic_page = "مرحباً بكم في صيدلية كيرلينك. لدينا مسكنات وأدوية الضغط وفيتامينات."

        captured_prompt = None
        async def mock_call(prompt, **kwargs):
            nonlocal captured_prompt
            captured_prompt = prompt
            return "توفر الصيدلية مسكنات وأدوية وفيتامينات."

        with patch("app.agent.llm_client.call_llm", new=mock_call):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
                assert ws.receive_json().get("status") == "ok"

                ws.send_json({
                    "session_id": "sess-ar-01",
                    "url": "https://carelink.eg",
                    "dom_map": SAMPLE_DOM,
                    "command": arabic_question,
                    "type": "chat",
                    "page_text": arabic_page,
                    "correlation_id": "corr-ar-99"
                })
                res = ws.receive_json()

                assert res.get("status") == "success"
                assert res.get("correlation_id") == "corr-ar-99"
                assert "مسكنات" in res.get("message")
                assert arabic_question in captured_prompt
                assert arabic_page in captured_prompt

    def test_page_text_3000_char_truncation(self, stress_client):
        oversized_page_text = "X" * 15000
        captured_chat_prompt = None
        captured_summary_prompt = None

        async def mock_chat(prompt, **kwargs):
            nonlocal captured_chat_prompt
            captured_chat_prompt = prompt
            return "Chat answer."

        async def mock_summary(prompt, **kwargs):
            nonlocal captured_summary_prompt
            captured_summary_prompt = prompt
            return "Summary answer."

        with patch("app.agent.llm_client.call_llm", new=mock_chat):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
                assert ws.receive_json().get("status") == "ok"

                # Chat truncation
                ws.send_json({
                    "session_id": "sess-trunc-chat",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "Summarize",
                    "type": "chat",
                    "page_text": oversized_page_text,
                })
                res = ws.receive_json()
                assert res.get("status") == "success"
                # Check prompt content length for page text
                assert "X" * 3000 in captured_chat_prompt
                assert "X" * 3001 not in captured_chat_prompt

        with patch("app.agent.llm_client.call_llm", new=mock_summary):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
                assert ws.receive_json().get("status") == "ok"

                # Summary truncation
                ws.send_json({
                    "session_id": "sess-trunc-sum",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "",
                    "type": "summary",
                    "page_text": oversized_page_text,
                })
                res = ws.receive_json()
                assert res.get("status") == "success"
                assert "X" * 1000 in captured_summary_prompt
                assert "X" * 1001 not in captured_summary_prompt

    def test_pii_violation_in_dom_rejects_chat_and_summary(self, stress_client):
        tainted_dom = [
            {
                "element_id": "atlas-sec-01",
                "tag": "input",
                "role": "textbox",
                "label": "Card Number",
                "inner_text": "4111-2222-3333-4444",
                "sensitive": True,
            }
        ]

        with stress_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
            assert ws.receive_json().get("status") == "ok"

            # Chat with sensitive DOM text leak
            ws.send_json({
                "session_id": "sess-pii-01",
                "url": "https://example.com",
                "dom_map": tainted_dom,
                "command": "Help me with this card",
                "type": "chat",
            })
            res = ws.receive_json()
            assert res.get("status") == "error"
            assert "Security violation" in res.get("message")

            # Summary with sensitive DOM text leak
            ws.send_json({
                "session_id": "sess-pii-02",
                "url": "https://example.com",
                "dom_map": tainted_dom,
                "command": "",
                "type": "summary",
            })
            res_sum = ws.receive_json()
            assert res_sum.get("status") == "error"
            assert "Security violation" in res_sum.get("message")

    def test_rate_limiter_exceeded_on_chat_and_summary(self, stress_client):
        with patch("app.agent.rate_limiter.check", return_value=False):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
                assert ws.receive_json().get("status") == "ok"

                ws.send_json({
                    "session_id": "sess-rate-01",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "Hello",
                    "type": "chat",
                    "correlation_id": "corr-rate-chat"
                })
                res = ws.receive_json()
                assert res.get("status") == "error"
                assert "Rate limit exceeded" in res.get("message")
                assert res.get("correlation_id") == "corr-rate-chat"

                ws.send_json({
                    "session_id": "sess-rate-02",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "",
                    "type": "summary",
                    "correlation_id": "corr-rate-sum"
                })
                res_sum = ws.receive_json()
                assert res_sum.get("status") == "error"
                assert "Rate limit exceeded" in res_sum.get("message")
                assert res_sum.get("correlation_id") == "corr-rate-sum"

    def test_llm_error_graceful_degradation_on_chat_and_summary(self, stress_client):
        failing_mock = AsyncMock(side_effect=LLMError("Groq 503 Service Unavailable"))
        with patch("app.agent.llm_client.call_llm", new=failing_mock):
            with stress_client.websocket_connect("/v1/agent") as ws:
                ws.send_json({"type": "auth", "api_key": DEMO_API_KEY})
                assert ws.receive_json().get("status") == "ok"

                ws.send_json({
                    "session_id": "sess-llmfail-01",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "Hello",
                    "type": "chat",
                    "correlation_id": "corr-fail-01"
                })
                res = ws.receive_json()
                assert res.get("status") == "error"
                assert "AI service unavailable" in res.get("message")
                assert res.get("correlation_id") == "corr-fail-01"

                ws.send_json({
                    "session_id": "sess-llmfail-02",
                    "url": "https://example.com",
                    "dom_map": SAMPLE_DOM,
                    "command": "",
                    "type": "summary",
                    "correlation_id": "corr-fail-02"
                })
                res_sum = ws.receive_json()
                assert res_sum.get("status") == "error"
                assert "AI service unavailable" in res_sum.get("message")
                assert res_sum.get("correlation_id") == "corr-fail-02"

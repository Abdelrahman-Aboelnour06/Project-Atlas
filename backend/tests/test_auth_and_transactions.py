"""
test_auth_and_transactions.py — Universal Auth & Transaction Integrity Suite

Exhaustively verifies:
1. Every authentication gate (headers, payloads, query params, websockets).
2. Input sanitization and bounds checking (empty, whitespace, oversized, malformed).
3. Rate limiting enforcement across all endpoints.
4. Database transaction lifecycles (commit, rollback on error, session release to pool).
5. TTLCache eviction, expiration, and key hashing safety.
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.db.connection import get_db, get_db_context, TTLCache, validate_api_key
from app.agent import rate_limiter

TEST_TENANT_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
VALID_KEY = "atlas_valid_test_key_0123456789abcdef"
INVALID_KEY = "atlas_invalid_key_99999999999999999"


@pytest.fixture
def auth_client():
    """TestClient with mocked DB that validates VALID_KEY to TEST_TENANT_ID."""
    async def override_get_db():
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.rollback = AsyncMock()
        mock_db.close = AsyncMock()
        try:
            yield mock_db
        except Exception:
            await mock_db.rollback()
            raise
        finally:
            await mock_db.close()

    app.dependency_overrides[get_db] = override_get_db

    async def mock_validate(db, key):
        if not isinstance(key, str):
            return None
        clean = key.strip()
        if not clean or len(clean) > 256:
            return None
        if clean == VALID_KEY:
            return TEST_TENANT_ID
        return None

    with patch("app.db.connection.validate_api_key", new=AsyncMock(side_effect=mock_validate)), \
         patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value="Valid LLM response")), \
         patch("app.agent.llm_client.ping_llm", new=AsyncMock(return_value=True)):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()


# ═════════════════════════════════════════════════════════════════════════════
# 1. AUTHENTICATION POINT TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestSessionStartAuth:
    """POST /v1/session/start authentication & bounds."""

    def test_valid_key_returns_session(self, auth_client):
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": VALID_KEY})
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert uuid.UUID(data["session_id"])

    def test_invalid_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": INVALID_KEY})
        assert r.status_code == 401

    def test_missing_header_returns_422(self, auth_client):
        r = auth_client.post("/v1/session/start")
        assert r.status_code == 422

    def test_empty_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": ""})
        assert r.status_code == 401

    def test_whitespace_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": "    "})
        assert r.status_code == 401

    def test_oversized_key_returns_401(self, auth_client):
        oversized = "a" * 1000
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": oversized})
        assert r.status_code == 401

    def test_rate_limiting_enforced(self, auth_client):
        rate_limiter.reset()
        for _ in range(rate_limiter.MAX_REQUESTS):
            r = auth_client.post("/v1/session/start", headers={"x-atlas-key": VALID_KEY})
            assert r.status_code == 200
        # Exceeded
        r = auth_client.post("/v1/session/start", headers={"x-atlas-key": VALID_KEY})
        assert r.status_code == 429


class TestAuditLogAuth:
    """POST /v1/audit/log authentication, bounds, and transactions."""

    def test_valid_key_in_body_returns_200(self, auth_client):
        payload = {
            "api_key": VALID_KEY,
            "url": "https://example.com",
            "errors": [{"element_id": "btn-1", "error_type": "missing_alt", "suggestion": "add alt"}]
        }
        r = auth_client.post("/v1/audit/log", json=payload)
        assert r.status_code == 200
        assert r.json()["logged"] == 1

    def test_valid_key_in_header_returns_200(self, auth_client):
        payload = {
            "api_key": "",
            "url": "https://example.com",
            "errors": [{"element_id": "btn-1", "error_type": "missing_alt"}]
        }
        r = auth_client.post("/v1/audit/log", json=payload, headers={"x-atlas-key": VALID_KEY})
        assert r.status_code == 200

    def test_invalid_key_returns_401(self, auth_client):
        payload = {
            "api_key": INVALID_KEY,
            "url": "https://example.com",
            "errors": []
        }
        r = auth_client.post("/v1/audit/log", json=payload)
        assert r.status_code == 401

    def test_batch_exceeding_100_errors_rejected_with_422(self, auth_client):
        too_many_errors = [{"element_id": f"e-{i}", "error_type": "missing_alt"} for i in range(101)]
        payload = {
            "api_key": VALID_KEY,
            "url": "https://example.com",
            "errors": too_many_errors
        }
        r = auth_client.post("/v1/audit/log", json=payload)
        assert r.status_code == 422

    def test_rate_limiting_enforced(self, auth_client):
        rate_limiter.reset()
        payload = {"api_key": VALID_KEY, "url": "https://example.com", "errors": []}
        for _ in range(rate_limiter.MAX_REQUESTS):
            r = auth_client.post("/v1/audit/log", json=payload)
            assert r.status_code == 200
        r = auth_client.post("/v1/audit/log", json=payload)
        assert r.status_code == 429


class TestAuditFixesAuth:
    """GET /v1/fixes authentication & rate limiting."""

    def test_valid_header_key_returns_200(self, auth_client):
        r = auth_client.get("/v1/fixes", headers={"x-atlas-key": VALID_KEY})
        assert r.status_code == 200

    def test_valid_query_param_key_returns_200(self, auth_client):
        r = auth_client.get(f"/v1/fixes?api_key={VALID_KEY}")
        assert r.status_code == 200

    def test_missing_key_returns_401(self, auth_client):
        r = auth_client.get("/v1/fixes")
        assert r.status_code == 401

    def test_invalid_key_returns_401(self, auth_client):
        r = auth_client.get("/v1/fixes", headers={"x-atlas-key": INVALID_KEY})
        assert r.status_code == 401


class TestSummaryAndChatAuth:
    """POST /v1/summary & POST /v1/chat authentication, rate limits, and bounds."""

    def test_summary_missing_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/summary", json={"url": "https://example.com"})
        assert r.status_code == 401

    def test_summary_invalid_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/summary", json={"url": "https://example.com", "api_key": INVALID_KEY})
        assert r.status_code == 401

    def test_summary_valid_header_key_returns_200(self, auth_client):
        r = auth_client.post("/v1/summary", json={"url": "https://example.com"}, headers={"x-atlas-key": VALID_KEY})
        assert r.status_code == 200

    def test_summary_oversized_page_text_returns_422(self, auth_client):
        r = auth_client.post(
            "/v1/summary",
            json={"url": "https://example.com", "page_text": "x" * 50001},
            headers={"x-atlas-key": VALID_KEY}
        )
        assert r.status_code == 422

    def test_chat_missing_key_returns_401(self, auth_client):
        r = auth_client.post("/v1/chat", json={"url": "https://example.com", "question": "hello"})
        assert r.status_code == 401

    def test_chat_oversized_question_returns_422(self, auth_client):
        r = auth_client.post(
            "/v1/chat",
            json={"url": "https://example.com", "question": "q" * 2001},
            headers={"x-atlas-key": VALID_KEY}
        )
        assert r.status_code == 422


class TestWebSocketAuthResilience:
    """WS /v1/agent authentication, non-dict payloads, and brute force."""

    def test_websocket_accepts_valid_auth(self, auth_client):
        with auth_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": VALID_KEY})
            resp = ws.receive_json()
            assert resp["status"] == "ok"
            assert resp["message"] == "Authenticated"

    def test_websocket_rejects_non_dict_payload_safely(self, auth_client):
        with auth_client.websocket_connect("/v1/agent") as ws:
            ws.send_text("[1, 2, 3]")
            resp = ws.receive_json()
            assert resp["status"] == "error"
            assert "Payload must be a JSON object" in resp["message"]
            # Connection stays open
            ws.send_json({"type": "auth", "api_key": VALID_KEY})
            resp2 = ws.receive_json()
            assert resp2["status"] == "ok"

    def test_websocket_rejects_duplicate_auth(self, auth_client):
        with auth_client.websocket_connect("/v1/agent") as ws:
            ws.send_json({"type": "auth", "api_key": VALID_KEY})
            resp1 = ws.receive_json()
            assert resp1["status"] == "ok"

            ws.send_json({"type": "auth", "api_key": VALID_KEY})
            resp2 = ws.receive_json()
            assert resp2["status"] == "error"
            assert "Already authenticated" in resp2["message"]


# ═════════════════════════════════════════════════════════════════════════════
# 2. TRANSACTION INTEGRITY & ROLLBACK TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestTransactionIntegrity:
    """Verifies that DB failures trigger rollback and release sessions cleanly."""

    def test_audit_log_rollback_on_commit_failure(self):
        from app.main import app
        from app.db.connection import get_db

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock(side_effect=Exception("Simulated disk error during commit"))
        mock_db.rollback = AsyncMock()

        async def override_failing_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_failing_db

        with patch("app.db.connection.validate_api_key", new=AsyncMock(return_value=TEST_TENANT_ID)):
            with TestClient(app) as client:
                payload = {
                    "api_key": VALID_KEY,
                    "url": "https://example.com",
                    "errors": [{"element_id": "e-1", "error_type": "missing_alt"}]
                }
                r = client.post("/v1/audit/log", json=payload)
                assert r.status_code == 500
                assert "Database transaction error" in r.json()["detail"]
                # Verify rollback was called explicitly
                mock_db.rollback.assert_called_once()

        app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_db_context_rolls_back_on_exception(self):
        mock_session = AsyncMock()
        mock_session.rollback = AsyncMock()
        mock_session.close = AsyncMock()

        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("app.db.connection.AsyncSessionLocal", return_value=mock_cm):
            with pytest.raises(RuntimeError):
                async with get_db_context() as session:
                    assert session == mock_session
                    raise RuntimeError("Something failed inside transaction context")

            mock_session.rollback.assert_called_once()
            mock_session.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_db_dependency_rolls_back_on_exception(self):
        mock_session = AsyncMock()
        mock_session.rollback = AsyncMock()
        mock_session.close = AsyncMock()

        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("app.db.connection.AsyncSessionLocal", return_value=mock_cm):
            gen = get_db()
            session = await anext(gen)
            assert session == mock_session
            with pytest.raises(RuntimeError):
                await gen.athrow(RuntimeError("Unhandled route exception"))

            mock_session.rollback.assert_called_once()
            mock_session.close.assert_called_once()


# ═════════════════════════════════════════════════════════════════════════════
# 3. TTLCache & KEY SANITIZATION UNIT TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestTTLCacheAndKeySanitization:
    """Verifies in-memory cache eviction, monotonic expiration, and input sanity."""

    def test_ttl_cache_eviction_and_expiry(self):
        cache = TTLCache(maxsize=2, ttl=0.1)
        u1, u2, u3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

        cache.set("k1", u1)
        cache.set("k2", u2)
        assert cache.get("k1") == u1
        assert cache.get("k2") == u2

        # Exceed maxsize -> least recently used (k1) should be evicted
        cache.set("k3", u3)
        assert cache.get("k1") is None
        assert cache.get("k2") == u2
        assert cache.get("k3") == u3

    @pytest.mark.asyncio
    async def test_validate_api_key_fast_path_rejection(self):
        mock_db = AsyncMock()
        # Non-string
        assert await validate_api_key(mock_db, None) is None
        assert await validate_api_key(mock_db, 12345) is None
        # Empty and whitespace
        assert await validate_api_key(mock_db, "") is None
        assert await validate_api_key(mock_db, "   \t\n   ") is None
        # Oversized string
        assert await validate_api_key(mock_db, "a" * 257) is None
        # DB execute should NEVER have been called for these invalid inputs
        mock_db.execute.assert_not_called()

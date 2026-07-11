"""
test_routes_rest.py — REST endpoint tests.

Covers: GET /health, POST /v1/session/start, POST /v1/audit/log
All run against the FastAPI TestClient with DB calls mocked.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


DEMO_API_KEY  = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
WRONG_API_KEY = "atlas_thisiswrongdonotuse000000000000"


@pytest.fixture(scope="module")
def client():
    """
    TestClient with DB overridden — no real PostgreSQL needed.
    validate_api_key returns True for DEMO_API_KEY, False otherwise.
    """
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()

        async def mock_execute(query, *args, **kwargs):
            # Inspect the query to decide what to return
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = MagicMock()
            return mock_result

        mock_db.execute = mock_execute
        mock_db.add     = MagicMock()
        mock_db.commit  = AsyncMock()
        mock_db.refresh = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch("app.db.connection.validate_api_key",
               new=AsyncMock(side_effect=lambda db, key: key == DEMO_API_KEY)), \
         patch("app.agent.llm_client.ping_llm", new=AsyncMock(return_value=True)):
        with TestClient(app) as c:
            yield c

    app.dependency_overrides.clear()


# ── GET /health ───────────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_200(self, client):
        r = client.get("/health")
        assert r.status_code == 200

    def test_returns_ok_status(self, client):
        r = client.get("/health")
        assert r.json()["status"] == "ok"

    def test_returns_service_name(self, client):
        r = client.get("/health")
        assert "service" in r.json()

    def test_no_auth_required(self, client):
        """Health endpoint must be publicly accessible — no key needed."""
        r = client.get("/health")
        assert r.status_code != 401
        assert r.status_code != 403

    def test_db_ok_when_reachable(self, client):
        """`db` is a real SELECT 1 check now, not the old hardcoded stub."""
        r = client.get("/health")
        assert r.json()["db"] == "ok"

    def test_llm_ok_when_reachable(self, client):
        """`llm` is a real ping_llm() check now, not the old hardcoded stub."""
        r = client.get("/health")
        assert r.json()["llm"] == "ok"

    def test_llm_unavailable_when_ping_fails(self, client):
        """
        Layers a second patch on top of the fixture's default (True) for
        just this test, to prove the endpoint reports "unavailable"
        instead of crashing when the provider can't be reached — the
        actual failure mode ping_llm() exists to catch.
        """
        with patch("app.agent.llm_client.ping_llm", new=AsyncMock(return_value=False)):
            r = client.get("/health")
        assert r.json()["llm"] == "unavailable"


# ── POST /v1/session/start ────────────────────────────────────────────────────

class TestSessionStart:
    def test_valid_key_returns_200(self, client):
        r = client.post(
            "/v1/session/start",
            headers={"x-atlas-key": DEMO_API_KEY},
        )
        assert r.status_code == 200

    def test_valid_key_returns_session_id(self, client):
        r = client.post(
            "/v1/session/start",
            headers={"x-atlas-key": DEMO_API_KEY},
        )
        body = r.json()
        assert "session_id" in body
        assert len(body["session_id"]) > 0

    def test_session_id_is_uuid_format(self, client):
        import uuid
        r = client.post(
            "/v1/session/start",
            headers={"x-atlas-key": DEMO_API_KEY},
        )
        session_id = r.json()["session_id"]
        try:
            uuid.UUID(session_id)
        except ValueError:
            pytest.fail(f"session_id '{session_id}' is not a valid UUID")

    def test_each_call_returns_unique_session_id(self, client):
        r1 = client.post("/v1/session/start", headers={"x-atlas-key": DEMO_API_KEY})
        r2 = client.post("/v1/session/start", headers={"x-atlas-key": DEMO_API_KEY})
        assert r1.json()["session_id"] != r2.json()["session_id"]

    def test_invalid_key_returns_401(self, client):
        r = client.post(
            "/v1/session/start",
            headers={"x-atlas-key": WRONG_API_KEY},
        )
        assert r.status_code == 401

    def test_missing_key_header_returns_422(self, client):
        r = client.post("/v1/session/start")  # no header
        assert r.status_code == 422

    def test_empty_key_returns_401_or_422(self, client):
        r = client.post(
            "/v1/session/start",
            headers={"x-atlas-key": ""},
        )
        assert r.status_code in (401, 422)


# ── POST /v1/audit/log ────────────────────────────────────────────────────────

class TestAuditLog:
    def _valid_payload(self):
        return {
            "api_key": DEMO_API_KEY,
            "url":     "https://demo.atlas.com/checkout",
            "errors": [
                {
                    "element_id": "atlas-005",
                    "error_type": "missing_alt",
                    "suggestion": '<img alt="Product hero image">',
                },
                {
                    "element_id": "atlas-006",
                    "error_type": "missing_aria",
                    "suggestion": 'Add aria-label="Close dialog" to button',
                },
            ],
        }

    def test_valid_payload_returns_200(self, client):
        r = client.post("/v1/audit/log", json=self._valid_payload())
        assert r.status_code == 200

    def test_returns_logged_count(self, client):
        r = client.post("/v1/audit/log", json=self._valid_payload())
        body = r.json()
        assert "logged" in body
        assert body["logged"] == 2

    def test_single_error_logged(self, client):
        payload = {
            "api_key": DEMO_API_KEY,
            "url":     "https://demo.atlas.com",
            "errors": [{
                "element_id": "atlas-007",
                "error_type": "missing_label",
                "suggestion": "Add <label> for this input",
            }],
        }
        r = client.post("/v1/audit/log", json=payload)
        assert r.status_code == 200
        assert r.json()["logged"] == 1

    def test_invalid_key_returns_401(self, client):
        payload = self._valid_payload()
        payload["api_key"] = WRONG_API_KEY
        r = client.post("/v1/audit/log", json=payload)
        assert r.status_code == 401

    def test_missing_api_key_returns_422(self, client):
        payload = self._valid_payload()
        del payload["api_key"]
        r = client.post("/v1/audit/log", json=payload)
        assert r.status_code == 422

    def test_missing_url_returns_422(self, client):
        payload = self._valid_payload()
        del payload["url"]
        r = client.post("/v1/audit/log", json=payload)
        assert r.status_code == 422

    def test_empty_errors_list(self, client):
        payload = {
            "api_key": DEMO_API_KEY,
            "url":     "https://demo.atlas.com",
            "errors":  [],
        }
        r = client.post("/v1/audit/log", json=payload)
        assert r.status_code == 200
        assert r.json()["logged"] == 0

    def test_valid_error_types(self, client):
        for error_type in ("missing_alt", "missing_aria", "missing_label"):
            payload = {
                "api_key": DEMO_API_KEY,
                "url":     "https://demo.atlas.com",
                "errors":  [{
                    "element_id": "atlas-001",
                    "error_type": error_type,
                    "suggestion": "fix it",
                }],
            }
            r = client.post("/v1/audit/log", json=payload)
            assert r.status_code == 200, f"error_type '{error_type}' should be accepted"

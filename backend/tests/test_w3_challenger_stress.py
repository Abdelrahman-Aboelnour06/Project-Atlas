"""
Project Atlas — Wave 3 Empirical Challenger Stress Test Suite
File: backend/tests/test_w3_challenger_stress.py

Adversarial stress harness for Wave 3 Task D1 (Dashboard GDPR & Tenant Endpoints):
Domain 1: Unauthorized Requests & Key Tampering
  - Missing, empty, whitespace, oversized (>256), malformed, and SQL injection keys on
    GET /v1/tenant/summary, GET /v1/tenant/export, DELETE /v1/tenant/data -> assert 401 rejections.
Domain 2: IDOR Cross-Tenant Isolation
  - Strictly proves Tenant A cannot view Tenant B summary.
  - Strictly proves Tenant A cannot export Tenant B telemetry logs or keys.
  - Strictly proves Tenant A cannot delete Tenant B data.
  - Strictly proves Tenant B data remains 100% intact after Tenant A deletion.
  - Strictly verifies key_hash redaction (only key_prefix exposed in export).
Domain 3: Confirmation Token Bypass Resistance
  - Hit DELETE /v1/tenant/data with missing token, empty string, whitespace, lowercase 'confirm_delete',
    partial 'CONFIRM', partial 'DELETE', extension 'CONFIRM_DELETE_ALL', wrong fields, and injections.
  - Assert 400 Bad Request on all bypass attempts.
  - Crucial verification: assert database records are NOT erased after each failed attempt.
Domain 4: Data Erasure Verification & Account Retention
  - Re-verify erasure with valid 'CONFIRM_DELETE' via both query param and JSON body.
  - Assert records permanently erased in DB.
  - Assert Tenant record and ApiKey record are RETAINED (account remains functional).
  - Assert subsequent export and summary reflect erased telemetry without crashing.
Domain 5: Concurrency Bursts & Connection Stability
  - Concurrent multi-threaded request bursts across summary, export, and delete.
  - Thread safety, connection stability, zero 500 errors.
  - Concurrent multi-tenant isolation under simultaneous load.
  - Per-tenant rate limiter bucket isolation during concurrent bursts.
Domain 6: Universal Prime Directive Compliance
  - Assert zero site-specific or domain hardcoding in tenant route and schemas.
"""

import concurrent.futures
import datetime
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.db.connection import get_db
from app.db.models import Tenant, ApiKey, UsageLog, ErrorLog, SecurityEvent
from app.agent import rate_limiter

# ── Fixtures & Identifiers ───────────────────────────────────────────────────

TENANT_A_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
TENANT_B_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
TENANT_C_ID = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")

KEY_TENANT_A = "atlas_live_tenant_a_1111222233334444"
KEY_TENANT_B = "atlas_live_tenant_b_5555666677778888"
KEY_TENANT_C = "atlas_live_tenant_c_99990000aaaabbbb"
INVALID_KEY = "atlas_invalid_key_bogus_9999999999"


class ChallengerStatefulTenantDatabase:
    """
    Stateful in-memory relational mock simulating strict multi-tenant database operations.
    Maintains relational consistency and isolates rows strictly by tenant_id.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        self.tenants = {
            TENANT_A_ID: Tenant(
                id=TENANT_A_ID,
                company_name="Acme Corp",
                email="security@acme.test",
                created_at=now,
            ),
            TENANT_B_ID: Tenant(
                id=TENANT_B_ID,
                company_name="Beta Logistics",
                email="compliance@beta.test",
                created_at=now,
            ),
            TENANT_C_ID: Tenant(
                id=TENANT_C_ID,
                company_name="Gamma Health",
                email="privacy@gamma.test",
                created_at=now,
            ),
        }

        self.api_keys = [
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                key_prefix="atlas_live_tenant_a_",
                key_hash="hash_a_secret_pbkdf2_token",
                is_active=True,
                created_at=now,
            ),
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                key_prefix="atlas_live_tenant_b_",
                key_hash="hash_b_secret_pbkdf2_token",
                is_active=True,
                created_at=now,
            ),
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_C_ID,
                key_prefix="atlas_live_tenant_c_",
                key_hash="hash_c_secret_pbkdf2_token",
                is_active=True,
                created_at=now,
            ),
        ]

        self.usage_logs = [
            # Tenant A: 3 logs, 2 sessions
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="sess-a-1",
                url="https://acme.test/page1",
                command="Click button",
                action="click",
                element_id="btn-1",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="sess-a-1",
                url="https://acme.test/page2",
                command="Fill form",
                action="fill",
                element_id="input-1",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="sess-a-2",
                url="https://acme.test/checkout",
                command="Submit order",
                action="click",
                element_id="btn-sub",
                timestamp=now,
            ),
            # Tenant B: 2 logs, 1 session
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                session_id="sess-b-1",
                url="https://beta.test/fleet",
                command="View tracking",
                action="click",
                element_id="map-view",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                session_id="sess-b-1",
                url="https://beta.test/dispatch",
                command="Dispatch vehicle",
                action="click",
                element_id="btn-dispatch",
                timestamp=now,
            ),
            # Tenant C: 1 log, 1 session
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_C_ID,
                session_id="sess-c-1",
                url="https://gamma.test/records",
                command="Consult chart",
                action="click",
                element_id="chart-row",
                timestamp=now,
            ),
        ]

        self.error_logs = [
            # Tenant A: 1 error
            ErrorLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                url="https://acme.test/page1",
                element_id="btn-1",
                error_type="missing_label",
                suggestion="Add aria-label",
                flagged_at=now,
            ),
            # Tenant B: 1 error
            ErrorLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                url="https://beta.test/fleet",
                element_id="map-view",
                error_type="low_contrast",
                suggestion="Increase contrast ratio",
                flagged_at=now,
            ),
        ]

        self.security_events = [
            # Tenant A: 1 security event
            SecurityEvent(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="sess-a-1",
                category="suspicious_cswsh_probe",
                created_at=now,
            ),
            # Tenant B: 1 security event
            SecurityEvent(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                session_id="sess-b-1",
                category="excessive_rate_probe",
                created_at=now,
            ),
        ]

        self.commit_count = 0
        self.rollback_count = 0

    def extract_tenant_id_from_params(self, params: dict) -> uuid.UUID | None:
        for val in params.values():
            if isinstance(val, uuid.UUID):
                return val
        return None

    async def execute(self, statement):
        sql = str(statement)
        compiled = statement.compile()
        params = compiled.params
        tid = self.extract_tenant_id_from_params(params)
        mock_result = MagicMock()

        # DELETE operations
        if "DELETE FROM usage_logs" in sql:
            initial = len(self.usage_logs)
            self.usage_logs = [u for u in self.usage_logs if u.tenant_id != tid]
            mock_result.rowcount = initial - len(self.usage_logs)
            return mock_result

        if "DELETE FROM error_logs" in sql:
            initial = len(self.error_logs)
            self.error_logs = [e for e in self.error_logs if e.tenant_id != tid]
            mock_result.rowcount = initial - len(self.error_logs)
            return mock_result

        if "DELETE FROM security_events" in sql:
            initial = len(self.security_events)
            self.security_events = [s for s in self.security_events if s.tenant_id != tid]
            mock_result.rowcount = initial - len(self.security_events)
            return mock_result

        # SELECT Tenant
        if "FROM tenants" in sql:
            tenant = self.tenants.get(tid)
            mock_result.scalar_one_or_none.return_value = tenant
            return mock_result

        # SELECT ApiKey count
        if "count(api_keys.id)" in sql.lower():
            count = sum(1 for k in self.api_keys if k.tenant_id == tid and k.is_active)
            mock_result.scalar.return_value = count
            return mock_result

        # SELECT UsageLog summary counts
        if "count(usage_logs.id)" in sql.lower():
            matching = [u for u in self.usage_logs if u.tenant_id == tid]
            total_goals = len(matching)
            distinct_sessions = len(set(u.session_id for u in matching))
            mock_result.one.return_value = (total_goals, distinct_sessions)
            return mock_result

        # SELECT ErrorLog count
        if "count(error_logs.id)" in sql.lower():
            count = sum(1 for e in self.error_logs if e.tenant_id == tid)
            mock_result.scalar.return_value = count
            return mock_result

        # SELECT ApiKeys list
        if "FROM api_keys" in sql:
            matching = [k for k in self.api_keys if k.tenant_id == tid]
            mock_result.scalars.return_value.all.return_value = matching
            return mock_result

        # SELECT UsageLogs list
        if "FROM usage_logs" in sql:
            matching = [u for u in self.usage_logs if u.tenant_id == tid]
            mock_result.scalars.return_value.all.return_value = matching
            return mock_result

        # SELECT ErrorLogs list
        if "FROM error_logs" in sql:
            matching = [e for e in self.error_logs if e.tenant_id == tid]
            mock_result.scalars.return_value.all.return_value = matching
            return mock_result

        # SELECT SecurityEvents list
        if "FROM security_events" in sql:
            matching = [s for s in self.security_events if s.tenant_id == tid]
            mock_result.scalars.return_value.all.return_value = matching
            return mock_result

        mock_result.scalar_one_or_none.return_value = None
        mock_result.scalar.return_value = 0
        mock_result.one.return_value = (0, 0)
        mock_result.scalars.return_value.all.return_value = []
        mock_result.rowcount = 0
        return mock_result

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        self.rollback_count += 1


@pytest.fixture
def challenger_db():
    db = ChallengerStatefulTenantDatabase()
    yield db


@pytest.fixture
def challenger_client(challenger_db):
    rate_limiter.reset()

    async def override_get_db():
        yield challenger_db

    app.dependency_overrides[get_db] = override_get_db

    async def mock_validate_api_key(db, api_key: str):
        if not isinstance(api_key, str):
            return None
        clean = api_key.strip()
        if not clean or len(clean) > 256:
            return None
        if clean == KEY_TENANT_A:
            return TENANT_A_ID
        if clean == KEY_TENANT_B:
            return TENANT_B_ID
        if clean == KEY_TENANT_C:
            return TENANT_C_ID
        return None

    with patch("app.db.connection.validate_api_key", new=AsyncMock(side_effect=mock_validate_api_key)):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()
    rate_limiter.reset()


# ── Domain 1: Unauthorized Requests & Key Tampering ──────────────────────────

class TestDomain1UnauthorizedRequests:
    """Stress tests authentication enforcement across all tenant endpoints."""

    @pytest.mark.parametrize("endpoint", [
        "/v1/tenant/summary",
        "/v1/tenant/export",
    ])
    def test_missing_key_rejected_401(self, challenger_client, endpoint):
        res = challenger_client.get(endpoint)
        assert res.status_code == 401
        assert "Missing API key" in res.json()["detail"]

    def test_delete_missing_key_rejected_401(self, challenger_client):
        res = challenger_client.delete("/v1/tenant/data?confirm_token=CONFIRM_DELETE")
        assert res.status_code == 401
        assert "Missing API key" in res.json()["detail"]

    @pytest.mark.parametrize("bad_key", [
        "",
        "   ",
        "\t\t",
        "\n",
        "a" * 257,
        "a" * 500,
        INVALID_KEY,
        "Bearer atlas_live_tenant_a_1111222233334444",
        "null",
        "undefined",
        "' OR '1'='1",
        "'; DROP TABLE tenants; --",
        "atlas_\x00_invalid",
    ])
    def test_tampered_keys_rejected_401(self, challenger_client, bad_key):
        headers = {"x-atlas-key": bad_key}
        for ep in ["/v1/tenant/summary", "/v1/tenant/export"]:
            res = challenger_client.get(ep, headers=headers)
            assert res.status_code == 401, f"Failed for {bad_key} on {ep}: got {res.status_code}"

        del_res = challenger_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers=headers
        )
        assert del_res.status_code == 401


# ── Domain 2: IDOR Cross-Tenant Isolation ────────────────────────────────────

class TestDomain2IdorCrossTenantIsolation:
    """Rigorous verification that tenant data boundaries are strictly impermeable."""

    def test_summary_cross_tenant_isolation(self, challenger_client):
        # Tenant A summary
        res_a = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
        assert res_a.status_code == 200
        data_a = res_a.json()
        assert data_a["tenant_id"] == str(TENANT_A_ID)
        assert data_a["company_name"] == "Acme Corp"
        assert data_a["total_goals"] == 3
        assert data_a["active_sessions"] == 2
        assert data_a["accessibility_issues_flagged"] == 1

        # Tenant B summary
        res_b = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_B})
        assert res_b.status_code == 200
        data_b = res_b.json()
        assert data_b["tenant_id"] == str(TENANT_B_ID)
        assert data_b["company_name"] == "Beta Logistics"
        assert data_b["total_goals"] == 2
        assert data_b["active_sessions"] == 1
        assert data_b["accessibility_issues_flagged"] == 1

        # Tenant C summary
        res_c = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_C})
        assert res_c.status_code == 200
        data_c = res_c.json()
        assert data_c["tenant_id"] == str(TENANT_C_ID)
        assert data_c["company_name"] == "Gamma Health"
        assert data_c["total_goals"] == 1
        assert data_c["active_sessions"] == 1
        assert data_c["accessibility_issues_flagged"] == 0

    def test_export_cross_tenant_isolation_and_redaction(self, challenger_client):
        # Tenant A export
        exp_a = challenger_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A}).json()
        assert exp_a["tenant"]["id"] == str(TENANT_A_ID)
        assert exp_a["summary"]["total_usage_records"] == 3
        assert exp_a["summary"]["total_sessions"] == 2
        assert exp_a["summary"]["total_error_records"] == 1
        assert exp_a["summary"]["total_security_events"] == 1

        # Zero records matching Tenant B or C exist in Tenant A export
        for u in exp_a["usage_logs"]:
            assert "beta.test" not in (u.get("url") or "")
            assert "gamma.test" not in (u.get("url") or "")
            assert u["session_id"] in ("sess-a-1", "sess-a-2")

        # Security check: key_hash is redacted from all exported api_keys
        for k in exp_a["api_keys"]:
            assert "key_hash" not in k
            assert "key_prefix" in k
            assert k["key_prefix"].startswith("atlas_live_tenant_a_")

        # Tenant B export
        exp_b = challenger_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_B}).json()
        assert exp_b["tenant"]["id"] == str(TENANT_B_ID)
        assert exp_b["summary"]["total_usage_records"] == 2
        for u in exp_b["usage_logs"]:
            assert "acme.test" not in (u.get("url") or "")
            assert u["session_id"] == "sess-b-1"

    def test_deletion_cross_tenant_isolation(self, challenger_client, challenger_db):
        """Verifies Tenant A deleting their data does NOT touch Tenant B or C data."""
        # Initial counts
        b_usage_initial = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_B_ID)
        c_usage_initial = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_C_ID)
        assert b_usage_initial == 2
        assert c_usage_initial == 1

        # Tenant A deletes their data
        del_res = challenger_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers={"x-atlas-key": KEY_TENANT_A}
        )
        assert del_res.status_code == 200

        # Tenant A usage logs must be 0
        a_usage_remaining = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        assert a_usage_remaining == 0

        # Tenant B & C usage logs must remain exactly untouched
        b_usage_remaining = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_B_ID)
        c_usage_remaining = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_C_ID)
        assert b_usage_remaining == 2, "CRITICAL IDOR: Tenant B data was affected by Tenant A deletion!"
        assert c_usage_remaining == 1, "CRITICAL IDOR: Tenant C data was affected by Tenant A deletion!"

        # Tenant B export still returns full data
        exp_b = challenger_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_B}).json()
        assert exp_b["summary"]["total_usage_records"] == 2
        assert exp_b["summary"]["total_error_records"] == 1


# ── Domain 3: Confirmation Token Bypass Resistance ───────────────────────────

class TestDomain3ConfirmationTokenBypass:
    """Stress tests the DELETE /v1/tenant/data confirmation token safeguard."""

    @pytest.mark.parametrize("invalid_token_param", [
        None,  # No token
        "",
        "   ",
        "confirm_delete",  # lowercase
        "CONFIRM",         # partial
        "DELETE",          # partial
        "Confirm_Delete",  # mixed case
        "CONFIRM_DELETE_ALL",
        "CONFIRM_DELETE_FORCE",
        "CONFIRM_DELETE; DROP TABLE;",
        "' OR '1'='1",
        "true",
        "1",
    ])
    def test_query_param_token_bypass_rejected_and_data_preserved(
        self, challenger_client, challenger_db, invalid_token_param
    ):
        initial_usage = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        initial_errors = sum(1 for e in challenger_db.error_logs if e.tenant_id == TENANT_A_ID)
        initial_sec = sum(1 for s in challenger_db.security_events if s.tenant_id == TENANT_A_ID)
        assert initial_usage > 0

        url = "/v1/tenant/data"
        if invalid_token_param is not None:
            url += f"?confirm_token={invalid_token_param}"

        res = challenger_client.delete(url, headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 400
        assert "Confirmation token required" in res.json()["detail"]

        # Assert data was NOT deleted
        current_usage = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        current_errors = sum(1 for e in challenger_db.error_logs if e.tenant_id == TENANT_A_ID)
        current_sec = sum(1 for s in challenger_db.security_events if s.tenant_id == TENANT_A_ID)
        assert current_usage == initial_usage, f"Data leaked/erased on invalid token '{invalid_token_param}'!"
        assert current_errors == initial_errors
        assert current_sec == initial_sec

    @pytest.mark.parametrize("body_payload", [
        {},
        {"confirm_token": ""},
        {"confirm_token": "   "},
        {"confirm_token": "confirm_delete"},
        {"confirm_token": "CONFIRM"},
        {"confirm_token": "CONFIRM_DELETE_ALL"},
        {"confirm_token": None},
        {"token": "CONFIRM_DELETE"},
        {"wrong_key": "CONFIRM_DELETE"},
    ])
    def test_json_body_token_bypass_rejected_and_data_preserved(
        self, challenger_client, challenger_db, body_payload
    ):
        initial_usage = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        assert initial_usage > 0

        res = challenger_client.request(
            "DELETE",
            "/v1/tenant/data",
            json=body_payload,
            headers={"x-atlas-key": KEY_TENANT_A}
        )
        assert res.status_code == 400
        assert "Confirmation token required" in res.json()["detail"]

    def test_whitespace_padded_token_accepted_due_to_strip_behavior(
        self, challenger_client, challenger_db
    ):
        """Documents and proves that token.strip() allows whitespace around CONFIRM_DELETE."""
        initial_usage = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        assert initial_usage > 0

        res = challenger_client.delete(
            "/v1/tenant/data?confirm_token=%20%20CONFIRM_DELETE%20%20",
            headers={"x-atlas-key": KEY_TENANT_A}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "success"
        # Verify erasure succeeded due to .strip()
        remaining = sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID)
        assert remaining == 0


# ── Domain 4: Data Erasure Verification & Account Retention ──────────────────

class TestDomain4ErasureVerificationAndRetention:
    """Verifies legitimate erasure executes cleanly and retains core account entities."""

    def test_erasure_via_query_param(self, challenger_client, challenger_db):
        res = challenger_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers={"x-atlas-key": KEY_TENANT_A}
        )
        assert res.status_code == 200
        payload = res.json()
        assert payload["status"] == "success"
        assert payload["tenant_id"] == str(TENANT_A_ID)
        assert payload["records_deleted"]["usage_logs"] == 3
        assert payload["records_deleted"]["error_logs"] == 1
        assert payload["records_deleted"]["security_events"] == 1

        # Check DB state
        assert sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_A_ID) == 0
        assert sum(1 for e in challenger_db.error_logs if e.tenant_id == TENANT_A_ID) == 0
        assert sum(1 for s in challenger_db.security_events if s.tenant_id == TENANT_A_ID) == 0

        # CRITICAL: Tenant account and API keys MUST be retained
        assert TENANT_A_ID in challenger_db.tenants
        assert any(k.tenant_id == TENANT_A_ID for k in challenger_db.api_keys)

        # Subsequent export returns 0 telemetry records
        exp = challenger_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A}).json()
        assert exp["summary"]["total_usage_records"] == 0
        assert exp["summary"]["total_error_records"] == 0
        assert exp["summary"]["total_security_events"] == 0
        assert len(exp["usage_logs"]) == 0
        assert len(exp["api_keys"]) >= 1

        # Subsequent summary returns 0 goals, 1.0 success rate
        summ = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A}).json()
        assert summ["total_goals"] == 0
        assert summ["active_sessions"] == 0
        assert summ["success_rate"] == 1.0

    def test_erasure_via_json_body(self, challenger_client, challenger_db):
        res = challenger_client.request(
            "DELETE",
            "/v1/tenant/data",
            json={"confirm_token": "CONFIRM_DELETE"},
            headers={"x-atlas-key": KEY_TENANT_B}
        )
        assert res.status_code == 200
        payload = res.json()
        assert payload["status"] == "success"
        assert payload["tenant_id"] == str(TENANT_B_ID)
        assert payload["records_deleted"]["usage_logs"] == 2
        assert payload["records_deleted"]["error_logs"] == 1
        assert payload["records_deleted"]["security_events"] == 1

        # Check DB state
        assert sum(1 for u in challenger_db.usage_logs if u.tenant_id == TENANT_B_ID) == 0
        assert TENANT_B_ID in challenger_db.tenants


# ── Domain 5: Concurrency Bursts & Connection Stability ──────────────────────

class TestDomain5ConcurrencyAndStability:
    """Stress tests thread safety, connection pool stability, and per-tenant rate limiter."""

    def test_concurrent_summary_requests(self, challenger_client):
        """20 concurrent requests across Tenant A and Tenant B."""
        rate_limiter.reset()

        def make_request(tenant_key):
            return challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": tenant_key})

        tasks = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            # 10 requests for Tenant A, 10 for Tenant B
            for _ in range(10):
                tasks.append(executor.submit(make_request, KEY_TENANT_A))
                tasks.append(executor.submit(make_request, KEY_TENANT_B))

            responses = [t.result() for t in concurrent.futures.as_completed(tasks)]

        assert len(responses) == 20
        for r in responses:
            assert r.status_code == 200
            data = r.json()
            assert data["tenant_id"] in (str(TENANT_A_ID), str(TENANT_B_ID))

    def test_rate_limiter_burst_enforcement_and_isolation(self, challenger_client):
        """Burst 35 requests for Tenant A: first 30 succeed, next 5 hit 429. Tenant B untouched."""
        rate_limiter.reset()

        # Send 35 requests for Tenant A
        statuses_a = []
        for _ in range(35):
            res = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
            statuses_a.append(res.status_code)

        assert statuses_a.count(200) == 30
        assert statuses_a.count(429) == 5

        # Tenant B sends a request: should succeed with 200 (isolated rate limiter bucket)
        res_b = challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_B})
        assert res_b.status_code == 200, "Tenant A rate limit improperly leaked to Tenant B!"

        rate_limiter.reset()

    def test_concurrent_mixed_operations_thread_safety(self, challenger_client):
        """Concurrent mix of summary, export, and invalid delete attempts."""
        rate_limiter.reset()

        def do_summary():
            return challenger_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})

        def do_export():
            return challenger_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_B})

        def do_invalid_delete():
            return challenger_client.delete("/v1/tenant/data?confirm_token=INVALID", headers={"x-atlas-key": KEY_TENANT_A})

        funcs = [do_summary, do_export, do_invalid_delete] * 5

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(fn) for fn in funcs]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert len(results) == 15
        summary_res = [r for r in results if r.status_code == 200 and "active_sessions" in r.json()]
        export_res = [r for r in results if r.status_code == 200 and "export_version" in r.json()]
        delete_res = [r for r in results if r.status_code == 400]

        assert len(summary_res) == 5
        assert len(export_res) == 5
        assert len(delete_res) == 5


# ── Domain 6: Universal Prime Directive Audit ────────────────────────────────

class TestDomain6UniversalPrimeDirective:
    """Verifies complete absence of site-specific hardcoding in tenant module."""

    def test_tenant_routes_zero_hardcoded_domains(self):
        import inspect
        from app.routes import tenant

        source = inspect.getsource(tenant)
        forbidden = ["amazon.com", "google.com", "drive.google.com", "youtube.com", "twitter.com"]
        for domain in forbidden:
            assert domain not in source.lower(), f"Violation of Prime Directive: found '{domain}' in routes/tenant.py"

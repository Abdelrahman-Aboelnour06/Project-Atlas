"""
Project Atlas — Automated Test Suite: Tenant Summary & GDPR Endpoints
backend/tests/test_tenant_gdpr.py

Covers:
1. Authentication & Rate Limiting (x-atlas-key enforcement, missing/invalid/oversized keys, rate limit 429).
2. GET /v1/tenant/summary (sessions, total goals, success rate calculation, latency, unseeded tenant fallback).
3. GET /v1/tenant/export (GDPR Art. 15/20 data portability, key hash sanitization, schema completeness).
4. DELETE /v1/tenant/data (GDPR Art. 17 right to erasure, token gating with 'CONFIRM_DELETE', rollback safety).
5. Multi-Tenant IDOR Isolation (verifies strict tenant segregation across summary, export, and erasure).

Strictly adheres to Project Atlas Prime Directive (100% universal across all sites).
"""

import datetime
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.db.connection import get_db
from app.db.models import Tenant, ApiKey, UsageLog, ErrorLog, SecurityEvent
from app.agent import rate_limiter

# ── Test Constants & Tenant Fixture Setup ─────────────────────────────────────

TENANT_A_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_B_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
DEMO_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

KEY_TENANT_A = "atlas_tenant_a_0123456789abcdef"
KEY_TENANT_B = "atlas_tenant_b_9876543210fedcba"
KEY_DEMO = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
INVALID_KEY = "atlas_invalid_key_9999999999999999"


class StatefulTenantDatabase:
    """
    Genuine in-memory relational state simulator for tenant multi-tenancy tests.
    Maintains real state, filters strictly by tenant_id, and produces real rowcounts.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        self.tenants = {
            TENANT_A_ID: Tenant(
                id=TENANT_A_ID,
                company_name="Acme Corp",
                email="admin@acme.test",
                created_at=now,
            ),
            TENANT_B_ID: Tenant(
                id=TENANT_B_ID,
                company_name="Beta Logistics",
                email="security@beta.test",
                created_at=now,
            ),
        }
        self.api_keys = [
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                key_prefix="atlas_tenant_a_",
                key_hash="hash_a_secret_1234567890abcdef",
                is_active=True,
                created_at=now,
            ),
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                key_prefix="atlas_tenant_a2",
                key_hash="hash_a2_secret_9876543210fedcba",
                is_active=True,
                created_at=now,
            ),
            ApiKey(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                key_prefix="atlas_tenant_b_",
                key_hash="hash_b_secret_0000000000000000",
                is_active=True,
                created_at=now,
            ),
        ]
        self.usage_logs = [
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="session-a1",
                url="https://site-a.test/home",
                command="Open dashboard",
                action="click",
                element_id="btn-nav",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="session-a1",
                url="https://site-a.test/settings",
                command="Go to settings",
                action="click",
                element_id="btn-settings",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="session-a2",
                url="https://site-a.test/checkout",
                command="Submit order",
                action="click",
                element_id="btn-pay",
                timestamp=now,
            ),
            UsageLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                session_id="session-b1",
                url="https://site-b.test/portal",
                command="Login",
                action="fill",
                element_id="input-user",
                timestamp=now,
            ),
        ]
        self.error_logs = [
            ErrorLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                url="https://site-a.test/home",
                element_id="img-logo",
                error_type="missing_alt",
                suggestion="Add alt='Acme logo'",
                flagged_at=now,
            ),
            ErrorLog(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                url="https://site-b.test/portal",
                element_id="btn-submit",
                error_type="missing_aria",
                suggestion="Add aria-label='Submit'",
                flagged_at=now,
            ),
        ]
        self.security_events = [
            SecurityEvent(
                id=uuid.uuid4(),
                tenant_id=TENANT_A_ID,
                session_id="session-a1",
                category="suspicious_input",
                created_at=now,
            ),
            SecurityEvent(
                id=uuid.uuid4(),
                tenant_id=TENANT_B_ID,
                session_id="session-b1",
                category="rate_limit_warning",
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
def tenant_state():
    """Stateful database fixture for tenant testing."""
    state = StatefulTenantDatabase()
    yield state


@pytest.fixture
def gdpr_client(tenant_state):
    """FastAPI TestClient with injected stateful database and API key validation."""
    rate_limiter.reset()

    async def override_get_db():
        yield tenant_state

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
        if clean == KEY_DEMO:
            return DEMO_TENANT_ID
        return None

    with patch("app.db.connection.validate_api_key", new=AsyncMock(side_effect=mock_validate_api_key)):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()
    rate_limiter.reset()


# ── 1. Authentication & Rate Limiting Tests ────────────────────────────────────

class TestTenantAuthentication:
    def test_summary_missing_key_returns_401(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/summary")
        assert res.status_code == 401
        assert "Missing API key" in res.json()["detail"]

    def test_summary_empty_key_returns_401(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": "   "})
        assert res.status_code == 401

    def test_summary_oversized_key_returns_401(self, gdpr_client):
        oversized = "a" * 300
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": oversized})
        assert res.status_code == 401

    def test_summary_invalid_key_returns_401(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": INVALID_KEY})
        assert res.status_code == 401
        assert "Invalid or inactive API key" in res.json()["detail"]

    def test_export_unauthenticated_returns_401(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/export")
        assert res.status_code == 401

    def test_delete_unauthenticated_returns_401(self, gdpr_client):
        res = gdpr_client.delete("/v1/tenant/data?confirm_token=CONFIRM_DELETE")
        assert res.status_code == 401

    def test_rate_limit_exceeded_returns_429(self, gdpr_client):
        with patch("app.agent.rate_limiter.check", return_value=False):
            res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
            assert res.status_code == 429
            assert "Rate limit exceeded" in res.json()["detail"]


# ── 2. GET /v1/tenant/summary Tests ───────────────────────────────────────────

class TestTenantSummary:
    def test_summary_success_metrics(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        data = res.json()
        assert data["tenant_id"] == str(TENANT_A_ID)
        assert data["company_name"] == "Acme Corp"
        assert data["email"] == "admin@acme.test"
        assert data["active_sessions"] == 2
        assert data["total_goals"] == 3
        assert data["api_keys_count"] == 2
        assert data["accessibility_issues_flagged"] == 1
        # success_rate = (3 - 1) / 3 = 0.667
        assert data["success_rate"] == 0.667
        assert data["average_hop_latency_ms"] == 185.4
        assert "created_at" in data

    def test_summary_zero_goals_default_success_rate(self, gdpr_client, tenant_state):
        # Clear usage logs for Tenant A
        tenant_state.usage_logs = [u for u in tenant_state.usage_logs if u.tenant_id != TENANT_A_ID]
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        data = res.json()
        assert data["total_goals"] == 0
        assert data["active_sessions"] == 0
        assert data["success_rate"] == 1.0

    def test_summary_fallback_for_unseeded_tenant(self, gdpr_client):
        # Demo tenant has no row in tenants table in our stateful DB
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_DEMO})
        assert res.status_code == 200
        data = res.json()
        assert data["tenant_id"] == str(DEMO_TENANT_ID)
        assert data["company_name"] == "Atlas Demo Corp"
        assert data["email"] == "demo@atlas-saas.com"
        assert data["success_rate"] == 1.0

    def test_summary_success_rate_clamping(self, gdpr_client, tenant_state):
        # Add many error logs exceeding goals to ensure success rate doesn't go below 0.0
        for _ in range(10):
            tenant_state.error_logs.append(
                ErrorLog(
                    id=uuid.uuid4(),
                    tenant_id=TENANT_A_ID,
                    url="https://site-a.test",
                    error_type="missing_alt",
                )
            )
        res = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        assert res.json()["success_rate"] == 0.0


# ── 3. GET /v1/tenant/export Tests ────────────────────────────────────────────

class TestTenantExport:
    def test_export_success_schema(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        data = res.json()
        assert data["export_version"] == "1.0"
        assert "exported_at" in data
        assert data["tenant"]["id"] == str(TENANT_A_ID)
        assert data["tenant"]["company_name"] == "Acme Corp"
        assert len(data["api_keys"]) == 2
        assert len(data["usage_logs"]) == 3
        assert len(data["error_logs"]) == 1
        assert len(data["security_events"]) == 1
        assert data["summary"]["total_sessions"] == 2
        assert data["summary"]["total_usage_records"] == 3
        assert data["summary"]["total_error_records"] == 1
        assert data["summary"]["total_security_events"] == 1

    def test_export_never_exposes_raw_key_hashes(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        content = res.text
        # Verify sensitive secret hash is never serialized
        assert "key_hash" not in content
        assert "hash_a_secret" not in content
        # But non-sensitive key_prefix is included
        assert "key_prefix" in content
        assert "atlas_tenant_a_" in content

    def test_export_summary_counts_match_records(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        data = res.json()
        assert len(data["usage_logs"]) == data["summary"]["total_usage_records"]
        assert len(data["error_logs"]) == data["summary"]["total_error_records"]
        assert len(data["security_events"]) == data["summary"]["total_security_events"]


# ── 4. DELETE /v1/tenant/data Tests ───────────────────────────────────────────

class TestTenantDataErasure:
    def test_delete_missing_token_returns_400(self, gdpr_client):
        res = gdpr_client.delete("/v1/tenant/data", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 400
        assert "Confirmation token required" in res.json()["detail"]

    def test_delete_empty_token_returns_400(self, gdpr_client):
        res = gdpr_client.delete("/v1/tenant/data?confirm_token=", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 400
        assert "Confirmation token required" in res.json()["detail"]

    def test_delete_wrong_token_returns_400(self, gdpr_client):
        res = gdpr_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM",
            headers={"x-atlas-key": KEY_TENANT_A},
        )
        assert res.status_code == 400
        assert "Confirmation token required" in res.json()["detail"]

    def test_delete_query_param_token_success(self, gdpr_client, tenant_state):
        res = gdpr_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers={"x-atlas-key": KEY_TENANT_A},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["tenant_id"] == str(TENANT_A_ID)
        assert data["records_deleted"]["usage_logs"] == 3
        assert data["records_deleted"]["error_logs"] == 1
        assert data["records_deleted"]["security_events"] == 1
        assert "GDPR Article 17" in data["message"]
        assert tenant_state.commit_count >= 1

        # Confirm records actually purged in state
        remaining_a_usage = [u for u in tenant_state.usage_logs if u.tenant_id == TENANT_A_ID]
        assert len(remaining_a_usage) == 0

    def test_delete_json_body_token_success(self, gdpr_client, tenant_state):
        res = gdpr_client.request(
            "DELETE",
            "/v1/tenant/data",
            json={"confirm_token": "CONFIRM_DELETE"},
            headers={"x-atlas-key": KEY_TENANT_A},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["records_deleted"]["usage_logs"] == 3

    def test_delete_purges_telemetry_keeps_account_intact(self, gdpr_client, tenant_state):
        # GDPR Article 17 purges telemetry/personal data, but leaves account/API key intact
        res = gdpr_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers={"x-atlas-key": KEY_TENANT_A},
        )
        assert res.status_code == 200
        # Tenant row and API keys still exist
        assert TENANT_A_ID in tenant_state.tenants
        keys = [k for k in tenant_state.api_keys if k.tenant_id == TENANT_A_ID]
        assert len(keys) == 2

    def test_delete_database_error_rolls_back_and_returns_500(self, gdpr_client, tenant_state):
        with patch.object(tenant_state, "commit", side_effect=Exception("Database lock timeout")):
            res = gdpr_client.delete(
                "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
                headers={"x-atlas-key": KEY_TENANT_A},
            )
            assert res.status_code == 500
            assert "Database transaction error" in res.json()["detail"]
            assert tenant_state.rollback_count >= 1


# ── 5. Multi-Tenant IDOR Isolation Tests ──────────────────────────────────────

class TestMultiTenantIdorIsolation:
    def test_tenant_a_cannot_view_tenant_b_summary(self, gdpr_client):
        res_a = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_A})
        assert res_a.status_code == 200
        assert res_a.json()["tenant_id"] == str(TENANT_A_ID)
        assert res_a.json()["company_name"] == "Acme Corp"

        res_b = gdpr_client.get("/v1/tenant/summary", headers={"x-atlas-key": KEY_TENANT_B})
        assert res_b.status_code == 200
        assert res_b.json()["tenant_id"] == str(TENANT_B_ID)
        assert res_b.json()["company_name"] == "Beta Logistics"

    def test_tenant_a_export_never_leaks_tenant_b_data(self, gdpr_client):
        res = gdpr_client.get("/v1/tenant/export", headers={"x-atlas-key": KEY_TENANT_A})
        assert res.status_code == 200
        content = res.text
        # Assert Tenant B information never appears in Tenant A export
        assert str(TENANT_B_ID) not in content
        assert "Beta Logistics" not in content
        assert "security@beta.test" not in content
        assert "site-b.test" not in content

    def test_tenant_a_delete_never_deletes_tenant_b_records(self, gdpr_client, tenant_state):
        # Count initial Tenant B data
        initial_b_usage = [u for u in tenant_state.usage_logs if u.tenant_id == TENANT_B_ID]
        initial_b_errors = [e for e in tenant_state.error_logs if e.tenant_id == TENANT_B_ID]
        initial_b_sec = [s for s in tenant_state.security_events if s.tenant_id == TENANT_B_ID]
        assert len(initial_b_usage) == 1
        assert len(initial_b_errors) == 1
        assert len(initial_b_sec) == 1

        # Execute erasure for Tenant A
        res = gdpr_client.delete(
            "/v1/tenant/data?confirm_token=CONFIRM_DELETE",
            headers={"x-atlas-key": KEY_TENANT_A},
        )
        assert res.status_code == 200

        # Verify Tenant B data remains 100% intact
        remaining_b_usage = [u for u in tenant_state.usage_logs if u.tenant_id == TENANT_B_ID]
        remaining_b_errors = [e for e in tenant_state.error_logs if e.tenant_id == TENANT_B_ID]
        remaining_b_sec = [s for s in tenant_state.security_events if s.tenant_id == TENANT_B_ID]
        assert len(remaining_b_usage) == 1
        assert len(remaining_b_errors) == 1
        assert len(remaining_b_sec) == 1
        assert remaining_b_usage[0].url == "https://site-b.test/portal"

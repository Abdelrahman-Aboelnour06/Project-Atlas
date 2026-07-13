"""
test_db_utils.py — DB utility tests.

Covers: hash_key correctness, validate_api_key behavior.

Also surfaces Blocker 3 from the progress doc:
  validate_api_key() currently returns a plain bool, but agent.py does
  `tenant_id = await validate_api_key(...)` and passes that into _log_usage.
  UsageLog.tenant_id is a UUID FK — True will fail the insert.
  The test below flags this explicitly.
"""
import hashlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.db.connection import hash_key


# ── hash_key ──────────────────────────────────────────────────────────────────

class TestHashKey:
    def test_returns_64_char_hex(self):
        h = hash_key("atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6")
        assert len(h) == 64, "SHA-256 digest must be 64 hex chars"
        assert all(c in "0123456789abcdef" for c in h)

    def test_deterministic(self):
        key = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
        assert hash_key(key) == hash_key(key)

    def test_different_keys_different_hashes(self):
        assert hash_key("atlas_key1") != hash_key("atlas_key2")

    def test_matches_expected_sha256(self):
        key      = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
        expected = hashlib.sha256(key.encode()).hexdigest()
        assert hash_key(key) == expected

    def test_seed_key_hash_is_stable(self):
        """
        The seed script stores this exact hash — if it ever changes,
        the demo key stops working.
        """
        key      = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
        expected = hashlib.sha256(key.encode()).hexdigest()
        assert hash_key(key) == expected, (
            "hash_key output changed — re-run seed.py to fix the demo key"
        )


# ── validate_api_key ──────────────────────────────────────────────────────────

class TestValidateApiKey:
    @pytest.mark.asyncio
    async def test_valid_key_returns_truthy(self):
        """
        With a mocked DB that returns a matching ApiKey row,
        validate_api_key must return something truthy.
        """
        from app.db.connection import validate_api_key
        from app.db.models import ApiKey, Tenant
        import uuid

        mock_key_row = MagicMock(spec=ApiKey)
        mock_key_row.tenant_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        mock_key_row.is_active = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_key_row

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await validate_api_key(
            mock_db, "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
        )
        assert result

    @pytest.mark.asyncio
    async def test_invalid_key_returns_falsy(self):
        from app.db.connection import validate_api_key

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await validate_api_key(mock_db, "atlas_wrongkey")
        assert not result

    @pytest.mark.asyncio
    async def test_inactive_key_returns_falsy(self):
        from app.db.connection import validate_api_key
        from app.db.models import ApiKey
        import uuid

        # Row exists but is_active = False — should be filtered by the query
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None  # filtered out

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await validate_api_key(mock_db, "atlas_inactivekey")
        assert not result

    @pytest.mark.asyncio
    async def test_blocker_3_validate_returns_bool_not_uuid(self):
        """
        ⚠️  BLOCKER 3 from ATLAS_PROGRESS_2.md:
        validate_api_key() currently returns a plain bool.
        agent.py does: tenant_id = await validate_api_key(...)
        then passes tenant_id into _log_usage(tenant_id=tenant_id, ...)
        UsageLog.tenant_id is a UUID FK — True will crash the DB insert.

        This test will FAIL until validate_api_key is fixed to return
        the actual tenant UUID (or None on failure), not just True/False.
        Mark as xfail until fixed — it documents the bug.
        """
        from app.db.connection import validate_api_key
        from app.db.models import ApiKey
        import uuid

        mock_key_row = MagicMock(spec=ApiKey)
        mock_key_row.tenant_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_key_row

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await validate_api_key(
            mock_db, "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
        )

        # This is what agent.py NEEDS: the actual UUID, not True
        assert isinstance(result, uuid.UUID), (
            "BLOCKER 3: validate_api_key must return the tenant UUID, not bool. "
            "Fix connection.py: return row.tenant_id instead of True."
        )

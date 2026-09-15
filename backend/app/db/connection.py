import asyncio
import hashlib
import logging
import os
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

# Ensure .env is loaded regardless of current working directory
_env_candidates = [
    Path.cwd() / ".env",
    Path.cwd() / "backend" / ".env",
    Path(__file__).resolve().parent.parent.parent / ".env",
    Path(__file__).resolve().parent.parent / ".env",
]
for _p in _env_candidates:
    if _p.is_file():
        load_dotenv(dotenv_path=_p)
        break

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import ApiKey, UsageLog, SecurityEvent

logger = logging.getLogger(__name__)

# ── Engine ────────────────────────────────────────────────────────────────────
# DATABASE_URL must use the asyncpg driver:
#   postgresql+asyncpg://user:password@localhost:5432/atlas
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/atlas",
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_recycle=300,
)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


# ── Dependency — use with FastAPI Depends() ───────────────────────────────────
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def get_db_context():
    """Context manager for acquiring short-lived DB sessions on demand."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── In-Memory TTLCache for Auth Hashing & Lookups (Feature 14) ────────────────
class TTLCache:
    """Thread-safe, high-performance in-memory cache with monotonic TTL expiration."""
    def __init__(self, maxsize: int = 2048, ttl: float = 300.0):
        self.maxsize = maxsize
        self.ttl = ttl
        self._cache: OrderedDict[str, tuple[uuid.UUID, float]] = OrderedDict()

    def get(self, key: str) -> uuid.UUID | None:
        now = time.monotonic()
        if key in self._cache:
            val, exp = self._cache[key]
            if now < exp:
                self._cache.move_to_end(key)
                return val
            del self._cache[key]
        return None

    def set(self, key: str, val: uuid.UUID) -> None:
        now = time.monotonic()
        if key in self._cache:
            del self._cache[key]
        elif len(self._cache) >= self.maxsize:
            self._cache.popitem(last=False)
        self._cache[key] = (val, now + self.ttl)

    def clear(self) -> None:
        self._cache.clear()


_auth_cache = TTLCache(maxsize=2048, ttl=300.0)


# ── API Key Utilities ─────────────────────────────────────────────────────────
def hash_key_pbkdf2(api_key: str, salt: bytes = b"atlas_salt_v1_secure") -> str:
    """Hardened key hash using PBKDF2-HMAC-SHA256 (100,000 iterations) -> 64 hex characters."""
    return hashlib.pbkdf2_hmac("sha256", api_key.encode(), salt, 100_000).hex()


def hash_key(api_key: str) -> str:
    """SHA-256 hash of the raw API key (retained for backward-compatibility with seeded DBs)."""
    return hashlib.sha256(api_key.encode()).hexdigest()


async def validate_api_key(db: AsyncSession, api_key: str) -> uuid.UUID | None:
    """
    Returns the tenant_id (UUID) if the API key exists in the DB and is
    active, otherwise None. Supports both hardened PBKDF2 and legacy hashes.
    Uses in-memory TTLCache and offloads PBKDF2 computation to a worker thread.
    Fast-path rejects invalid, empty, non-string, or oversized keys (>256 chars) to prevent DoS.
    """
    if not isinstance(api_key, str):
        return None
    api_key_clean = api_key.strip()
    if not api_key_clean or len(api_key_clean) > 256:
        return None

    cached_tid = _auth_cache.get(api_key_clean)
    if cached_tid is not None:
        return cached_tid

    legacy_hash = hash_key(api_key_clean)
    hardened_hash = await asyncio.to_thread(hash_key_pbkdf2, api_key_clean)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_hash.in_([legacy_hash, hardened_hash]),
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    api_key_row = result.scalar_one_or_none()
    tenant_id = api_key_row.tenant_id if api_key_row else None
    if tenant_id is not None:
        _auth_cache.set(api_key_clean, tenant_id)
    return tenant_id


# ── Usage Logging (Task 6/7 requirement) ──────────────────────────────────────

async def _log_usage(
    db: AsyncSession,
    session_id: str,
    tenant_id: uuid.UUID,
    log_details: dict,
    url: str | None = None,
) -> None:
    """
    Persists one usage_logs row for a completed command-pipeline action.

    BUGFIX (blocker #1, ATLAS_PROGRESS_2.md): routes/agent.py imports this
    function but it never existed in this file, which made the whole app
    fail to boot (ImportError). This fills that gap.

    `log_details` is the trimmed dict produced by
    `app.agent.sanitize.trim_log_payload()` — only `command_snippet`,
    `resolved_action`, and `target_element` are persisted (mapped onto the
    `command`, `action`, `element_id` columns); raw DOM maps and full
    command text are never stored, per the PII/data-retention rules in the
    project overview.

    Never raises — a failed usage-log write should not break the
    user-facing WebSocket response. Errors are logged and the transaction
    is rolled back so the session stays usable for the next message.
    """
    try:
        db.add(
            UsageLog(
                tenant_id=tenant_id,
                session_id=session_id or "",
                url=url,
                command=log_details.get("command_snippet"),
                action=log_details.get("resolved_action"),
                element_id=log_details.get("target_element"),
            )
        )
        await db.commit()
    except Exception:
        logger.exception("Failed to write usage_logs row (tenant_id=%s)", tenant_id)
        try:
            await db.rollback()
        except Exception:
            pass


async def _record_security_event(
    db: AsyncSession,
    session_id: str,
    category: str,
    tenant_id: uuid.UUID | None = None,
) -> None:
    """
    Records an audit security event when a raw secret is detected in an incoming command.
    Captures only session_id, tenant_id, category, and timestamp — NEVER secret values.
    Never raises to avoid interrupting request lifecycle.
    """
    try:
        db.add(
            SecurityEvent(
                tenant_id=tenant_id,
                session_id=session_id or "",
                category=category,
            )
        )
        await db.commit()
    except Exception:
        logger.exception("Failed to record security event (session_id=%s, category=%s)", session_id, category)
        try:
            await db.rollback()
        except Exception:
            pass


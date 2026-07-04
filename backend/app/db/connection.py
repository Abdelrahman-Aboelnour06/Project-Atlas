import hashlib
import logging
import os
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import ApiKey, UsageLog

logger = logging.getLogger(__name__)

# ── Engine ────────────────────────────────────────────────────────────────────
# DATABASE_URL must use the asyncpg driver:
#   postgresql+asyncpg://user:password@localhost:5432/atlas
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/atlas",
)

engine = create_async_engine(DATABASE_URL, echo=False, future=True)

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
        yield session


# ── API Key Utilities ─────────────────────────────────────────────────────────
def hash_key(api_key: str) -> str:
    """SHA-256 hash of the raw API key — this is what we store in the DB."""
    return hashlib.sha256(api_key.encode()).hexdigest()


async def validate_api_key(db: AsyncSession, api_key: str) -> uuid.UUID | None:
    """
    Returns the tenant_id (UUID) if the API key exists in the DB and is
    active, otherwise None.

    BUGFIX (blocker #3, ATLAS_PROGRESS_2.md): this used to return a plain
    bool. agent.py does `tenant_id = await validate_api_key(...)` and then
    passes that straight into `_log_usage(tenant_id=tenant_id, ...)`, and
    UsageLog.tenant_id is a UUID foreign key — `True` would fail that
    insert against a real Postgres DB. Returning the actual tenant UUID (or
    None) fixes that; callers can still do a plain `if not tenant_id`
    truthiness check for the auth gate exactly as before.
    """
    key_hash = hash_key(api_key)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    api_key_row = result.scalar_one_or_none()
    return api_key_row.tenant_id if api_key_row else None


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

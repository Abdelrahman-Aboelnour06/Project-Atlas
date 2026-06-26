import hashlib
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import ApiKey

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


async def validate_api_key(db: AsyncSession, api_key: str) -> bool:
    """
    Returns True if the API key exists in the DB and is active.
    Replaces the MOCK_VALID_KEY check from Task 2.
    """
    key_hash = hash_key(api_key)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none() is not None

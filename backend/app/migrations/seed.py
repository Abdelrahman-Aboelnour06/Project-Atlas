"""
Seed Script — inserts one mock tenant and the demo API key.

Run from inside the backend/ folder:
    python -m app.migrations.seed

Requires DATABASE_URL in your .env file.
"""
import asyncio
import hashlib
import os
import uuid

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/atlas",
)

# ── Demo values — keep in sync with MOCK_VALID_KEY in routes ─────────────────
DEMO_API_KEY    = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
DEMO_TENANT_ID  = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEMO_APIKEY_ID  = uuid.UUID("00000000-0000-0000-0000-000000000002")


async def seed():
    engine = create_async_engine(DATABASE_URL, echo=True)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        from sqlalchemy import text

        # Insert mock tenant (ignore if already exists)
        await db.execute(text("""
            INSERT INTO tenants (id, company_name, email)
            VALUES (:id, :company_name, :email)
            ON CONFLICT (email) DO NOTHING
        """), {
            "id":           str(DEMO_TENANT_ID),
            "company_name": "Atlas Demo Corp",
            "email":        "demo@atlas-saas.com",
        })

        # Insert mock API key
        key_hash   = hashlib.sha256(DEMO_API_KEY.encode()).hexdigest()
        key_prefix = DEMO_API_KEY[:16]

        await db.execute(text("""
            INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, is_active)
            VALUES (:id, :tenant_id, :key_hash, :key_prefix, TRUE)
            ON CONFLICT (key_hash) DO NOTHING
        """), {
            "id":         str(DEMO_APIKEY_ID),
            "tenant_id":  str(DEMO_TENANT_ID),
            "key_hash":   key_hash,
            "key_prefix": key_prefix,
        })

        await db.commit()

    await engine.dispose()
    print("✅ Seed complete")
    print(f"   Tenant:  Atlas Demo Corp (demo@atlas-saas.com)")
    print(f"   API Key: {DEMO_API_KEY}")
    print(f"   Key hash stored in DB: {key_hash[:16]}...")


if __name__ == "__main__":
    asyncio.run(seed())

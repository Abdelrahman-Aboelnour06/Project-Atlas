import logging
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.db import connection as db_connection
from app.agent import rate_limiter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/session/start")
async def start_session(
    x_atlas_key: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Validates the tenant API key and returns a session ID.
    The session ID is passed in every subsequent WebSocket message.
    Header: x-atlas-key: atlas_...
    """
    clean_key = x_atlas_key.strip() if x_atlas_key else ""
    if not clean_key or len(clean_key) > 256:
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        tenant_id = await db_connection.validate_api_key(db, clean_key)
    except Exception as exc:
        logger.exception("Database error during session/start")
        raise HTTPException(status_code=500, detail=f"Database connection error: {exc}")

    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not rate_limiter.check(tenant_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded — please slow down and try again shortly.",
        )

    return {"session_id": str(uuid.uuid4()), "status": "ok"}



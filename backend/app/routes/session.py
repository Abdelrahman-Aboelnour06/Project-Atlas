import uuid
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db, validate_api_key

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
    if not await validate_api_key(db, x_atlas_key):
        raise HTTPException(status_code=401, detail="Invalid API key")

    return {"session_id": str(uuid.uuid4()), "status": "ok"}

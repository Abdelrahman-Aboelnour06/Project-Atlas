import uuid
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.db import connection as db_connection

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

    BUGFIX: this used to do `from app.db.connection import validate_api_key`
    and call the bare name. unittest.mock.patch("app.db.connection.
    validate_api_key", ...) patches the attribute on the module object, which
    has no effect on a name already bound via `from ... import` — so tests
    patching validate_api_key never actually reached this route, and an
    invalid key would fall through to whatever the *real* validate_api_key
    saw from the (mocked) DB session instead. Calling through the module
    (`db_connection.validate_api_key`) fixes that.
    """
    tenant_id = await db_connection.validate_api_key(db, x_atlas_key)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return {"session_id": str(uuid.uuid4()), "status": "ok"}

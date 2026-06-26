import uuid
from fastapi import APIRouter, Header, HTTPException

router = APIRouter()

# ── Mock API key — replace with DB lookup once Task 3 is done ────────────────
MOCK_VALID_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"


def validate_api_key(api_key: str) -> bool:
    # TODO (Task 3): replace with real DB lookup
    # from app.db.connection import get_db
    # return db.query(ApiKey).filter_by(key_hash=hash(api_key), is_active=True).first()
    return api_key == MOCK_VALID_KEY


@router.post("/session/start")
async def start_session(x_atlas_key: str = Header(...)):
    """
    Validates the tenant API key and returns a session ID.
    The session ID is passed in every subsequent WebSocket message.
    Header: X-Atlas-Key: atlas_...
    """
    if not validate_api_key(x_atlas_key):
        raise HTTPException(status_code=401, detail="Invalid API key")

    session_id = str(uuid.uuid4())
    return {"session_id": session_id, "status": "ok"}

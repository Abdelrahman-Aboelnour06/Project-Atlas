"""
Task 8 — Error Logging Endpoint
POST /v1/audit/log

Validates the tenant API key (via the shared validate_api_key() in
app/db/connection.py — same one the WS pipeline and /v1/session/start use),
inserts one row per flagged accessibility error into `error_logs`, and
returns how many rows were written.

Auth note: the key is read from the request body (`api_key`), matching what
Task H's fetch() call actually sends (see master task board, Task H) — not
from the `x-atlas-key` header. If a header-based path is added later for
other REST endpoints, this can be extended to accept either.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.db import connection as db_connection
from app.db.models import ErrorLog

router = APIRouter()


# ── Request / response schemas ──────────────────────────────────────────────

class AuditError(BaseModel):
    element_id: str
    error_type: str
    suggestion: Optional[str] = None


class AuditLogRequest(BaseModel):
    api_key: str
    url: str
    errors: list[AuditError]


class AuditLogResponse(BaseModel):
    logged: int


# ── Route ────────────────────────────────────────────────────────────────────

@router.post("/audit/log", response_model=AuditLogResponse)
async def log_audit_errors(
    payload: AuditLogRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Validate the API key → 401 if invalid, then insert each flagged error
    into `error_logs` with the resolved tenant_id. Returns the row count.

    BUGFIX: this used to do its own key_hash + db.execute(select(ApiKey)...)
    lookup instead of calling validate_api_key(). Harmless against a real
    DB, but it meant this route was invisible to
    patch("app.db.connection.validate_api_key", ...) in tests, so an invalid
    key here was actually being checked against the test's generic mocked
    db.execute() (which "finds" a row for any query) instead of the
    properly key-aware mock — always returning 200. Routing through
    validate_api_key() (which already returns the tenant_id UUID directly)
    fixes the test and drops the duplicated lookup logic.
    """
    tenant_id = await db_connection.validate_api_key(db, payload.api_key)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key.")

    if not payload.errors:
        return AuditLogResponse(logged=0)

    for err in payload.errors:
        db.add(
            ErrorLog(
                tenant_id=tenant_id,
                url=payload.url,
                element_id=err.element_id,
                error_type=err.error_type,
                suggestion=err.suggestion,
            )
        )

    await db.commit()
    return AuditLogResponse(logged=len(payload.errors))
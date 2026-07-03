"""
Task 8 — Error Logging Endpoint
POST /v1/audit/log

Validates the tenant API key (via the same key_hash used by the WS pipeline),
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db, hash_key
from app.db.models import ApiKey, ErrorLog

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
    """
    key_hash = hash_key(payload.api_key)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    api_key_row = result.scalar_one_or_none()

    if api_key_row is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key.")

    if not payload.errors:
        return AuditLogResponse(logged=0)

    for err in payload.errors:
        db.add(
            ErrorLog(
                tenant_id=api_key_row.tenant_id,
                url=payload.url,
                element_id=err.element_id,
                error_type=err.error_type,
                suggestion=err.suggestion,
            )
        )

    await db.commit()
    return AuditLogResponse(logged=len(payload.errors))
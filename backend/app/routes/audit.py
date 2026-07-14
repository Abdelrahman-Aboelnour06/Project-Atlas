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
from fastapi import HTTPException
from sqlalchemy import select
from app.agent.llm_client import call_llm

@router.get("/fixes")
async def get_audit_fixes(api_key: str, db: AsyncSession = Depends(get_db)):
    """
    Task 9: Fetches logged accessibility errors for the tenant and uses the LLM
    to generate the corrected HTML code snippets.
    """
    # 1. Authenticate using the same module-qualified pattern
    tenant_id = await db_connection.validate_api_key(db, api_key)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid API Key")

    # 2. Fetch the most recent accessibility errors from the database
    # (Assuming ErrorLog is imported from app.db.models)
    query = select(ErrorLog).where(ErrorLog.tenant_id == tenant_id).order_by(ErrorLog.created_at.desc()).limit(10)
    result = await db.execute(query)
    errors = result.scalars().all()

    if not errors:
        return []

    fixes = []
    
    # 3. Feed the errors to the LLM to generate remediation code
    for error in errors:
        prompt = f"""
        You are an expert web accessibility engineer.
        Fix the following accessibility issue for a webpage element.
        
        Element ID: {error.element_id}
        Error Type: {error.error_type}
        Diagnostic Suggestion: {error.suggestion}
        
        Write the corrected HTML code snippet that resolves this issue.
        Return ONLY the raw HTML code. Do not include markdown fences (```html), explanations, or prose.
        """
        try:
            # We leverage the NVIDIA NIM integration you built
            fix_code = await call_llm(prompt)
            fixes.append({
                "url": error.url,
                "element_id": error.element_id,
                "error_type": error.error_type,
                "fix_code": fix_code.strip("`\n ")
            })
        except Exception as e:
            print(f"LLM Remediation failed for {error.element_id}: {e}")
            continue

    return fixes
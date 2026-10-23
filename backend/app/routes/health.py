from typing import Optional
from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.agent import llm_client

router = APIRouter()


class HealthResponse(BaseModel):
    service: str
    status:  str
    version: str
    db:      str  # "ok" | "unavailable"
    llm:     str  # "ok" | "unavailable"
    provider: Optional[str] = None
    model:    Optional[str] = None
    last_error_class: Optional[str] = None
    last_error_time:  Optional[str] = None
    limited_mode: bool = False


@router.get("/health", response_model=HealthResponse)
async def health_check(response: Response, db: AsyncSession = Depends(get_db)):
    """
    Liveness and readiness probe.
    Returns HTTP 200 if dependencies are healthy, or HTTP 503 Service Unavailable
    if database or LLM service is degraded/unavailable.
    Reports operational provider metadata and limited_mode without exposing secrets or error messages.
    """
    try:
        await db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "unavailable"

    llm_info = llm_client.get_llm_health_info()
    llm_ping_ok = await llm_client.ping_llm()
    llm_status = "ok" if llm_ping_ok else "unavailable"

    limited = bool(llm_info.get("limited_mode") or not llm_ping_ok)

    is_healthy = (db_status == "ok" and llm_status == "ok")
    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return HealthResponse(
        service="atlas-backend",
        status="ok" if is_healthy else "degraded",
        version="0.1.0",
        db=db_status,
        llm=llm_status,
        provider=llm_info.get("provider"),
        model=llm_info.get("model"),
        last_error_class=llm_info.get("last_error_class"),
        last_error_time=llm_info.get("last_error_time"),
        limited_mode=limited,
    )


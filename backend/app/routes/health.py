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


@router.get("/health", response_model=HealthResponse)
async def health_check(response: Response, db: AsyncSession = Depends(get_db)):
    """
    Liveness and readiness probe.
    Returns HTTP 200 if dependencies are healthy, or HTTP 503 Service Unavailable
    if database or LLM service is degraded/unavailable.
    """
    try:
        await db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "unavailable"

    llm_status = "ok" if await llm_client.ping_llm() else "unavailable"

    is_healthy = (db_status == "ok" and llm_status == "ok")
    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return HealthResponse(
        service="atlas-backend",
        status="ok" if is_healthy else "degraded",
        version="0.1.0",
        db=db_status,
        llm=llm_status,
    )


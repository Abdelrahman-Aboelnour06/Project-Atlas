from fastapi import APIRouter, Depends
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
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    Liveness probe.

    `db` and `llm` are real checks, not stubs:
      - db:  a trivial `SELECT 1` through the normal get_db() session —
             reports "unavailable" instead of raising if Postgres is
             unreachable, so this endpoint itself never 500s just because
             a dependency is down.
      - llm: pings the configured provider's model-list endpoint (Ollama
             /api/tags, or /models for an OpenAI-compatible provider) —
             see app.agent.llm_client.ping_llm(). A model listing is
             enough to prove connectivity + auth without spending tokens
             on a full generation every time something polls /health.

    Calls through the `llm_client` module object (`llm_client.ping_llm()`)
    rather than `from app.agent.llm_client import ping_llm` — the latter
    binds the name at import time, so `unittest.mock.patch(
    "app.agent.llm_client.ping_llm", ...)` in tests would silently miss
    this call. Same gotcha already called out in routes/agent.py and
    routes/session.py; matching their convention here too.

    `status` itself always reports "ok" as long as the FastAPI process is
    up and able to answer — it does not reflect db/llm health. A
    monitoring/demo-readiness check should look at the db/llm fields, not
    just the HTTP 200.
    """
    try:
        await db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "unavailable"

    llm_status = "ok" if await llm_client.ping_llm() else "unavailable"

    return HealthResponse(
        service="atlas-backend",
        status="ok",
        version="0.1.0",
        db=db_status,
        llm=llm_status,
    )


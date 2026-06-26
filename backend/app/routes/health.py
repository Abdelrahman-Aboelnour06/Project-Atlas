from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status:  str
    version: str
    db:      str  # "ok" | "unavailable"
    llm:     str  # "ok" | "unavailable"


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Liveness probe.

    Task 2:  db + llm report "unavailable" — not wired yet.
    Task 3:  replace db value with a real SELECT 1 check.
    Task 4:  replace llm value with a ping to the LLM endpoint.
    """
    return HealthResponse(
        status="ok",
        version="0.1.0",
        db="unavailable",   # TODO (Task 3): real DB check
        llm="unavailable",  # TODO (Task 4): real LLM ping
    )

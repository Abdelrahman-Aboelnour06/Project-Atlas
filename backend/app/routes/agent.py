"""
app/routes/agent.py
WebSocket endpoint — Task 7: Full AI pipeline wired.

Per-message flow:
  1. Receive + parse WSMessage
  2. Authenticate API key against DB
  3. build_prompt → call_llm → parse_action
  4. Log result to usage_logs
  5. Send ActionResponse JSON back to client

Concurrent sessions: each connection is an independent async coroutine —
FastAPI + asyncio handles ≥ 2 sessions with no extra work needed.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db, validate_api_key
from app.db.models import UsageLog           # adjust if your ORM class is named differently
from app.models.request import WSMessage     # already exists from Task 2

from app.agent.llm_client import call_llm, LLMError
from app.agent.prompt import build_prompt
from app.agent.parser import parse_action, ParseError, error_response

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Usage logging ─────────────────────────────────────────────────────────────

async def _log_usage(
    db: AsyncSession,
    *,
    tenant_id: int,
    session_id: str,
    url: str,
    command: str,
    action: str,
    element_id: str,
    status: str,
) -> None:
    """
    Writes one record to usage_logs.
    Silently swallows DB errors so a logging failure never kills a live session.

    Adjust field names here if your UsageLog ORM model uses different column names.
    """
    try:
        log = UsageLog(
            tenant_id=tenant_id,
            session_id=session_id,
            url=url,
            command=command,
            action=action,
            element_id=element_id,
            status=status,
            created_at=datetime.now(timezone.utc),
        )
        db.add(log)
        await db.commit()
    except Exception as exc:
        logger.error("usage_log write failed (session=%s): %s", session_id, exc)
        await db.rollback()


# ── WebSocket handler ─────────────────────────────────────────────────────────

@router.websocket("/v1/agent")
async def agent_ws(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    """
    Main Atlas WebSocket handler.

    Keeps the connection open and processes one voice command per message.
    Each call to this function is an independent async coroutine, so
    FastAPI naturally handles multiple concurrent sessions.
    """
    await websocket.accept()
    logger.info("WS connection opened")

    try:
        while True:

            # ── 1. Receive raw text ───────────────────────────────────────
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                logger.info("Client disconnected cleanly")
                return

            # ── 2. Parse WSMessage ────────────────────────────────────────
            try:
                data    = json.loads(raw)
                message = WSMessage(**data)
            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                await websocket.send_text(
                    json.dumps(error_response(f"Malformed message: {exc}"))
                )
                continue

            logger.info(
                "session=%s command=%r dom_nodes=%d",
                message.session_id, message.command, len(message.dom_map),
            )

            # ── 3. Authenticate API key ───────────────────────────────────
            tenant = await validate_api_key(db, message.api_key)
            if tenant is None:
                await websocket.send_text(
                    json.dumps(error_response("Invalid or expired API key."))
                )
                await websocket.close(code=4401)
                return

            # ── 4. AI pipeline ────────────────────────────────────────────
            action_result: dict

            try:
                prompt        = build_prompt(message.dom_map, message.command)
                raw_llm       = await call_llm(prompt)
                action_result = parse_action(raw_llm)

            except LLMError as exc:
                logger.error("LLM failure session=%s: %s", message.session_id, exc)
                action_result = error_response(
                    "AI service unavailable — please try again in a moment."
                )

            except ParseError as exc:
                logger.warning("Parse failure session=%s: %s", message.session_id, exc)
                action_result = error_response(
                    "Couldn't understand the AI response — please rephrase your command."
                )

            # ── 5. Log to usage_logs ──────────────────────────────────────
            await _log_usage(
                db=db,
                tenant_id=tenant.id,
                session_id=message.session_id,
                url=message.url,
                command=message.command,
                action=action_result["action"],
                element_id=action_result["element_id"],
                status=action_result["status"],
            )

            # ── 6. Send response ──────────────────────────────────────────
            await websocket.send_text(json.dumps(action_result))

    except WebSocketDisconnect:
        logger.info("WS disconnected mid-session")

    except Exception as exc:
        logger.exception("Unhandled WS error: %s", exc)
        try:
            await websocket.send_text(
                json.dumps(error_response("Internal server error."))
            )
            await websocket.close(code=1011)
        except Exception:
            pass  # connection already gone

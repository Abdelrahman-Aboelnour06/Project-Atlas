"""
Task 7 — WebSocket handler: full AI pipeline, both "command" and "simplify".

Request lifecycle per message:
  receive_text()
    -> parse JSON                    -> error (connection stays open) on failure
    -> validate shape (AgentMessage) -> error (connection stays open) on failure
    -> handle auth (once per connection)
    -> require authenticated for command/simplify
    -> rate_limiter.check(tenant_id) -> error (connection stays open) if exceeded
    -> strip_pii_from_dom
    -> dispatch by `type`:
         "simplify" -> build_simplify_prompt -> call_llm -> parse_simplify_response
         "command"  -> build_prompt          -> call_llm -> parse_action
    -> log usage (command pipeline only)
    -> send structured JSON response back to the client

NOTE on error handling vs. the original progress-doc description: the doc
said an invalid API key should close the socket with code 4401. This file
instead sends a `status: "error"` JSON reply and keeps the connection open,
so a frontend can recover from one bad message without having to
reconnect — docs/contracts.md v1.2 documents this as the settled contract
(see its "WebSocket error handling" section and versioning table). Only a
truly unhandled exception now closes the socket (1011).

Module-qualified imports (e.g. `from app.agent import llm_client` + calling
`llm_client.call_llm(...)`) are used deliberately instead of
`from app.agent.llm_client import call_llm` — the test suite patches
functions like `app.agent.llm_client.call_llm` at the module level, which
only takes effect on calls made through the module object, not through a
name that was already bound at import time via `from x import y`.
"""
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.db import connection as db_connection

from app.agent import llm_client
from app.agent.llm_client import LLMError
from app.agent import prompt as command_prompt
from app.agent import parser as command_parser
from app.agent import simplify_prompt
from app.agent import simplify_parser
from app.agent import rate_limiter
from app.agent.sanitize import strip_pii_from_dom, trim_log_payload

from app.models.request import AgentMessage
from app.models.action import ActionResponse

logger = logging.getLogger(__name__)
router = APIRouter()


def _simplify_error(message: str) -> dict:
    """Error shape for the simplify pipeline — Contract 5."""
    return {"status": "error", "elements": [], "message": message}


@router.websocket("/agent")
async def websocket_endpoint(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()

    authenticated = False
    tenant_id = None  # set after auth handshake

    try:
        while True:
            raw_data = await websocket.receive_text()

            # 1. Parse JSON
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_json({"status": "error", "message": "Invalid JSON payload."})
                continue

            # 2. Handle authentication message (once per connection)
            if data.get("type") == "auth":
                if authenticated:
                    await websocket.send_json({"status": "error", "message": "Already authenticated."})
                    continue
                api_key = data.get("api_key")
                if not api_key:
                    await websocket.send_json({"status": "error", "message": "Missing api_key in auth message."})
                    continue
                tid = await db_connection.validate_api_key(db, api_key)
                if not tid:
                    await websocket.send_json({"status": "error", "message": "Invalid or inactive API key."})
                    continue
                authenticated = True
                tenant_id = tid
                await websocket.send_json({"status": "ok"})
                continue

            # 3. For any other message type, authenticate per-message or require pre-auth
            msg_api_key = data.get("api_key")
            if msg_api_key:
                tid = await db_connection.validate_api_key(db, msg_api_key)
                if not tid:
                    await websocket.send_json({"status": "error", "message": "Invalid or inactive API key."})
                    continue
                authenticated = True
                tenant_id = tid
            elif not authenticated:
                await websocket.send_json({"status": "error", "message": "Not authenticated. Send auth message first."})
                continue

            # 4. Validate message shape against Contract 1 (type, dom_map, command, ...)
            try:
                message = AgentMessage(**data)
            except ValidationError as exc:
                first = exc.errors()[0]
                field = ".".join(str(p) for p in first["loc"])
                await websocket.send_json({
                    "status": "error",
                    "message": f"Invalid message ({field}): {first['msg']}",
                })
                continue

            # 5. Rate limit — coarse per-tenant circuit breaker (status doc §2.6).
            if not rate_limiter.check(tenant_id):
                logger.warning("Rate limit exceeded for tenant_id=%s", tenant_id)
                if message.type == "simplify":
                    await websocket.send_json(_simplify_error(
                        "Rate limit exceeded — please slow down and try again shortly."
                    ))
                else:
                    await websocket.send_json(ActionResponse.error(
                        "Rate limit exceeded — please slow down and try again shortly."
                    ).model_dump())
                continue

            # 6. Shield the DOM map from PII before it reaches the LLM or gets logged
            # Security enforcement: sensitive nodes must not contain unmasked inner_text
            has_sensitive_leak = any(
                bool(node.sensitive) and bool(node.inner_text)
                for node in message.dom_map
            )
            if has_sensitive_leak:
                logger.error("Security violation: incoming node marked sensitive contains non-null inner_text")
                await websocket.send_json({
                    "status": "error",
                    "message": "Security violation: sensitive fields must not contain text values.",
                })
                continue

            raw_dom = [node.model_dump() for node in message.dom_map]
            safe_dom = strip_pii_from_dom(raw_dom)

            try:
                # 7. Route to the correct pipeline
                if message.type == "simplify":
                    prompt_text = simplify_prompt.build_simplify_prompt(safe_dom)
                    raw_llm = await llm_client.call_llm(prompt_text)
                    elements = simplify_parser.parse_simplify_response(raw_llm, safe_dom)
                    final_response = {"status": "success", "elements": elements, "message": None}

                else:  # "command"
                    prompt_text = command_prompt.build_prompt(safe_dom, message.command)
                    raw_llm = await llm_client.call_llm(prompt_text)
                    action_response = command_parser.parse_action(raw_llm, safe_dom)
                    final_response = action_response.model_dump()

                    # 8. Log ONLY safe, minimal data to PostgreSQL for commands
                    log_details = trim_log_payload(message.command, final_response)
                    await db_connection._log_usage(
                        db=db,
                        session_id=message.session_id,
                        tenant_id=tenant_id,
                        log_details=log_details,
                        url=message.url,
                    )

            # Catch LLM connection/timeout failures gracefully — parse_action and
            # parse_simplify_response never raise, so this is the only pipeline
            # exception left to handle here.
            except LLMError as exc:
                logger.warning("LLM call failed: %s", exc)
                if message.type == "simplify":
                    final_response = _simplify_error("AI service unavailable. Please try again.")
                else:
                    final_response = ActionResponse.error(
                        "AI service unavailable. Please try again."
                    ).model_dump()

            # 9. Send the final JSON payload back to the frontend extension
            await websocket.send_json(final_response)

    except WebSocketDisconnect:
        logger.info("Client disconnected gracefully.")
    except Exception:
        logger.exception("Unhandled server error in /v1/agent")
        try:
            await websocket.send_json({"status": "error", "message": "Internal server error."})
        except Exception:
            pass
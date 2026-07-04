"""
Task 7 — WebSocket handler: full AI pipeline, both "command" and "simplify".

Request lifecycle per message:
  receive_text()
    -> parse JSON                    -> error (connection stays open) on failure
    -> validate shape (AgentMessage) -> error (connection stays open) on failure
    -> validate_api_key (every msg)  -> error (connection stays open) on failure
    -> strip_pii_from_dom
    -> dispatch by `type`:
         "simplify" -> build_simplify_prompt -> call_llm -> parse_simplify_response
         "command"  -> build_prompt          -> call_llm -> parse_action
    -> log usage (command pipeline only)
    -> send structured JSON response back to the client

NOTE on error handling vs. the original progress-doc description: the doc
said an invalid API key should close the socket with code 4401. The shared
test suite (tests/test_websocket.py) instead expects a `status: "error"`
JSON reply with the connection kept open, so a frontend can recover from
one bad message without having to reconnect. This file follows the tests.
If that's not actually what the team wants, docs/contracts.md's error
section should be updated to match (flagging for Person 2 / whoever owns
that doc). Only a truly unhandled exception now closes the socket (1011).

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

    try:
        while True:
            raw_data = await websocket.receive_text()

            # 1. Parse JSON
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_json({"status": "error", "message": "Invalid JSON payload."})
                continue

            # 2. Validate message shape against Contract 1 (type, dom_map, command, ...)
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

            # 3. Auth — validated on every message, not just on connect
            tenant_id = await db_connection.validate_api_key(db, message.api_key)
            if not tenant_id:
                await websocket.send_json({"status": "error", "message": "Invalid or inactive API key."})
                continue

            # 4. Shield the DOM map from PII before it reaches the LLM or gets logged
            raw_dom = [node.model_dump() for node in message.dom_map]
            safe_dom = strip_pii_from_dom(raw_dom)

            try:
                # 5. Route to the correct pipeline
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

                    # 6. Log ONLY safe, minimal data to PostgreSQL for commands
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

            # 7. Send the final JSON payload back to the frontend extension
            await websocket.send_json(final_response)

    except WebSocketDisconnect:
        logger.info("Client disconnected gracefully.")
    except Exception:
        logger.exception("Unhandled server error in /v1/agent")
        try:
            await websocket.send_json({"status": "error", "message": "Internal server error."})
        except Exception:
            pass

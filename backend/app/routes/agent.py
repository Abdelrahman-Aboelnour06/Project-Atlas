import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.models.request import AgentMessage
from app.models.action import ActionResponse

router = APIRouter()

# ── Mock API key — replace with DB lookup once Task 3 is done ────────────────
MOCK_VALID_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"


def validate_api_key(api_key: str) -> bool:
    # TODO (Task 3): replace with real DB lookup
    return api_key == MOCK_VALID_KEY


async def send(ws: WebSocket, response: ActionResponse) -> None:
    await ws.send_text(response.model_dump_json())


@router.websocket("/agent")
async def agent_websocket(ws: WebSocket):
    """
    Main WebSocket endpoint.

    Current state (Task 2): Echo stub — validates the message
    and returns a mock action so Frontend can connect and test.

    Task 7 will replace the echo block with the real AI pipeline:
        message → prompt engine → LLM → action parser → response
    """
    await ws.accept()

    try:
        while True:
            raw = await ws.receive_text()

            # ── Parse & validate against Contract 1 ──────────────────────────
            try:
                data = json.loads(raw)
                message = AgentMessage(**data)
            except (json.JSONDecodeError, ValidationError) as e:
                await send(ws, ActionResponse.error(f"Invalid message format: {e}"))
                continue

            # ── Validate API key on every message (Contract 4) ───────────────
            if not validate_api_key(message.api_key):
                await send(ws, ActionResponse.error("Invalid API key"))
                continue

            # ── TODO (Task 7): replace this block with real AI pipeline ───────
            # from app.agent.prompt import build_prompt
            # from app.agent.llm_client import call_llm
            # from app.agent.parser import parse_action
            #
            # prompt = build_prompt(message.dom_map, message.command)
            # raw_response = await call_llm(prompt)
            # action = parse_action(raw_response)
            # await send(ws, action)

            # Echo stub — confirms the pipeline is wired correctly
            echo_response = ActionResponse(
                status="success",
                action="click",
                element_id="echo-stub",
                value=None,
                message=f'Echo: received command "{message.command}" '
                        f"with {len(message.dom_map)} DOM nodes",
            )
            await send(ws, echo_response)

    except WebSocketDisconnect:
        # Client disconnected — nothing to do
        pass
    except Exception as e:
        # Unexpected error — try to notify client before closing
        try:
            await send(ws, ActionResponse.error(f"Server error: {e}"))
        except Exception:
            pass

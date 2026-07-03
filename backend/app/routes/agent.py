from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import json

# Database connections
from app.db.connection import get_db, validate_api_key
# Make sure this matches wherever your team defined the usage logger
from app.db.connection import _log_usage 

# AI Engine connections (Command Pipeline)
from app.agent.llm_client import call_llm, LLMError
from app.agent.prompt import build_prompt
from app.agent.parser import parse_action, ParseError

# AI Engine connections (Simplify Pipeline)
from app.agent.simplify_prompt import build_simplify_prompt
from app.agent.simplify_parser import parse_simplify_response

# Data Safety connections (Your Shield)
from app.agent.sanitize import strip_pii_from_dom, trim_log_payload

router = APIRouter()

@router.websocket("/v1/agent")
async def websocket_endpoint(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()
    
    try:
        while True:
            # 1. Wait for the Frontend Connection
            raw_data = await websocket.receive_text()
            
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_json({"status": "error", "message": "Invalid JSON payload."})
                continue
            
            # 2. Database Connection: Validate the API Key
            api_key = data.get("api_key")
            tenant_id = await validate_api_key(db, api_key)
            if not tenant_id:
                await websocket.close(code=4401, reason="Invalid API Key")
                break
                
            # 3. Sanitization Connection: Shield the data from PII
            raw_dom = data.get("dom_map", [])
            safe_dom = strip_pii_from_dom(raw_dom)
            req_type = data.get("type", "command")
            
            try:
                # 4. AI Connections: Route to the correct pipeline
                if req_type == "simplify":
                    # Headline Feature: Describe the whole page for the sidebar
                    prompt = build_simplify_prompt(safe_dom)
                    raw_llm = await call_llm(prompt)
                    final_response = parse_simplify_response(raw_llm, safe_dom)
                    
                else: 
                    # Secondary Feature: Execute a specific voice/text command
                    user_command = data.get("command", "")
                    prompt = build_prompt(safe_dom, user_command)
                    raw_llm = await call_llm(prompt)
                    final_response = parse_action(raw_llm)
                    
                    # 5. Log ONLY safe, minimal data to PostgreSQL for commands
                    safe_log_data = trim_log_payload(user_command, final_response)
                    await _log_usage(
                        db=db, 
                        session_id=data.get("session_id"), 
                        tenant_id=tenant_id, 
                        log_details=safe_log_data
                    )
            
            # Catch LLM connection timeouts or hallucination parsing errors gracefully
            except LLMError:
                final_response = {"status": "error", "message": "AI service unavailable. Please try again."}
            except ParseError:
                final_response = {"status": "error", "message": "Could not process that command. Please rephrase."}
            
            # 6. Send the final JSON payload back to the frontend extension
            await websocket.send_json(final_response)
            
    except WebSocketDisconnect:
        print("Client disconnected gracefully.")
    except Exception as e:
        print(f"Unhandled server error: {e}")
        # Prevent the FastAPI server from crashing during the live demo
        await websocket.send_json({"status": "error", "message": "Internal Server Error"})
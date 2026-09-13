"""
Chat Question Answering Endpoint
POST /v1/chat

Answers natural language questions about current webpage content using
the configured LLM provider (NVIDIA NIM or Ollama).
"""

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.connection import get_db
from app.db import connection as db_connection
from app.agent import llm_client, agentic_planner, summary_prompt, rate_limiter
from app.agent.agentic_planner import AgenticPlan
from app.agent.llm_client import LLMError

logger = logging.getLogger(__name__)
router = APIRouter()


class SummaryRequest(BaseModel):
    url: str = Field(..., max_length=2048)
    page_text: Optional[str] = Field(default="", max_length=50000)
    api_key: Optional[str] = Field(default=None, max_length=256)


class SummaryResponse(BaseModel):
    status: str
    summary: str


@router.post("/summary", response_model=SummaryResponse)
async def summary_endpoint(
    payload: SummaryRequest,
    x_atlas_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Page summary endpoint for accessibility.
    Returns a warm 2-sentence summary describing what the page is and what actions are available.
    """
    key = x_atlas_key or payload.api_key
    if not key:
        raise HTTPException(status_code=401, detail="Missing API key")

    tenant_id = await db_connection.validate_api_key(db, key)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not rate_limiter.check(tenant_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded — please slow down and try again shortly.",
        )

    prompt = summary_prompt.build_summary_prompt(
        page_text=payload.page_text or "",
        url=payload.url,
    )
    try:
        raw_llm = await llm_client.call_llm(prompt)
        return SummaryResponse(status="ok", summary=raw_llm.strip())
    except Exception as exc:
        logger.warning("Summary generation failed: %s", exc)
        return SummaryResponse(status="error", summary="Welcome to this webpage.")


class ChatRequest(BaseModel):
    url: str = Field(..., max_length=2048)
    question: str = Field(..., max_length=2000)
    page_text: Optional[str] = Field(default="", max_length=50000)
    api_key: Optional[str] = Field(default=None, max_length=256)
    dom_map: Optional[List[Dict[str, Any]]] = None
    history: Optional[List[Dict[str, str]]] = None


class ChatResponse(BaseModel):
    status: str
    answer: str
    plan: Optional[AgenticPlan] = None


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    payload: ChatRequest,
    x_atlas_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Intelligent Conversational Agent Endpoint.
    - If `dom_map` is provided, plans multi-step agentic web interactions.
    - If `dom_map` is not provided, answers conversational questions about the page.
    Authenticates via X-Atlas-Key header or payload.api_key.
    """
    key = x_atlas_key or payload.api_key
    if not key:
        raise HTTPException(status_code=401, detail="Missing API key")

    tenant_id = await db_connection.validate_api_key(db, key)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not rate_limiter.check(tenant_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded — please slow down and try again shortly.",
        )

    # If DOM map is provided, invoke the multi-step agentic planner
    if payload.dom_map and len(payload.dom_map) > 0:
        try:
            plan = await agentic_planner.plan_agentic_action(
                dom_map=payload.dom_map,
                user_message=payload.question,
                page_text=payload.page_text or "",
                url=payload.url,
                history=payload.history,
            )
            return ChatResponse(
                status="ok",
                answer=plan.reply,
                plan=plan,
            )
        except Exception as exc:
            logger.warning("Agentic planner error, falling back to simple chat: %s", exc)

    # Standard conversational QA
    page_summary = (payload.page_text or "").strip()[:2500]
    prompt = f"""You are Atlas, a friendly, concise, and helpful AI accessibility assistant for web users (including elderly or disabled individuals).
The user is currently browsing the webpage: {payload.url}

Summary of page content:
{page_summary if page_summary else "No text extracted from page."}

User question:
{payload.question}

Guidelines:
- Answer directly in 1 to 3 plain, simple sentences.
- Speak in a warm, patient, and easy-to-understand tone.
- If the user asks where something is or how to do something, guide them clearly based on the page content.
- Do NOT output code or technical jargon.

Answer:"""

    try:
        raw_llm = await llm_client.call_llm(prompt)
        answer = raw_llm.strip().replace('"', '').strip()
        if not answer:
            answer = "I'm not sure about that based on this page, but you can try searching or clicking an item from the Elements tab."
        return ChatResponse(status="ok", answer=answer)
    except LLMError as exc:
        logger.warning("LLM call failed for chat: %s", exc)
        return ChatResponse(
            status="error",
            answer="I am having trouble reaching the AI service right now. Please try again shortly.",
        )
    except Exception as exc:
        logger.error("Unexpected error in chat endpoint: %s", exc)
        return ChatResponse(
            status="error",
            answer="Sorry, I encountered an unexpected issue while processing your question.",
        )

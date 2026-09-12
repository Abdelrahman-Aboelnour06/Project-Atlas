"""
Agentic Multi-Step Planner
backend/app/agent/agentic_planner.py

Transforms high-level natural language user requests (speech or text) into
intelligent conversational responses and multi-step DOM action plans.
Supports:
- Multi-step goals (e.g. "buy me some paracetamol" -> add to cart -> checkout -> ask confirmation)
- Conversational confirmations ("yes", "proceed", "cancel", "no")
- Question answering with page context
- Safe verification against DOM elements
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.agent import llm_client
from app.agent.sanitize import strip_pii_from_dom

logger = logging.getLogger(__name__)

VALID_ACTIONS = {"click", "open", "double_click", "fill", "scroll", "focus"}


class PlanStep(BaseModel):
    action: str
    element_id: str
    value: Optional[str] = None
    description: Optional[str] = ""
    delay_ms: Optional[int] = 600


class AgenticPlan(BaseModel):
    type: str = Field(default="plan", description="'plan', 'conversation', or 'confirmation'")
    thought: Optional[str] = ""
    reply: str
    steps: List[PlanStep] = Field(default_factory=list)
    requires_confirmation: bool = False
    confirmation_prompt: Optional[str] = None
    confirmation_options: List[str] = Field(default_factory=lambda: ["Yes, proceed", "No, cancel"])
    pending_step: Optional[PlanStep] = None
    confirmation_success_message: Optional[str] = "Done! Action completed."


def _clean_json_str(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    match = re.search(r"\{[\s\S]*\}", text)
    return match.group(0) if match else text.strip()


def _get_valid_element_ids(dom_map: List[Dict[str, Any]]) -> set:
    ids = set()
    for node in dom_map:
        nid = node.get("id")
        if nid:
            ids.add(str(nid))
    return ids


SYSTEM_PROMPT = """You are Atlas, an intelligent, empathetic AI accessibility web agent.
You help elderly, disabled, and everyday users navigate and perform tasks on ANY website naturally using speech or text.

You receive:
1. Current page URL and extracted visible page text.
2. The DOM MAP of interactive elements (buttons, inputs, links, dropdowns, files, tabs) on the page.
3. Recent conversation history.
4. The user's latest message or command.

YOUR CAPABILITIES ON ANY WEBSITE:
1. General Web Navigation & Interaction:
   - Click links, buttons, tabs, navigation items, menu toggles, search buttons. Use action: "click".
   - Open files, documents, folders, rows, or cards. Use action: "open" (this dispatches double-click and Enter key to open files/folders across desktop-like web apps like Google Drive, Dropbox, email, etc.).
   - Fill in text inputs, search boxes, login/registration forms, filters, comments, or contact forms. Use action: "fill".
   - Scroll or focus on relevant sections of the page. Use action: "scroll" or "focus".

2. Multi-Step Goal Execution:
   - When the user asks to navigate to a tab or section (e.g. "go to the starred tab", "open recent", "navigate to shared with me", "click home"):
     Find the matching element in CURRENT INTERACTIVE DOM ELEMENTS and output a "click" step with its exact element_id!
   - When the user asks to open a file or folder (e.g. "open the MEM folder", "open Lab exam.pdf", "double click Credit Fall 2026"):
     Find the matching element and output an "open" step with its exact element_id!
   - Understand complex requests (e.g. "search for quantum computing", "add to cart", "filter by rating"). Formulate logical steps.

3. Safety & Human-in-the-Loop Confirmation:
   - For actions that have real-world consequences (placing an order, spending money, deleting data, booking tickets, submitting a binding form):
     - Formulate preliminary steps, but STOP before final execution.
     - Set `requires_confirmation: true`.
     - Set `confirmation_prompt`: A clear, natural question explaining what is about to be done.
     - Set `confirmation_options`: ["Yes, proceed", "No, cancel"].
     - Set `pending_step`: The final action step to execute if the user confirms.
     - Set `confirmation_success_message`: A confirmation message.

4. Conversational Question Answering:
   - For questions about the page (e.g. "What is this website?", "Who is the author?", "Summarize the article"):
     - Answer directly in 1 to 3 plain, friendly, helpful sentences based on the page content.
     - Return `type: "conversation"`, a clear `reply`, and empty `steps: []`.

5. Conversational Confirmations:
   - If the user was previously asked for confirmation and says "yes", "sure", "proceed", "confirm", "go ahead":
     - Formulate the step to complete the action and set `requires_confirmation: false`.
   - If the user says "no", "cancel", "stop", "never mind":
     - Return `type: "conversation"` confirming the action was cancelled with no changes made.

CRITICAL SECURITY RULE:
Only use element IDs that actually exist in the provided DOM MAP. Never invent or hallucinate element IDs.

OUTPUT FORMAT:
Return ONLY valid raw JSON with this exact schema:
{
  "type": "plan" | "conversation",
  "thought": "brief reasoning about the user intent and steps",
  "reply": "warm, friendly, plain English message spoken or shown to the user",
  "steps": [
    {
      "action": "click" | "open" | "fill" | "scroll" | "focus",
      "element_id": "exact-id-from-dom-map",
      "value": "text to type if action is fill, or null",
      "description": "brief description of this step",
      "delay_ms": 600
    }
  ],
  "requires_confirmation": true | false,
  "confirmation_prompt": "question to ask user if confirmation needed, or null",
  "confirmation_options": ["Yes, proceed", "No, cancel"],
  "pending_step": {
    "action": "click" | "open",
    "element_id": "exact-id-from-dom-map",
    "description": "brief description"
  } | null,
  "confirmation_success_message": "message after confirmed execution"
}
"""


async def plan_agentic_action(
    dom_map: List[Dict[str, Any]],
    user_message: str,
    page_text: str = "",
    url: str = "",
    history: Optional[List[Dict[str, str]]] = None,
) -> AgenticPlan:
    """
    Calls the LLM to generate an intelligent agentic plan.
    """
    safe_dom = strip_pii_from_dom(dom_map)
    valid_ids = _get_valid_element_ids(safe_dom)

    concise_dom = []
    for node in safe_dom:
        label = (
            node.get("resolved_label")
            or node.get("aria_label")
            or node.get("inner_text")
            or node.get("placeholder")
            or node.get("name")
            or node.get("label")
            or ""
        )
        if isinstance(label, str):
            label = label.strip()
        category = node.get("category") or node.get("group_label") or node.get("role") or node.get("tag")
        concise_dom.append({
            "id": node.get("id"),
            "tag": node.get("tag"),
            "label": label,
            "category": category,
            "role": node.get("role"),
            "href": node.get("href"),
        })

    history_str = ""
    if history:
        recent = history[-6:]
        history_str = "\n".join(f"{h.get('role', 'user').capitalize()}: {h.get('content', '')}" for h in recent)

    dom_json = json.dumps(concise_dom, indent=2)

    prompt = f"""{SYSTEM_PROMPT}

PAGE URL: {url}
PAGE SUMMARY:
{page_text[:1200] if page_text else "No page summary"}

CONVERSATION HISTORY:
{history_str if history_str else "None (first message)"}

CURRENT INTERACTIVE DOM ELEMENTS:
{dom_json}

USER MESSAGE:
"{user_message}"

JSON RESPONSE:"""

    try:
        raw_llm = await llm_client.call_llm(prompt)
        cleaned = _clean_json_str(raw_llm)
        data = json.loads(cleaned)

        raw_steps = data.get("steps", [])
        validated_steps: List[PlanStep] = []
        for s in raw_steps:
            action = str(s.get("action", "")).lower().strip()
            eid = str(s.get("element_id", "")).strip()
            if action in VALID_ACTIONS and eid in valid_ids:
                validated_steps.append(PlanStep(
                    action=action,
                    element_id=eid,
                    value=s.get("value"),
                    description=s.get("description", f"{action} on {eid}"),
                    delay_ms=s.get("delay_ms", 600)
                ))

        reply = data.get("reply") or "I've processed your request."
        plan_type = data.get("type", "plan" if validated_steps else "conversation")

        raw_pending = data.get("pending_step")
        pending_step_obj = None
        if isinstance(raw_pending, dict) and str(raw_pending.get("element_id")) in valid_ids:
            pending_step_obj = PlanStep(
                action=raw_pending.get("action", "click"),
                element_id=str(raw_pending["element_id"]),
                value=raw_pending.get("value"),
                description=raw_pending.get("description", "Confirm action"),
            )

        return AgenticPlan(
            type=plan_type,
            thought=data.get("thought", ""),
            reply=reply,
            steps=validated_steps,
            requires_confirmation=bool(data.get("requires_confirmation", False)),
            confirmation_prompt=data.get("confirmation_prompt"),
            confirmation_options=data.get("confirmation_options", ["Yes, proceed", "No, cancel"]),
            pending_step=pending_step_obj,
            confirmation_success_message=data.get("confirmation_success_message", "Done! Action completed."),
        )

    except Exception as exc:
        logger.warning("Agentic planner failed or returned invalid JSON: %s", exc)
        lower_msg = user_message.strip().lower()
        if lower_msg in {"yes", "sure", "proceed", "place order", "go ahead", "confirm", "ok", "submit"}:
            confirm_nodes = [n for n in concise_dom if any(k in (n.get("label") or "").lower() for k in ("confirm", "submit", "proceed", "place", "order", "finish", "checkout", "send", "save"))]
            if confirm_nodes:
                return AgenticPlan(
                    type="plan",
                    reply="Great! Confirming and completing that for you now.",
                    steps=[PlanStep(action="click", element_id=confirm_nodes[0]["id"], description="Confirm action")],
                    requires_confirmation=False,
                    confirmation_success_message="Done! Action completed."
                )
            return AgenticPlan(
                type="conversation",
                reply="Understood! Confirmed.",
                steps=[]
            )
        elif lower_msg in {"no", "cancel", "stop", "never mind", "abort"}:
            return AgenticPlan(
                type="conversation",
                reply="No problem, I've cancelled that for you.",
                steps=[]
            )

        return AgenticPlan(
            type="conversation",
            reply="I'm here to help you navigate this webpage. You can ask me questions about the page, or tell me what to click, search, or fill in.",
            steps=[]
        )

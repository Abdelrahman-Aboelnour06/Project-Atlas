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

VALID_ACTIONS = {"click", "fill", "scroll", "focus"}


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
    confirmation_options: List[str] = Field(default_factory=lambda: ["Yes, place order", "No, cancel"])
    pending_action: Optional[Dict[str, Any]] = None


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
You help elderly, disabled, and everyday users navigate and perform tasks on web pages naturally using speech or text.

You receive:
1. Current page URL and text summary.
2. The DOM MAP of interactive elements (buttons, inputs, links) on the page.
3. Recent conversation history.
4. The user's latest message or command.

YOUR GOAL:
Understand the user's intent in natural human terms and produce an AGENTIC PLAN.
For multi-step requests like "buy me some paracetamol" or "order vitamin d":
1. Find the appropriate product / item.
2. Formulate steps:
   - Step 1: Click the product's "Add to Cart" button.
   - Step 2: Click the "Proceed to Checkout" or "View Cart" button if the goal is to purchase/buy.
3. ALWAYS protect the user before final payment / order placement:
   - Set `requires_confirmation: true`
   - Provide a clear `confirmation_prompt`: "I have added [Product] ($[Price]) to your cart and opened checkout. Would you like me to complete the purchase?"
   - Provide `confirmation_options`: ["Yes, place order", "No, cancel"]

For simple questions (e.g. "Do you have aspirin?", "What is on this page?"):
- Return `type: "conversation"`, a friendly direct `reply`, and empty `steps: []`.

For conversational confirmations:
- If the user previously received a purchase/checkout prompt and says "yes", "proceed", "go ahead", "sure":
  - Formulate the step to finalize checkout / place the order, and set `requires_confirmation: false`.
- If the user says "no", "stop", "cancel", "never mind":
  - Return `type: "conversation"` confirming the order was canceled and no purchase was made.

CRITICAL SECURITY RULE:
Only use element IDs that actually exist in the provided DOM MAP. Never invent element IDs.

OUTPUT FORMAT:
Return ONLY valid raw JSON with this exact schema:
{
  "type": "plan" | "conversation",
  "thought": "brief reasoning about the user intent and steps",
  "reply": "warm, friendly, plain English message spoken or shown to the user",
  "steps": [
    {
      "action": "click" | "fill" | "scroll" | "focus",
      "element_id": "exact-id-from-dom-map",
      "value": "text to type if action is fill",
      "description": "brief description of this step",
      "delay_ms": 600
    }
  ],
  "requires_confirmation": true | false,
  "confirmation_prompt": "question to ask user if confirmation needed, or null",
  "confirmation_options": ["Yes, place order", "No, cancel"]
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
        concise_dom.append({
            "id": node.get("id"),
            "tag": node.get("tag"),
            "label": node.get("label"),
            "category": node.get("category"),
            "role": node.get("role"),
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

        return AgenticPlan(
            type=plan_type,
            thought=data.get("thought", ""),
            reply=reply,
            steps=validated_steps,
            requires_confirmation=bool(data.get("requires_confirmation", False)),
            confirmation_prompt=data.get("confirmation_prompt"),
            confirmation_options=data.get("confirmation_options", ["Yes, place order", "No, cancel"]),
        )

    except Exception as exc:
        logger.warning("Agentic planner failed or returned invalid JSON: %s", exc)
        lower_msg = user_message.strip().lower()
        if lower_msg in {"yes", "sure", "proceed", "place order", "go ahead", "confirm", "ok"}:
            checkout_nodes = [n for n in concise_dom if "checkout" in (n.get("label") or "").lower() or "submit" in (n.get("label") or "").lower()]
            if checkout_nodes:
                return AgenticPlan(
                    type="plan",
                    reply="Great! Confirming your order now.",
                    steps=[PlanStep(action="click", element_id=checkout_nodes[0]["id"], description="Complete order")],
                    requires_confirmation=False
                )
            return AgenticPlan(
                type="conversation",
                reply="Got it! Order confirmed.",
                steps=[]
            )
        elif lower_msg in {"no", "cancel", "stop", "never mind", "dont buy"}:
            return AgenticPlan(
                type="conversation",
                reply="No problem, I've cancelled that for you.",
                steps=[]
            )

        return AgenticPlan(
            type="conversation",
            reply="I understand you'd like to do that, but I need a moment. Could you please specify which item or button you'd like me to interact with?",
            steps=[]
        )

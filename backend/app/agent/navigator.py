"""
Same-Page Navigator Agent
backend/app/agent/navigator.py

Resolves active goal milestones into concrete, DOM-validated interactive PlanSteps
on the current webpage. Strictly adheres to:
1. Zero element ID hallucination (validating all IDs against current DOM).
2. Universal heuristic fallback matching (universal across all websites).
3. Deterministic consequential action gating for irreversible operations.
4. Prime Directive compliance: 100% universal across all websites, zero domain hardcoding.
"""

import json
import logging
import re
import secrets
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from app.agent import llm_client
from app.agent.agentic_planner import find_heuristic_match
from app.agent.sanitize import strip_pii_from_dom
from app.models.action import ActionType
from app.models.dom import DomNode
from app.models.goal import AgenticPlan, Milestone, PlanStep

logger = logging.getLogger(__name__)

VALID_ACTIONS: Set[str] = {"click", "open", "double_click", "fill", "scroll", "focus"}

CONSEQUENTIAL_KEYWORDS: Set[str] = {
    "buy",
    "purchase",
    "order",
    "checkout",
    "pay",
    "payment",
    "delete",
    "remove",
    "submit",
    "transfer",
    "subscribe",
    "book",
    "place order",
    "confirm order",
    "send payment",
}


def _clean_json_str(raw: str) -> str:
    """Extracts clean JSON object string from raw LLM output."""
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    match = re.search(r"\{[\s\S]*\}", text)
    return match.group(0) if match else text.strip()


def _is_consequential_text(text: Optional[str]) -> bool:
    """Universal detection of consequential/irreversible operations without domain checks."""
    if not text:
        return False
    lower = text.lower()
    return any(re.search(rf"\b{re.escape(kw)}\b", lower) for kw in CONSEQUENTIAL_KEYWORDS)


def _convert_dom_nodes_to_dicts(dom_map: List[Union[DomNode, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Normalizes a list of DomNode instances or dicts into uniform dict representations."""
    raw_nodes: List[Dict[str, Any]] = []
    for node in dom_map:
        if hasattr(node, "model_dump"):
            raw_nodes.append(node.model_dump())
        elif hasattr(node, "dict"):
            raw_nodes.append(node.dict())
        elif isinstance(node, dict):
            raw_nodes.append(dict(node))
        else:
            raw_nodes.append(vars(node))
    return raw_nodes


NAVIGATOR_SYSTEM_PROMPT = """You are Atlas Navigator, an intelligent, empathetic AI accessibility web agent.
You help users navigate and interact with interactive elements on ANY webpage.
Your job is to resolve the user's active goal or milestone into concrete, DOM-validated interaction steps.

CAPABILITIES ON ANY WEBSITE:
1. Click buttons, links, tabs, radio buttons, checkboxes, or controls. Action: "click".
2. Open files, documents, folders, rows, or cards. Action: "open" (dispatches double-click and Enter).
3. Fill inputs, search boxes, forms, or text areas. Action: "fill".
4. Scroll or focus to make elements visible. Action: "scroll" or "focus".

SAFETY RULES:
1. ONLY reference element IDs that exist in CURRENT INTERACTIVE DOM ELEMENTS. NEVER invent or hallucinate element IDs.
2. For consequential actions (buying, paying, ordering, deleting, removing, submitting payment):
   - Set `requires_confirmation: true`.
   - Provide a clear `confirmation_prompt`.
   - Place the sensitive final action in `pending_step`.
   - Do NOT place the sensitive final action in `steps`.

OUTPUT FORMAT:
Return ONLY valid raw JSON with this exact schema:
{
  "type": "plan" | "conversation" | "confirmation",
  "thought": "brief reasoning",
  "reply": "friendly status message spoken or displayed to the user",
  "steps": [
    {
      "action": "click" | "open" | "fill" | "scroll" | "focus",
      "element_id": "exact-id-from-dom-map",
      "value": "string or null",
      "description": "brief description of action",
      "delay_ms": 600
    }
  ],
  "requires_confirmation": false,
  "confirmation_prompt": null,
  "confirmation_options": ["Yes, proceed", "No, cancel"],
  "pending_step": null,
  "confirmation_success_message": "Done! Action completed."
}
"""


async def plan_milestone_step(
    goal: str,
    milestone: Milestone,
    dom_map: List[Union[DomNode, Dict[str, Any]]],
    current_url: str,
    page_text: Optional[str] = None,
    user_response: Optional[str] = None,
    history: Optional[List[Dict[str, Any]]] = None,
) -> AgenticPlan:
    """
    Resolves the active milestone into concrete, DOM-validated PlanSteps on the current page.

    Args:
        goal: The overall user goal statement.
        milestone: The current active milestone checkpoint.
        dom_map: Interactive DOM elements serialized from the page.
        current_url: Current webpage URL.
        page_text: Optional extracted visible text on the page.
        user_response: Optional user response to confirmation prompt ('yes', 'cancel', etc.).
        history: Optional multi-turn conversation history.

    Returns:
        AgenticPlan: Fully validated agentic plan with zero hallucinated element IDs
            and human-in-the-loop gating for consequential actions.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_map)
    safe_dom = strip_pii_from_dom(raw_nodes)

    valid_ids: Set[str] = {str(n["id"]) for n in safe_dom if n.get("id")}
    id_to_node: Dict[str, Dict[str, Any]] = {str(n["id"]): n for n in safe_dom if n.get("id")}

    # Build concise DOM representation for prompt and heuristic matching
    concise_dom: List[Dict[str, Any]] = []
    for node in safe_dom:
        label = (
            node.get("resolved_label")
            or node.get("aria_label")
            or node.get("inner_text")
            or node.get("placeholder")
            or node.get("name")
            or ""
        )
        if isinstance(label, str):
            label = label.strip()
        category = node.get("group_label") or node.get("role") or node.get("tag")
        concise_dom.append({
            "id": node.get("id"),
            "tag": node.get("tag"),
            "label": label,
            "category": category,
            "role": node.get("role"),
            "href": node.get("href"),
            "sensitive": bool(node.get("sensitive")),
        })

    # Handle explicit user responses (e.g. confirmation prompts)
    if user_response:
        clean_resp = user_response.strip().lower()
        if any(neg in clean_resp for neg in ("no", "cancel", "stop", "never mind", "abort")):
            return AgenticPlan(
                type="conversation",
                thought="User cancelled the pending action.",
                reply="No problem, I've cancelled that action for you.",
                steps=[],
                requires_confirmation=False,
            )

    history_str = ""
    if history:
        recent = history[-6:]
        history_str = "\n".join(f"{h.get('role', 'user').capitalize()}: {h.get('content', '')}" for h in recent)

    summary_nonce = secrets.token_hex(6)
    dom_nonce = secrets.token_hex(6)
    dom_json = json.dumps(concise_dom, indent=2)

    user_body = f"""PAGE URL: {current_url}

--- BEGIN UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---
{(page_text or "").strip()[:1500] if page_text else "No page summary"}
--- END UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---

CONVERSATION HISTORY:
{history_str if history_str else "None (first turn)"}

--- BEGIN UNTRUSTED INTERACTIVE DOM ELEMENTS (BOUNDARY_ID: {dom_nonce}) ---
{dom_json}
--- END UNTRUSTED INTERACTIVE DOM ELEMENTS (BOUNDARY_ID: {dom_nonce}) ---

USER GOAL:
"{goal}"

ACTIVE MILESTONE:
"{milestone.description}" (status: {milestone.status})

JSON RESPONSE:"""

    raw_steps: List[Dict[str, Any]] = []
    reply = "Navigating to fulfill your goal."
    thought = ""
    raw_pending: Optional[Dict[str, Any]] = None
    llm_requires_confirmation = False
    llm_confirmation_prompt: Optional[str] = None

    try:
        raw_llm = await llm_client.call_llm(
            user_prompt=user_body,
            system_prompt=NAVIGATOR_SYSTEM_PROMPT,
            role="navigator",
        )
        cleaned = _clean_json_str(raw_llm)
        parsed = json.loads(cleaned)
        raw_steps = parsed.get("steps", [])
        reply = parsed.get("reply") or reply
        thought = parsed.get("thought", "")
        raw_pending = parsed.get("pending_step")
        llm_requires_confirmation = bool(parsed.get("requires_confirmation", False))
        llm_confirmation_prompt = parsed.get("confirmation_prompt")
    except Exception as exc:
        logger.warning("Navigator LLM call or JSON parsing failed: %s. Using universal fallback.", exc)

    # Strictly enforce zero hallucination on steps
    validated_steps: List[PlanStep] = []
    for s in raw_steps:
        action = str(s.get("action", "click")).lower().strip()
        if action not in VALID_ACTIONS:
            action = "click"
        raw_id = s.get("element_id")
        eid = str(raw_id).strip() if raw_id is not None else None

        if eid and eid in valid_ids:
            validated_steps.append(PlanStep(
                action=action,
                element_id=eid,
                value=s.get("value"),
                description=s.get("description", f"{action} on {eid}"),
                delay_ms=s.get("delay_ms", 600),
            ))
        elif eid:
            # Hallucinated ID: Attempt recovery via universal semantic heuristic matching
            desc = s.get("description") or milestone.description or goal
            matched_node, score = find_heuristic_match(desc, concise_dom)
            if matched_node and str(matched_node.get("id")) in valid_ids and score >= 0.5:
                recovered_id = str(matched_node["id"])
                logger.info(
                    "Recovered hallucinated element_id '%s' -> '%s' (score=%.2f)",
                    eid, recovered_id, score
                )
                validated_steps.append(PlanStep(
                    action=action,
                    element_id=recovered_id,
                    value=s.get("value"),
                    description=s.get("description", f"{action} on {recovered_id}"),
                    delay_ms=s.get("delay_ms", 600),
                ))
            else:
                logger.warning("Discarded unresolvable hallucinated element_id: %s", eid)

    # Validate pending step from LLM if present
    validated_pending: Optional[PlanStep] = None
    if isinstance(raw_pending, dict):
        p_eid = str(raw_pending.get("element_id", "")).strip()
        p_act = str(raw_pending.get("action", "click")).lower().strip()
        if p_act not in VALID_ACTIONS:
            p_act = "click"
        if p_eid in valid_ids:
            validated_pending = PlanStep(
                action=p_act,
                element_id=p_eid,
                value=raw_pending.get("value"),
                description=raw_pending.get("description", "Confirm action"),
            )
        elif p_eid:
            matched_p, p_score = find_heuristic_match(raw_pending.get("description") or goal, concise_dom)
            if matched_p and str(matched_p.get("id")) in valid_ids and p_score >= 0.5:
                validated_pending = PlanStep(
                    action=p_act,
                    element_id=str(matched_p["id"]),
                    value=raw_pending.get("value"),
                    description=raw_pending.get("description", "Confirm action"),
                )

    # Fallback to universal heuristic intent matching if zero valid steps were obtained
    if not validated_steps and not validated_pending:
        target_query = milestone.description or goal
        matched_node, score = find_heuristic_match(target_query, concise_dom)
        if matched_node and str(matched_node.get("id")) in valid_ids:
            mid = str(matched_node["id"])
            lbl = matched_node.get("label") or mid
            act = "open" if matched_node.get("category") in {"folder", "file"} or matched_node.get("role") in {"row", "gridcell"} else "click"
            validated_steps.append(PlanStep(
                action=act,
                element_id=mid,
                description=f"{act.capitalize()} '{lbl}'",
                delay_ms=600,
            ))
            reply = f"I found '{lbl}' on the page. Clicking it for you now."
            thought = f"Universal heuristic matched '{target_query}' to element '{lbl}' (id={mid}, score={score:.2f})"

    # Deterministic Consequential Action Gate
    # Inspect goal, milestone, steps, and target nodes for sensitive or irreversible operations
    user_already_confirmed = False
    if user_response:
        user_already_confirmed = any(
            pos in user_response.strip().lower()
            for pos in ("yes", "sure", "proceed", "confirm", "go ahead", "ok")
        )

    requires_confirmation = False
    confirmation_prompt: Optional[str] = None
    final_pending: Optional[PlanStep] = validated_pending

    if not user_already_confirmed:
        goal_consequential = _is_consequential_text(goal) or _is_consequential_text(milestone.description)

        # Check existing steps for sensitive target nodes or action descriptions
        sensitive_step_idx: Optional[int] = None
        for idx, step in enumerate(validated_steps):
            step_node = id_to_node.get(step.element_id or "")
            node_sensitive = bool(step_node and step_node.get("sensitive"))
            node_label = step_node.get("resolved_label") or step_node.get("aria_label") or step_node.get("inner_text") or ""
            step_consequential = (
                node_sensitive
                or _is_consequential_text(step.description)
                or _is_consequential_text(node_label)
                or (goal_consequential and idx == len(validated_steps) - 1)
            )
            if step_consequential:
                sensitive_step_idx = idx
                break

        if sensitive_step_idx is not None:
            requires_confirmation = True
            final_pending = validated_steps.pop(sensitive_step_idx)
            confirmation_prompt = (
                llm_confirmation_prompt
                or f"This action will {final_pending.description or 'perform a sensitive operation'}. Would you like to proceed?"
            )
        elif llm_requires_confirmation and final_pending is not None:
            requires_confirmation = True
            confirmation_prompt = llm_confirmation_prompt or "Would you like to proceed with this action?"
        elif goal_consequential and final_pending is not None:
            requires_confirmation = True
            confirmation_prompt = (
                llm_confirmation_prompt
                or f"Would you like to confirm: {final_pending.description or goal}?"
            )

    plan_type = "confirmation" if requires_confirmation else ("plan" if validated_steps else "conversation")

    return AgenticPlan(
        type=plan_type,
        thought=thought,
        reply=reply,
        steps=validated_steps,
        requires_confirmation=requires_confirmation,
        confirmation_prompt=confirmation_prompt,
        confirmation_options=["Yes, proceed", "No, cancel"],
        pending_step=final_pending,
        confirmation_success_message="Done! Action completed.",
    )

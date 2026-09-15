"""
Verifier Agent Pipeline
backend/app/agent/verifier.py

Evaluates post-action webpage state outcomes against observable signals
(client execution feedback, error banners, success toasts, URL transitions,
element disappearance) using deterministic rules-first verification before
falling back to LLM evaluation.
Adheres strictly to Prime Directive: 100% universal across all websites,
zero domain or vendor-specific hardcoding.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Set, Union

from app.agent import llm_client
from app.models.dom import DomNode
from app.models.goal import Milestone, PlanStep, VerifierResult, VerifierStatus

logger = logging.getLogger(__name__)

# Universal error patterns across any website
ERROR_PHRASES: List[str] = [
    "card declined",
    "payment declined",
    "payment failed",
    "transaction failed",
    "out of stock",
    "item unavailable",
    "invalid credentials",
    "access denied",
    "unauthorized",
    "404 not found",
    "page not found",
    "failed to load",
    "an error occurred",
    "something went wrong",
    "unable to process",
    "form submission failed",
]

# Universal success patterns across any website
SUCCESS_PHRASES: List[str] = [
    "order placed",
    "order confirmed",
    "order complete",
    "purchase successful",
    "purchase complete",
    "added to cart",
    "item added to your cart",
    "item added to cart",
    "thank you for your order",
    "thank you for your purchase",
    "thank you!",
    "payment successful",
    "successfully placed",
    "successfully confirmed",
    "successfully submitted",
    "successfully completed",
    "changes saved",
    "booking confirmed",
    "reservation confirmed",
]


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


def _extract_id_set(
    nodes_or_ids: Optional[Union[List[str], Set[str], List[Union[DomNode, Dict[str, Any]]]]]
) -> Set[str]:
    """Extracts a set of string element IDs from diverse input formats."""
    if not nodes_or_ids:
        return set()
    if isinstance(nodes_or_ids, set):
        return {str(x) for x in nodes_or_ids if x}
    ids: Set[str] = set()
    for item in nodes_or_ids:
        if isinstance(item, str):
            ids.add(item)
        elif hasattr(item, "id") and item.id:
            ids.add(str(item.id))
        elif isinstance(item, dict) and item.get("id"):
            ids.add(str(item["id"]))
    return ids


def _extract_node_dicts(
    dom_map: Optional[List[Union[DomNode, Dict[str, Any]]]]
) -> List[Dict[str, Any]]:
    """Converts a DOM map into standard dictionary representations."""
    if not dom_map:
        return []
    result: List[Dict[str, Any]] = []
    for node in dom_map:
        if hasattr(node, "model_dump"):
            result.append(node.model_dump())
        elif hasattr(node, "dict"):
            result.append(node.dict())
        elif isinstance(node, dict):
            result.append(dict(node))
        else:
            result.append(vars(node))
    return result


VERIFIER_SYSTEM_PROMPT = """You are Atlas Verifier, an objective verification agent for web automation.
Evaluate whether the previous browser action accomplished its intended outcome based strictly on observable signals.

POSSIBLE OUTCOMES:
- "goal_complete": The user's overall goal or milestone has been fully satisfied.
- "milestone_complete": The active milestone checkpoint succeeded.
- "in_progress": The action succeeded partially or page is transitioning, further steps needed.
- "goal_failed": The action caused an error, failed, or hit a blocker.

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema:
{
  "status": "goal_complete" | "milestone_complete" | "in_progress" | "goal_failed",
  "reason": "clear explanation of observed outcome",
  "confidence": 0.0 - 1.0,
  "signals_detected": ["observable_signal_1", "observable_signal_2"],
  "verification_method": "llm"
}
"""


async def verify_step_outcome(
    goal: str,
    milestone: Milestone,
    last_action: Optional[PlanStep] = None,
    last_action_result: Optional[Dict[str, Any]] = None,
    prior_url: Optional[str] = None,
    current_url: Optional[str] = None,
    prior_dom_ids: Optional[Union[List[str], Set[str], List[Any]]] = None,
    current_dom_map: Optional[List[Union[DomNode, Dict[str, Any]]]] = None,
    page_text: Optional[str] = None,
    prior_dom_map: Optional[List[Union[DomNode, Dict[str, Any]]]] = None,
) -> VerifierResult:
    """
    Evaluates post-action outcome against observable signals prioritizing deterministic rules.

    Args:
        goal: The overarching user goal.
        milestone: The active milestone being executed.
        last_action: The PlanStep that was just executed.
        last_action_result: Execution report from the browser client.
        prior_url: Webpage URL prior to executing the action.
        current_url: Webpage URL after executing the action.
        prior_dom_ids: Element IDs present prior to action execution.
        current_dom_map: Current DOM interactive nodes.
        page_text: Visible text extracted from current page.
        prior_dom_map: Optional complete DOM nodes prior to action.

    Returns:
        VerifierResult: Structured verification outcome.
    """
    # Normalize prior and current DOM state
    prior_ids: Set[str] = _extract_id_set(prior_dom_ids)
    if not prior_ids and prior_dom_map:
        prior_ids = _extract_id_set(prior_dom_map)

    curr_nodes = _extract_node_dicts(current_dom_map)
    curr_ids: Set[str] = {str(n["id"]) for n in curr_nodes if n.get("id")}

    # Initial turn check: If no action was performed yet, state is in_progress
    if last_action is None and last_action_result is None:
        return VerifierResult(
            status="in_progress",
            reason="Initial turn; execution pipeline initialized.",
            confidence=1.0,
            signals_detected=["initial_pipeline_state"],
            verification_method="initial",
        )

    # ── Rule 1: Client Execution Status ──────────────────────────────────────────
    if last_action_result:
        status_val = str(last_action_result.get("status", "")).lower().strip()
        has_error_flag = (
            status_val in ("error", "failed", "timeout", "rejected")
            or last_action_result.get("success") is False
            or bool(last_action_result.get("error"))
        )
        if has_error_flag:
            err_detail = (
                last_action_result.get("error")
                or last_action_result.get("message")
                or f"Client action execution reported failure status: {status_val}"
            )
            return VerifierResult(
                status="goal_failed",
                reason=str(err_detail),
                confidence=1.0,
                signals_detected=["client_execution_error", f"status:{status_val}"],
                verification_method="rules",
            )

    # Extract text from newly appeared DOM nodes
    new_nodes = [n for n in curr_nodes if n.get("id") and str(n["id"]) not in prior_ids]
    new_nodes_text = " ".join(
        str(
            n.get("resolved_label")
            or n.get("aria_label")
            or n.get("inner_text")
            or n.get("label")
            or ""
        )
        for n in new_nodes
    ).lower()

    lower_page_text = (page_text or "").lower()
    combined_new_text = f"{new_nodes_text} {lower_page_text}"

    # ── Rule 2: Error Banner / Toast / Keyword Detection ─────────────────────────
    for err_phrase in ERROR_PHRASES:
        if err_phrase in combined_new_text:
            return VerifierResult(
                status="goal_failed",
                reason=f"Observed error indicator on page: '{err_phrase}'.",
                confidence=0.95,
                signals_detected=[f"error_banner:{err_phrase}"],
                verification_method="rules",
            )

    # Check alert/status roles for explicit error content
    for node in new_nodes:
        role = str(node.get("role", "")).lower()
        if role in ("alert", "status"):
            node_txt = (node.get("inner_text") or node.get("resolved_label") or "").lower()
            if "error" in node_txt or "invalid" in node_txt or "failed" in node_txt:
                return VerifierResult(
                    status="goal_failed",
                    reason=f"Observed error alert on page: '{node_txt[:80]}'.",
                    confidence=0.95,
                    signals_detected=["error_alert_role", f"text:{node_txt[:50]}"],
                    verification_method="rules",
                )

    # ── Rule 3: Success Indicator Detection ──────────────────────────────────────
    for succ_phrase in SUCCESS_PHRASES:
        if succ_phrase in combined_new_text:
            return VerifierResult(
                status="goal_complete",
                reason=f"Observed success indicator on page: '{succ_phrase}'.",
                confidence=0.98,
                signals_detected=[f"success_indicator:{succ_phrase}"],
                verification_method="rules",
            )

    # ── Rule 4: URL Transitions ──────────────────────────────────────────────────
    if prior_url and current_url and prior_url != current_url:
        # Check if milestone target URL was reached
        if milestone.target_url:
            norm_target = milestone.target_url.lower().rstrip("/")
            norm_curr = current_url.lower().rstrip("/")
            if norm_target in norm_curr or norm_curr in norm_target:
                return VerifierResult(
                    status="goal_complete",
                    reason=f"URL transitioned to target: {current_url}.",
                    confidence=1.0,
                    signals_detected=[f"url_transition:{prior_url}->{current_url}", "target_url_matched"],
                    verification_method="rules",
                )

        # In Phase 1 implicit milestone, if user intended navigation and URL changed
        goal_lower = goal.lower()
        if any(nav_kw in goal_lower for nav_kw in ("go to", "navigate to", "open", "visit", "checkout", "cart")):
            return VerifierResult(
                status="goal_complete",
                reason=f"Navigation action transitioned to {current_url}.",
                confidence=0.92,
                signals_detected=[f"url_transition:{prior_url}->{current_url}"],
                verification_method="rules",
            )
        else:
            # URL changed following action; record progress / milestone complete
            return VerifierResult(
                status="goal_complete",
                reason=f"Action caused URL transition to {current_url}.",
                confidence=0.88,
                signals_detected=[f"url_transition:{prior_url}->{current_url}"],
                verification_method="rules",
            )

    # ── Rule 5: Element Disappearance (e.g. dismissed modal, deleted item) ───────
    if last_action and last_action.element_id:
        target_eid = str(last_action.element_id)
        if prior_ids and target_eid in prior_ids and target_eid not in curr_ids:
            goal_lower = goal.lower()
            if any(disp_kw in goal_lower for disp_kw in ("close", "dismiss", "delete", "remove", "hide")):
                return VerifierResult(
                    status="goal_complete",
                    reason=f"Target element '{target_eid}' disappeared from the DOM as requested.",
                    confidence=0.95,
                    signals_detected=[f"element_disappeared:{target_eid}"],
                    verification_method="rules",
                )
            else:
                # Element consumed or removed after click (e.g. submit button or completed item)
                return VerifierResult(
                    status="goal_complete",
                    reason=f"Interacted element '{target_eid}' was consumed/disappeared from page.",
                    confidence=0.85,
                    signals_detected=[f"element_disappeared:{target_eid}"],
                    verification_method="rules",
                )

    # ── Rule 6: Fallback to LLM Evaluation ───────────────────────────────────────
    user_body = f"""USER GOAL:
"{goal}"

ACTIVE MILESTONE:
"{milestone.description}" (status: {milestone.status})

LAST ACTION EXECUTED:
{last_action.model_dump_json() if last_action else "None"}

CLIENT ACTION RESULT:
{json.dumps(last_action_result or {}, indent=2)}

PRIOR URL: {prior_url or "Unknown"}
CURRENT URL: {current_url or "Unknown"}

NEWLY APPEARED DOM NODES:
{json.dumps(new_nodes[:10], indent=2) if new_nodes else "None"}

VISIBLE PAGE TEXT SNIPPET:
{(page_text or "")[:1000] if page_text else "No page text"}

JSON RESPONSE:"""

    try:
        raw_llm = await llm_client.call_llm(
            user_prompt=user_body,
            system_prompt=VERIFIER_SYSTEM_PROMPT,
            role="verifier",
        )
        cleaned = _clean_json_str(raw_llm)
        parsed = json.loads(cleaned)

        raw_status = str(parsed.get("status", "in_progress")).lower().strip()
        valid_statuses = {"goal_complete", "milestone_complete", "in_progress", "goal_failed"}
        status: VerifierStatus = raw_status if raw_status in valid_statuses else "in_progress"

        # In Phase 1, map milestone_complete to goal_complete for single implicit milestone
        if status == "milestone_complete":
            status = "goal_complete"

        return VerifierResult(
            status=status,
            reason=parsed.get("reason") or "Verified via LLM evaluation.",
            confidence=float(parsed.get("confidence", 0.85)),
            signals_detected=parsed.get("signals_detected") or ["llm_evaluation"],
            verification_method="llm",
        )
    except Exception as exc:
        logger.warning("Verifier LLM fallback evaluation failed: %s", exc)
        return VerifierResult(
            status="in_progress",
            reason="Rules inconclusive and LLM evaluation unavailable; continuing execution.",
            confidence=0.5,
            signals_detected=["fallback_in_progress"],
            verification_method="rules",
        )

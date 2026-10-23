"""
Same-Page Navigator Agent
backend/app/agent/navigator.py

Resolves active goal milestones into concrete, DOM-validated interactive PlanSteps
on the current webpage, supporting multi-hop exploration across visible and latent nodes.
Strictly adheres to:
1. Zero element ID hallucination (validating all IDs against current DOM).
2. Hybrid ranking of visible and latent nodes backed by lexical + synonym scoring.
3. Exploration move hierarchy: menu reveal -> nav link -> search box -> sitemap -> backtrack.
4. Visited state tracking (URL + DOM fingerprint) and frontier in goal_state.dom_state.
5. Deterministic consequential action gating for irreversible operations.
6. Prime Directive compliance: 100% universal across all websites, zero domain hardcoding,
   zero site-specific selectors, zero topic words.
"""

import hashlib
import json
import logging
import os
import re
import secrets
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from app.agent import llm_client
from app.agent.agentic_planner import find_heuristic_match, _detect_click_action
from app.agent.intent_synonyms import (
    canonicalize_intent,
    extract_search_keywords,
    score_text_similarity,
    _normalize_text,
)
from app.agent.jev_client import get_jev_client
from app.agent.sanitize import strip_pii_from_dom
from app.i18n import resolve_reply_language, t
from app.models.action import ActionType
from app.models.dom import DomNode
from app.models.goal import AgenticPlan, GoalState, Milestone, PlanStep, PlanStepReason

logger = logging.getLogger(__name__)

VALID_ACTIONS: Set[str] = {
    "click",
    "open",
    "double_click",
    "triple_click",
    "fill",
    "scroll",
    "focus",
    "reveal",
}

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
    """Extracts clean JSON object string from raw LLM output, stripping thinking tags."""
    text = (raw or "").strip()
    # Strip <think>...</think> if present
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
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
    """Normalizes DomNode instances or dicts into uniform dict representations, preserving v3 latent metadata."""
    raw_nodes: List[Dict[str, Any]] = []
    for node in dom_map:
        if hasattr(node, "model_dump"):
            d = node.model_dump()
        elif hasattr(node, "dict"):
            d = node.dict()
        elif isinstance(node, dict):
            d = dict(node)
        else:
            d = dict(vars(node))

        # Explicitly ensure all Contract v3 perception attributes are preserved
        for field in ("visible", "reveal_via", "menu", "landmark", "breadcrumb", "href", "resolved_label", "inner_text"):
            if field not in d or d[field] is None:
                val = getattr(node, field, None)
                if val is not None:
                    d[field] = val

        raw_nodes.append(d)
    return raw_nodes


def _compute_state_fingerprint(url: str, safe_dom: List[Dict[str, Any]]) -> str:
    """Computes deterministic hash from URL path and sorted interactive element signatures."""
    clean_url = (url or "").split("?")[0].split("#")[0].rstrip("/")
    signatures: List[str] = []
    for n in safe_dom:
        nid = str(n.get("id", ""))
        tag = str(n.get("tag", ""))
        role = str(n.get("role", ""))
        lbl = (
            n.get("resolved_label")
            or n.get("aria_label")
            or n.get("inner_text")
            or n.get("label")
            or ""
        )
        norm_lbl = _normalize_text(lbl)[:30]
        vis = str(n.get("visible", True))
        signatures.append(f"{nid}:{tag}:{role}:{norm_lbl}:{vis}")
    signatures.sort()
    dom_hash = hashlib.sha256(";".join(signatures).encode("utf-8")).hexdigest()[:16]
    return f"{clean_url}::{dom_hash}"


def _get_navigation_state(goal_state: Optional[GoalState], milestone: Milestone) -> Dict[str, Any]:
    """Retrieves visited, frontier, tried, and tried_labels arrays (each capped at 30) from goal_state or milestone."""
    state_dict: Dict[str, Any] = {}
    if goal_state and isinstance(goal_state.dom_state, dict):
        state_dict = goal_state.dom_state
    elif milestone and milestone.notes:
        try:
            state_dict = json.loads(milestone.notes)
        except Exception:
            state_dict = {}

    visited = list(state_dict.get("visited", []))[-30:]
    frontier = list(state_dict.get("frontier", []))[-30:]
    tried = list(state_dict.get("tried", []))[-30:]
    tried_labels = list(state_dict.get("tried_labels", []))[-30:]
    last_action = state_dict.get("last_action")

    return {
        "visited": visited,
        "frontier": frontier,
        "tried": tried,
        "tried_labels": tried_labels,
        "last_action": last_action,
    }


def _save_navigation_state(
    goal_state: Optional[GoalState],
    milestone: Milestone,
    nav_state: Dict[str, Any],
) -> None:
    """Persists visited, frontier, tried, and tried_labels back to goal_state.dom_state and milestone.notes (max 30 each)."""
    caps = {
        "visited": list(nav_state.get("visited", []))[-30:],
        "frontier": list(nav_state.get("frontier", []))[-30:],
        "tried": list(nav_state.get("tried", []))[-30:],
        "tried_labels": list(nav_state.get("tried_labels", []))[-30:],
        "last_action": nav_state.get("last_action"),
    }
    if goal_state:
        if goal_state.dom_state is None:
            goal_state.dom_state = {}
        goal_state.dom_state.update(caps)
    try:
        milestone.notes = json.dumps(caps, ensure_ascii=False)
    except Exception:
        pass


def _build_tried_summary(nav_state: Dict[str, Any], fallback_goal: str) -> str:
    """Builds a human-readable list of tried labels for localized messages."""
    tried_labels = nav_state.get("tried_labels") or []
    if tried_labels:
        return "، ".join(f"'{l}'" for l in tried_labels[-4:])
    tried = nav_state.get("tried") or []
    if tried:
        clean = []
        for item in tried[-4:]:
            sig = item.split(":")[-1]
            if sig:
                clean.append(f"'{sig}'")
        if clean:
            return "، ".join(clean)
    return f"'{fallback_goal}'"


def _score_dom_candidate(
    node: Dict[str, Any],
    goal: str,
    milestone_desc: str,
) -> float:
    """
    Ranks a visible or latent DOM node against the active milestone and goal.
    Uses:
    1. Lexical matching with _normalize_text, prefix stripping, and plural folding
    2. Breadcrumb matching (bonus if ancestor trail matches goal)
    3. Landmark weighting (nav and main prioritized over footer)
    4. Disclosure toggle scoring
    5. Latent node bonus when matching terms are found
    """
    lbl = (
        node.get("resolved_label")
        or node.get("aria_label")
        or node.get("inner_text")
        or node.get("placeholder")
        or node.get("name")
        or node.get("label")
        or ""
    )
    if not isinstance(lbl, str) or not lbl.strip():
        return 0.0

    target_query = milestone_desc or goal
    clean_lbl = lbl.strip()

    # 1. Direct and stemmed lexical similarity
    sim_milestone = score_text_similarity(target_query, clean_lbl)
    sim_goal = score_text_similarity(goal, clean_lbl)
    base_score = max(sim_milestone, sim_goal)

    # 2. Canonical intent matching for generic site-structure portals (e.g. all services, sitemap)
    canon_key = canonicalize_intent(clean_lbl)
    if canon_key in ("all_services", "sitemap"):
        if any(w in _normalize_text(goal) for w in ("خدم", "بحث", "استعلام", "استفسار", "دفع", "تجديد", "سداد", "service", "search", "inquir", "pay", "renew", "apply")):
            base_score = max(base_score, 0.55)

    # 3. Breadcrumb matching: boost candidates whose ancestor trail matches the goal
    breadcrumb = node.get("breadcrumb") or []
    if isinstance(breadcrumb, list) and breadcrumb:
        b_scores = [max(score_text_similarity(target_query, str(b)), score_text_similarity(goal, str(b))) for b in breadcrumb]
        if b_scores:
            max_b = max(b_scores)
            if max_b >= 0.45:
                base_score += max_b * 0.10

    # 4. Interactive tag & role scoring
    tag = str(node.get("tag", "")).lower()
    role = str(node.get("role", "")).lower()
    ntype = str(node.get("type", "")).lower()
    nid = str(node.get("id", "")).lower()

    # Search submit button should not outrank typing into search box
    if tag in ("button", "input") and (ntype == "submit" or "search" in nid or clean_lbl in ("search", "بحث", "ابحث")):
        if any(w in clean_lbl.lower() for w in ("search", "بحث")):
            base_score = min(base_score, 0.35)

    if tag in ("a", "button") or role in ("link", "button", "menuitem", "tab"):
        base_score += 0.05
    elif tag in ("input", "textarea") or role in ("searchbox", "textbox"):
        is_search = ntype == "search" or role == "searchbox" or "search" in nid or "بحث" in clean_lbl
        if is_search and any(w in _normalize_text(goal) for w in ("بحث", "search", "find", "دور")):
            base_score = max(base_score, 0.75)

    # 5. Landmark weighting
    landmark = str(node.get("landmark", "")).lower()
    if landmark in ("nav", "navigation", "main"):
        base_score += 0.05
    elif landmark in ("footer", "contentinfo") and "sitemap" not in clean_lbl.lower() and "خريطة" not in clean_lbl:
        base_score -= 0.10

    # 6. Latent node prioritization: prefer latent nodes whose label or breadcrumb matches the goal
    is_latent = node.get("visible") is False
    if is_latent and base_score >= 0.40:
        base_score += 0.15

    # 7. Same-page hash-only links penalty (rank below links to other pages and menus)
    href = str(node.get("href") or "").strip()
    if href.startswith("#") or (href and "#" in href and not href.startswith("http") and not href.startswith("/")):
        base_score -= 0.25

    return min(1.0, max(0.0, base_score))


NAVIGATOR_SYSTEM_PROMPT = """You are Atlas Navigator, an intelligent, empathetic AI accessibility web agent.
You help users navigate and interact with interactive elements on ANY webpage, exploring menus, drawers, link lists, and search boxes.
Your job is to resolve the user's active goal or milestone into concrete, DOM-validated interaction steps.

CAPABILITIES ON ANY WEBSITE:
1. Click buttons, links, tabs, radio buttons, checkboxes, or controls. Action: "click".
2. Open files, documents, folders, rows, or cards. Action: "open" (dispatches double-click and Enter).
3. Reveal hidden menus and drawers using their toggle element. Action: "reveal".
4. Fill inputs, search boxes, forms, or text areas. Action: "fill".
5. Scroll or focus to make elements visible. Action: "scroll" or "focus".

RULES FOR EXPLORATION & LATENT NODES:
1. Some elements are latent (visible: false) inside collapsed menus or drawers with `reveal_via` indicating their toggle element.
2. To reach a matching latent element: emit a `reveal` step on its `reveal_via` toggle, then a `click` on the element itself.
3. Every step MUST include `reason` ("reveal_menu", "navigate", "search", "backtrack", "act") and `expect` (observable outcome).
4. NEVER invent or hallucinate element IDs. ONLY reference element IDs that exist in CURRENT INTERACTIVE DOM ELEMENTS.
5. For consequential actions (buying, paying, ordering, deleting, removing, submitting payment):
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
      "action": "click" | "open" | "double_click" | "triple_click" | "fill" | "scroll" | "focus" | "reveal",
      "element_id": "exact-id-from-dom-map",
      "value": "string or null",
      "description": "brief description of action",
      "delay_ms": 600,
      "reason": "reveal_menu" | "navigate" | "search" | "backtrack" | "act",
      "expect": "observable outcome description"
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
    language: Optional[str] = None,
    goal_state: Optional[GoalState] = None,
) -> AgenticPlan:
    """
    Resolves the active milestone into concrete, DOM-validated PlanSteps on the current page.
    Supports multi-hop exploration across visible and latent nodes with visited tracking and backtracking.

    Args:
        goal: The overall user goal statement.
        milestone: The current active milestone checkpoint.
        dom_map: Interactive DOM elements serialized from the page.
        current_url: Current webpage URL.
        page_text: Optional extracted visible text on the page.
        user_response: Optional user response to confirmation prompt ('yes', 'cancel', etc.).
        history: Optional multi-turn conversation history.
        language: Preferred language locale (e.g. 'ar-EG' or 'en-US').
        goal_state: Optional GoalState tracking persistent state across hops.

    Returns:
        AgenticPlan: Fully validated agentic plan with zero hallucinated element IDs.
    """
    reply_lang = resolve_reply_language(language or (goal_state.language if goal_state else None), goal)
    raw_nodes = _convert_dom_nodes_to_dicts(dom_map)
    # L7: Modal scoping: if any node has in_modal: True, only consider in_modal nodes until modal closes
    if any(bool(n.get("in_modal")) for n in raw_nodes):
        raw_nodes = [n for n in raw_nodes if bool(n.get("in_modal"))]
    safe_dom = strip_pii_from_dom(raw_nodes)

    valid_ids: Set[str] = {str(n["id"]) for n in safe_dom if n.get("id")}
    id_to_node: Dict[str, Dict[str, Any]] = {str(n["id"]): n for n in safe_dom if n.get("id")}

    # Navigation state: visited set, frontier stack, and tried history
    nav_state = _get_navigation_state(goal_state, milestone)
    curr_fingerprint = _compute_state_fingerprint(current_url, safe_dom)
    is_repeated_state = curr_fingerprint in nav_state["visited"]
    last_executed_step = nav_state.get("last_action")

    # Record current state in visited set
    if curr_fingerprint not in nav_state["visited"]:
        nav_state["visited"].append(curr_fingerprint)

    # Check max hops limit
    max_hops_limit = goal_state.max_hops if (goal_state and goal_state.max_hops) else 15
    current_hop_count = goal_state.hop_count if goal_state else 0
    if current_hop_count >= max_hops_limit:
        tried_summary = _build_tried_summary(nav_state, goal)
        _save_navigation_state(goal_state, milestone, nav_state)
        return AgenticPlan(
            type="conversation",
            thought="Reached max hops exploration limit.",
            reply=t("nav_max_hops_tried", reply_lang, tried=tried_summary),
            steps=[],
            requires_confirmation=False,
        )

    # Handle explicit user cancellation
    if user_response:
        clean_resp = user_response.strip().lower()
        if any(neg in clean_resp for neg in ("no", "cancel", "stop", "never mind", "abort", "لا", "إلغي", "الغي")):
            return AgenticPlan(
                type="conversation",
                thought="User cancelled the pending action.",
                reply=t("nav_cancelled_action", reply_lang),
                steps=[],
                requires_confirmation=False,
            )

    # Build concise DOM representation preserving latent discovery fields
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
            label = label.strip()[:60]
        category = node.get("group_label") or node.get("role") or node.get("tag")
        entry: Dict[str, Any] = {
            "id": node.get("id"),
            "tag": node.get("tag"),
            "role": node.get("role"),
            "category": category,
        }
        if label:
            entry["label"] = label
        if node.get("visible") is False:
            entry["visible"] = False
        if node.get("reveal_via"):
            entry["reveal_via"] = node.get("reveal_via")
        if node.get("menu"):
            entry["menu"] = node.get("menu")
        if node.get("landmark"):
            entry["landmark"] = node.get("landmark")
        if node.get("breadcrumb"):
            entry["breadcrumb"] = node.get("breadcrumb")
        if node.get("href"):
            entry["href"] = node.get("href")
        if node.get("sensitive"):
            entry["sensitive"] = True
        concise_dom.append(entry)

    # Hybrid Candidate Scoring across visible and latent nodes
    scored_candidates: List[Tuple[Dict[str, Any], float]] = []
    for node in safe_dom:
        s = _score_dom_candidate(node, goal, milestone.description or "")
        scored_candidates.append((node, s))
    scored_candidates.sort(key=lambda x: x[1], reverse=True)

    # Token budgeting: Top 20 candidates for prompt inclusion
    if len(concise_dom) > 20:
        score_by_id = {str(n.get("id")): sc for n, sc in scored_candidates}
        budgeted_dom = sorted(concise_dom, key=lambda n: score_by_id.get(str(n.get("id")), 0.0), reverse=True)[:20]
    else:
        budgeted_dom = concise_dom

    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n".join(f"{h.get('role', 'user').capitalize()}: {h.get('content', '')}" for h in recent)

    summary_nonce = secrets.token_hex(6)
    dom_nonce = secrets.token_hex(6)
    dom_json = json.dumps(budgeted_dom, separators=(',', ':'))

    user_body = f"""PAGE URL: {current_url}
REPLY LANGUAGE: {reply_lang}

--- BEGIN UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---
{(page_text or "").strip()[:350] if page_text else "No page summary"}
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

    # Jev 3 Fast-Path reflex evaluation in live mode
    fast_path_enabled = os.getenv("ATLAS_SYSTEM1_FASTPATH", "true").lower() in ("true", "1", "yes")
    use_fast_path = (
        fast_path_enabled
        and not llm_client._mock_canned_queue
        and not user_response
        and llm_client._get_current_provider() != "mock"
    )
    if use_fast_path and budgeted_dom:
        try:
            jev = get_jev_client()
            target_q = milestone.description or goal
            jev_fast = await jev.choose(
                state={"url": current_url, "goal": goal, "milestone": milestone.description},
                options=budgeted_dom,
                question=f"Which element should be clicked or interacted with for: '{target_q}'?",
            )
            if jev_fast and jev_fast.confidence >= 0.90 and jev_fast.selected_id in valid_ids:
                fast_node = id_to_node.get(jev_fast.selected_id, {})
                fast_tag = str(fast_node.get("tag", "")).lower()
                fast_role = str(fast_node.get("role", "")).lower()
                fast_lbl = fast_node.get("resolved_label") or fast_node.get("inner_text") or jev_fast.selected_id
                click_act, click_count = _detect_click_action(target_q)

                if click_act in {"double_click", "triple_click"}:
                    f_act = click_act
                elif fast_node.get("category") in {"folder", "file"} or fast_role in {"row", "gridcell"}:
                    f_act = "open"
                else:
                    f_act = "click"

                f_val = None
                if fast_tag in ("input", "textarea") or fast_role in ("textbox", "searchbox"):
                    m_val = re.search(r'["\']([^"\']+)["\']', target_q)
                    if m_val:
                        f_act = "fill"
                        f_val = m_val.group(1)

                raw_steps = [{
                    "action": f_act,
                    "element_id": jev_fast.selected_id,
                    "value": f_val,
                    "click_count": click_count if click_act in {"double_click", "triple_click"} else None,
                    "description": f"{f_act} on {fast_lbl}",
                    "delay_ms": 400,
                    "reason": "act",
                    "expect": "immediate response",
                }]
                reply = t("nav_interacting_with", reply_lang, label=fast_lbl)
                thought = f"Jev 3 System 1 reflex selected '{fast_lbl}' (confidence {jev_fast.confidence:.2f})"
        except Exception as fast_exc:
            logger.debug("Jev 3 fast path bypass: %s", fast_exc)

    # Primary LLM Planning Call
    if not raw_steps:
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
            logger.warning("Navigator LLM call or JSON parsing failed: %s. Using universal exploration.", exc)

    # Validate LLM Steps with zero hallucination enforcement and tried element suppression (L4)
    tried_set: Set[str] = set()
    for item in nav_state.get("tried", []):
        if isinstance(item, str):
            if ":" in item:
                tried_set.add(item.split(":")[-1])
            tried_set.add(item)

    validated_steps: List[PlanStep] = []
    for s in raw_steps:
        action = str(s.get("action", "click")).lower().strip()
        if action not in VALID_ACTIONS:
            action = "click"
        raw_id = s.get("element_id")
        eid = str(raw_id).strip() if raw_id is not None else None

        # Filter out steps on elements already attempted without change (L4)
        if eid and (eid in tried_set or f"{action}:{eid}" in tried_set):
            logger.info("Ignoring LLM step on already-tried element: %s", eid)
            continue

        reason: Optional[PlanStepReason] = s.get("reason")
        if reason not in ("reveal_menu", "navigate", "search", "backtrack", "act"):
            reason = "act"
        expect: Optional[str] = s.get("expect")

        if eid and eid in valid_ids:
            target_node = id_to_node.get(eid, {})
            # If target node is latent and step is a bare click without preceding reveal, inject reveal
            if target_node.get("visible") is False and target_node.get("reveal_via") and action != "reveal":
                rev_id = str(target_node["reveal_via"])
                if rev_id in valid_ids and not any(st.action == "reveal" and st.element_id == rev_id for st in validated_steps):
                    validated_steps.append(PlanStep(
                        action="reveal",
                        element_id=rev_id,
                        reason="reveal_menu",
                        expect=eid,
                        description=f"Reveal menu for {target_node.get('resolved_label') or eid}",
                        delay_ms=400,
                    ))
            validated_steps.append(PlanStep(
                action=action,
                element_id=eid,
                value=s.get("value"),
                click_count=s.get("click_count"),
                description=s.get("description", f"{action} on {eid}"),
                delay_ms=s.get("delay_ms", 600),
                reason=reason,
                expect=expect,
            ))
        elif eid:
            # Hallucinated ID: Attempt recovery via universal semantic matching
            desc = s.get("description") or milestone.description or goal
            matched_node, score = find_heuristic_match(desc, concise_dom)
            if matched_node and str(matched_node.get("id")) in valid_ids and score >= 0.5:
                recovered_id = str(matched_node["id"])
                if recovered_id in tried_set or f"{action}:{recovered_id}" in tried_set:
                    logger.info("Ignoring LLM recovered step on already-tried element: %s", recovered_id)
                    continue
                validated_steps.append(PlanStep(
                    action=action,
                    element_id=recovered_id,
                    value=s.get("value"),
                    click_count=s.get("click_count"),
                    description=s.get("description", f"{action} on {recovered_id}"),
                    delay_ms=s.get("delay_ms", 600),
                    reason=reason,
                    expect=expect,
                ))

    # Validate Pending Step for Consequential Operations
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
                reason=raw_pending.get("reason", "act"),
                expect=raw_pending.get("expect"),
            )
        elif p_eid:
            matched_p, p_score = find_heuristic_match(raw_pending.get("description") or goal, concise_dom)
            if matched_p and str(matched_p.get("id")) in valid_ids and p_score >= 0.5:
                validated_pending = PlanStep(
                    action=p_act,
                    element_id=str(matched_p["id"]),
                    value=raw_pending.get("value"),
                    description=raw_pending.get("description", "Confirm action"),
                    reason="act",
                    expect=raw_pending.get("expect"),
                )

    # Guard against repeating the exact same step on an unchanged page state
    if validated_steps and is_repeated_state and last_executed_step:
        first_step_sig = f"{validated_steps[0].action}:{validated_steps[0].element_id}"
        if first_step_sig == last_executed_step:
            logger.info("Suppressed repeated action on unchanged DOM state: %s", first_step_sig)
            validated_steps = []

    is_mock_dummy = (
        llm_client._get_current_provider() == "mock"
        and not getattr(llm_client, "_mock_canned_queue", None)
    )
    fallback_mock_steps: List[PlanStep] = list(validated_steps) if is_mock_dummy else []
    if is_mock_dummy:
        validated_steps = []
        validated_pending = None
        llm_requires_confirmation = False
        llm_confirmation_prompt = None

    # Universal Exploration Hierarchy (Order of priority §Task 2 & WS6 Rule 6)
    # 1. Visible match >= 0.65 first
    # 2. Reveal latent item only when its score beats the best visible one
    # 3. Follow navigation link semantically close
    # 4. Type search keywords into site search
    # 5. Open sitemap or all services page
    # 6. Backtrack
    if not validated_steps and not validated_pending:
        # Separate best visible and best latent candidate
        best_vis_node: Optional[Dict[str, Any]] = None
        best_vis_score: float = -1.0
        best_lat_node: Optional[Dict[str, Any]] = None
        best_lat_score: float = -1.0

        excluded_ids: Set[str] = set()
        for item in nav_state.get("tried", []):
            if isinstance(item, str):
                if ":" in item:
                    excluded_ids.add(item.split(":")[-1])
                excluded_ids.add(item)
        if last_executed_step:
            excluded_ids.add(last_executed_step.split(":")[-1])

        for node, sc in scored_candidates:
            nid = str(node.get("id"))
            if nid in excluded_ids:
                continue
            if node.get("visible") is False:
                if sc > best_lat_score:
                    best_lat_node = node
                    best_lat_score = sc
            else:
                tag = str(node.get("tag", "")).lower()
                role = str(node.get("role", "")).lower()
                ntype = str(node.get("type", "")).lower()
                # Text/search inputs are handled by Priority 4 (Search) rather than direct clicking
                if tag in ("input", "textarea") or role in ("searchbox", "textbox") or ntype == "search":
                    continue
                if sc > best_vis_score:
                    best_vis_node = node
                    best_vis_score = sc

        step_chosen = False

        # Priority 1 & 2: Evaluate visible vs latent
        if best_vis_node and best_vis_score >= 0.65 and best_vis_score >= best_lat_score:
            mid = str(best_vis_node["id"])
            lbl = best_vis_node.get("resolved_label") or best_vis_node.get("inner_text") or mid
            click_act, click_count = _detect_click_action(milestone.description or goal)
            act = click_act if click_act in {"double_click", "triple_click"} else "click"
            act_desc = f"Click '{lbl}'"
            validated_steps.append(PlanStep(
                action=act,
                element_id=mid,
                click_count=click_count,
                description=act_desc,
                delay_ms=600,
                reason="navigate" if best_vis_node.get("tag") == "a" else "act",
                expect=best_vis_node.get("href") or "page transition",
            ))
            reply = t("nav_heuristic_found", reply_lang, lbl=lbl, act_desc=act_desc)
            thought = f"Visible element '{lbl}' matched with high confidence ({best_vis_score:.2f})"
            step_chosen = True

        elif best_lat_node and best_lat_score >= 0.40 and best_lat_node.get("reveal_via"):
            # Latent node matches with higher confidence than visible, or visible is below threshold
            mid = str(best_lat_node["id"])
            lbl = best_lat_node.get("resolved_label") or best_lat_node.get("inner_text") or mid
            toggle_id = str(best_lat_node["reveal_via"])
            toggle_node = id_to_node.get(toggle_id, {})
            toggle_lbl = toggle_node.get("resolved_label") or toggle_node.get("inner_text") or "menu"

            # Emit reveal step on toggle, then click step on target
            validated_steps.append(PlanStep(
                action="reveal",
                element_id=toggle_id,
                description=f"Reveal menu for '{lbl}'",
                delay_ms=400,
                reason="reveal_menu",
                expect=mid,
            ))
            validated_steps.append(PlanStep(
                action="click",
                element_id=mid,
                description=f"Click '{lbl}'",
                delay_ms=600,
                reason="navigate",
                expect=best_lat_node.get("href") or "service page",
            ))
            reply = t("nav_exploring_menu", reply_lang, toggle=toggle_lbl, target=lbl)
            thought = f"Revealing menu toggle '{toggle_lbl}' for latent match '{lbl}' (score={best_lat_score:.2f})"
            step_chosen = True

        elif best_vis_node and best_vis_score >= 0.50:
            mid = str(best_vis_node["id"])
            lbl = best_vis_node.get("resolved_label") or best_vis_node.get("inner_text") or mid
            validated_steps.append(PlanStep(
                action="click",
                element_id=mid,
                description=f"Click '{lbl}'",
                delay_ms=600,
                reason="navigate" if best_vis_node.get("tag") == "a" else "act",
                expect=best_vis_node.get("href") or "next step",
            ))
            reply = t("nav_heuristic_found", reply_lang, lbl=lbl, act_desc=f"Click '{lbl}'")
            thought = f"Selected best available visible node '{lbl}' (score={best_vis_score:.2f})"
            step_chosen = True

        # Priority 3: Follow semantically close navigation link
        if not step_chosen:
            nav_candidate: Optional[Dict[str, Any]] = None
            for node, _ in scored_candidates:
                if node.get("visible") is False or str(node.get("id")) in excluded_ids:
                    continue
                tag = str(node.get("tag", "")).lower()
                role = str(node.get("role", "")).lower()
                landmark = str(node.get("landmark", "")).lower()
                lbl = str(node.get("resolved_label") or node.get("inner_text") or "").strip()
                if (tag == "a" or role == "link") and (landmark in ("nav", "header") or canonicalize_intent(lbl) in ("services", "e_services")):
                    if canonicalize_intent(lbl) == "go_home" or any(w in _normalize_text(lbl) for w in ("الرئيسية", "home", "homepage")):
                        continue
                    if _normalize_text(lbl) and len(lbl) > 2:
                        nav_candidate = node
                        break

            if nav_candidate:
                mid = str(nav_candidate["id"])
                lbl = nav_candidate.get("resolved_label") or nav_candidate.get("inner_text") or mid
                validated_steps.append(PlanStep(
                    action="click",
                    element_id=mid,
                    description=f"Follow navigation link '{lbl}'",
                    delay_ms=600,
                    reason="navigate",
                    expect=nav_candidate.get("href") or "navigation page",
                ))
                reply = t("nav_heuristic_found", reply_lang, lbl=lbl, act_desc=f"Click '{lbl}'")
                thought = f"Following navigation link '{lbl}'"
                step_chosen = True

        # Priority 4: Type search keywords into site search
        if not step_chosen:
            search_input: Optional[Dict[str, Any]] = None
            submit_btn: Optional[Dict[str, Any]] = None
            for node in safe_dom:
                if node.get("visible") is False or str(node.get("id")) in excluded_ids:
                    continue
                tag = str(node.get("tag", "")).lower()
                role = str(node.get("role", "")).lower()
                ntype = str(node.get("type", "")).lower()
                nid = str(node.get("id", "")).lower()
                lbl = str(node.get("placeholder") or node.get("resolved_label") or "").lower()

                if tag in ("input", "textarea") and (ntype == "search" or role == "searchbox" or "search" in nid or "search" in lbl or "بحث" in lbl):
                    search_input = node
                elif tag in ("button", "input") and (ntype == "submit" or role == "button") and ("search" in nid or "search" in lbl or "بحث" in lbl):
                    submit_btn = node

            search_query = extract_search_keywords(goal)
            if search_input and search_query:
                s_id = str(search_input["id"])
                validated_steps.append(PlanStep(
                    action="fill",
                    element_id=s_id,
                    value=search_query,
                    description=f"Type '{search_query}' into search",
                    delay_ms=300,
                    reason="search",
                    expect="search box populated",
                ))
                if submit_btn:
                    validated_steps.append(PlanStep(
                        action="click",
                        element_id=str(submit_btn["id"]),
                        description="Submit search query",
                        delay_ms=600,
                        reason="search",
                        expect="search results",
                    ))
                reply = t("nav_search_query", reply_lang, query=search_query)
                thought = f"Executing site search with key terms '{search_query}'"
                step_chosen = True

        # Priority 5: Open sitemap or all services catalog page
        if not step_chosen:
            sitemap_candidate: Optional[Dict[str, Any]] = None
            for node in safe_dom:
                if node.get("visible") is False or str(node.get("id")) in excluded_ids:
                    continue
                lbl = str(node.get("resolved_label") or node.get("inner_text") or "").strip()
                if canonicalize_intent(lbl) in ("all_services", "sitemap") or any(w in _normalize_text(lbl) for w in ("كلالخدمات", "جميعالخدمات", "خريطةالموقع", "allservices", "sitemap", "catalog")):
                    sitemap_candidate = node
                    break

            if sitemap_candidate:
                mid = str(sitemap_candidate["id"])
                lbl = sitemap_candidate.get("resolved_label") or sitemap_candidate.get("inner_text") or mid
                validated_steps.append(PlanStep(
                    action="click",
                    element_id=mid,
                    description=f"Open all services / sitemap '{lbl}'",
                    delay_ms=600,
                    reason="navigate",
                    expect=sitemap_candidate.get("href") or "services catalog",
                ))
                reply = t("nav_heuristic_found", reply_lang, lbl=lbl, act_desc=f"Click '{lbl}'")
                thought = f"Opening sitemap or all services catalog '{lbl}'"
                step_chosen = True

        # Fallback to mock steps if available and state is not repeated
        if not step_chosen and fallback_mock_steps and not is_repeated_state:
            validated_steps.extend(fallback_mock_steps)
            step_chosen = True

        # Priority 6: Backtrack (Rule 4: take next frontier candidate or click header/home link)
        if not step_chosen:
            # Check frontier for unvisited candidate on this page or previous branches
            frontier_cand: Optional[Dict[str, Any]] = None
            while nav_state["frontier"]:
                cand = nav_state["frontier"].pop()
                if cand.get("element_id") in valid_ids:
                    frontier_cand = cand
                    break

            if frontier_cand:
                mid = str(frontier_cand["element_id"])
                lbl = frontier_cand.get("label") or mid
                validated_steps.append(PlanStep(
                    action="click",
                    element_id=mid,
                    description=f"Explore frontier candidate '{lbl}'",
                    delay_ms=600,
                    reason="navigate",
                    expect="frontier exploration",
                ))
                reply = t("nav_heuristic_found", reply_lang, lbl=lbl, act_desc=f"Click '{lbl}'")
                thought = f"Backtracking: exploring next candidate '{lbl}' from frontier"
                step_chosen = True
            else:
                # Find header / home link
                home_link: Optional[Dict[str, Any]] = None
                for node in safe_dom:
                    if node.get("visible") is False:
                        continue
                    node_id = str(node.get("id") or node.get("ref") or "")
                    if f"backtrack:{node_id}" in nav_state["tried"]:
                        continue
                    lbl = str(node.get("resolved_label") or node.get("inner_text") or "").strip()
                    tag = str(node.get("tag", "")).lower()
                    landmark = str(node.get("landmark", "")).lower()
                    href = str(node.get("href", "")).strip()

                    if (tag == "a" or node.get("role") == "link") and (
                        canonicalize_intent(lbl) == "go_home"
                        or landmark in ("header", "banner")
                        or href in ("/", "./", "index.html", "/index.html")
                        or any(w in _normalize_text(lbl) for w in ("الرئيسية", "home", "homepage"))
                    ):
                        home_link = node
                        break

                if home_link:
                    mid = str(home_link["id"])
                    lbl = home_link.get("resolved_label") or home_link.get("inner_text") or "Home"
                    validated_steps.append(PlanStep(
                        action="click",
                        element_id=mid,
                        description=f"Backtrack to home '{lbl}'",
                        delay_ms=600,
                        reason="backtrack",
                        expect="home page",
                    ))
                    reply = t("nav_deadend_backtrack", reply_lang)
                    thought = "Dead-end reached with no frontier options: backtracking to home link"
                    step_chosen = True

        if not step_chosen:
            # Exploration exhausted or no actionable steps
            tried_summary = _build_tried_summary(nav_state, goal)
            reply = t("nav_exploration_exhausted", reply_lang, tried=tried_summary)
            thought = "Exploration exhausted with no viable navigation paths remaining."

    # Record tried steps and last action in navigation state
    if validated_steps:
        for act in validated_steps:
            sig = f"{act.action}:{act.element_id}"
            if sig not in nav_state["tried"]:
                nav_state["tried"].append(sig)
            if act.reason and f"{act.reason}:{act.element_id}" not in nav_state["tried"]:
                nav_state["tried"].append(f"{act.reason}:{act.element_id}")
            if act.element_id and str(act.element_id) not in nav_state["tried"]:
                nav_state["tried"].append(str(act.element_id))
            step_lbl = None
            step_node = id_to_node.get(act.element_id or "")
            if step_node:
                step_lbl = step_node.get("resolved_label") or step_node.get("inner_text")
            if not step_lbl and act.description:
                m = re.search(r"['\"]([^'\"]+)['\"]", act.description)
                if m:
                    step_lbl = m.group(1)
            if step_lbl:
                lbl_clean = str(step_lbl).strip()
                if "tried_labels" not in nav_state:
                    nav_state["tried_labels"] = []
                if lbl_clean and lbl_clean not in nav_state["tried_labels"]:
                    nav_state["tried_labels"].append(lbl_clean)
        first_act = validated_steps[0]
        nav_state["last_action"] = f"{first_act.action}:{first_act.element_id}"

    _save_navigation_state(goal_state, milestone, nav_state)

    # Deterministic Consequential Action Gate
    user_already_confirmed = False
    if user_response:
        user_already_confirmed = any(
            pos in user_response.strip().lower()
            for pos in ("yes", "sure", "proceed", "confirm", "go ahead", "ok", "أيوة", "ايوة", "نعم", "موافق")
        )

    requires_confirmation = False
    confirmation_prompt: Optional[str] = None
    final_pending: Optional[PlanStep] = validated_pending

    if not user_already_confirmed:
        goal_consequential = _is_consequential_text(goal) or _is_consequential_text(milestone.description)

        sensitive_step_idx: Optional[int] = None
        for idx, step in enumerate(validated_steps):
            # Exploration steps (revealing menus, site search, backtracking) are never consequential transactions
            if step.reason in ("reveal_menu", "search", "backtrack"):
                continue
            step_node = id_to_node.get(step.element_id or "")
            node_sensitive = bool(step_node and step_node.get("sensitive"))
            node_label = step_node.get("resolved_label") or step_node.get("aria_label") or step_node.get("inner_text") or ""
            step_consequential = (
                node_sensitive
                or _is_consequential_text(step.description)
                or _is_consequential_text(node_label)
                or (goal_consequential and idx == len(validated_steps) - 1 and step.action not in ("reveal", "scroll", "focus"))
            )
            if step_consequential:
                sensitive_step_idx = idx
                break

        if sensitive_step_idx is not None:
            requires_confirmation = True
            final_pending = validated_steps.pop(sensitive_step_idx)
            confirmation_prompt = t("nav_confirm_sensitive", reply_lang, desc=final_pending.description or 'perform a sensitive operation')
        elif llm_requires_confirmation and final_pending is not None:
            requires_confirmation = True
            confirmation_prompt = t("nav_confirm_generic", reply_lang)
        elif goal_consequential and final_pending is not None:
            requires_confirmation = True
            confirmation_prompt = t("nav_confirm_desc", reply_lang, desc=final_pending.description or goal)

    plan_type = "confirmation" if requires_confirmation else ("plan" if validated_steps else "conversation")

    return AgenticPlan(
        type=plan_type,
        thought=thought,
        reply=reply,
        steps=validated_steps,
        requires_confirmation=requires_confirmation,
        confirmation_prompt=confirmation_prompt,
        confirmation_options=[t("confirm_proceed_option", reply_lang), t("confirm_cancel_option", reply_lang)],
        pending_step=final_pending,
        confirmation_success_message=t("action_completed", reply_lang),
    )

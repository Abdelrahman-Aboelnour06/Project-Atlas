"""
Goal Planner Agent
backend/app/agent/planner.py

Decomposes user navigation goals into an ordered sequence of discrete Milestones.
Supports branch parallelism identification (tagging independent milestones with distinct branch_ids).
Complies with Project Atlas Universal Rule: 100% universal across all websites, zero domain hardcoding.
"""

import json
import logging
import re
import secrets
from typing import List, Optional

from app.agent import llm_client
from app.models.goal import Milestone

logger = logging.getLogger(__name__)


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


PLANNER_SYSTEM_PROMPT = """You are Atlas Planner, an intelligent AI accessibility planner for web navigation and task completion.
Your job is to decompose the user's high-level goal into an ordered sequence of discrete Milestones.

RULES:
1. Break down multi-part goals (e.g. "create an account and download the price list") into sequential or parallel milestones.
2. For independent branches that could run in separate tabs (e.g. account signup vs price list download), assign distinct `branch_id` values (e.g. "b-0", "b-1").
3. For single-part goals or tightly sequential steps, use a single branch ("b-0").
4. Mark the ultimate completion milestone with `is_final: true`. Earlier milestones must have `is_final: false`.
5. NEVER invent element IDs or site-specific selectors. Milestones are semantic checkpoints (e.g. "Sign up for an account", "Navigate to pricing table", "Download schedule").
6. If the goal is a single action, emit exactly ONE milestone marked `is_final: true`.

RESPONSE JSON SCHEMA:
{
  "thought": "Reasoning about goal decomposition and dependencies",
  "milestones": [
    {
      "id": "m-0",
      "description": "Clear human-readable description of this milestone",
      "is_final": false,
      "satisfied_by_navigation": false,
      "branch_id": "b-0",
      "target_url": null,
      "success_criteria": "Observable criteria confirming completion"
    }
  ]
}"""


async def plan_goal(
    goal: str,
    current_url: Optional[str] = None,
    page_text: Optional[str] = None,
) -> List[Milestone]:
    """
    Decomposes a user goal into an ordered list of Milestones.
    Falls back gracefully to a single Milestone on malformed LLM responses.
    """
    cleaned_goal = (goal or "").strip()
    if not cleaned_goal:
        return [
            Milestone(
                id="m-0",
                description="Explore current page",
                is_final=True,
                branch_id="b-0",
            )
        ]

    summary_nonce = secrets.token_hex(8)

    user_body = f"""PAGE CONTEXT:
URL: {current_url or "Unknown"}
--- BEGIN UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---
{(page_text or "").strip()[:1000] if page_text else "No page summary available"}
--- END UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---

USER GOAL TO DECOMPOSE:
"{cleaned_goal}"

JSON RESPONSE:"""

    try:
        raw_llm = await llm_client.call_llm(
            user_prompt=user_body,
            system_prompt=PLANNER_SYSTEM_PROMPT,
            role="planner",
        )
        cleaned = _clean_json_str(raw_llm)
        parsed = json.loads(cleaned)
        raw_milestones = parsed.get("milestones", [])

        milestones: List[Milestone] = []
        for idx, m in enumerate(raw_milestones):
            m_id = str(m.get("id") or f"m-{idx}")
            desc = str(m.get("description") or f"Milestone {idx + 1}")
            is_final = bool(m.get("is_final", idx == len(raw_milestones) - 1))
            branch_id = str(m.get("branch_id") or "b-0")
            sat_nav = bool(m.get("satisfied_by_navigation", False))
            target_url = m.get("target_url")
            crit = m.get("success_criteria")

            milestones.append(
                Milestone(
                    id=m_id,
                    description=desc,
                    is_final=is_final,
                    satisfied_by_navigation=sat_nav,
                    branch_id=branch_id,
                    target_url=target_url,
                    success_criteria=crit,
                )
            )

        if milestones:
            # Ensure at least the last milestone is marked is_final
            if not any(m.is_final for m in milestones):
                milestones[-1].is_final = True
            return milestones

    except Exception as exc:
        logger.warning(
            "Planner LLM call or JSON parsing failed: %s. Falling back to single milestone.",
            exc,
        )

    # Graceful fallback: single milestone wrapping the goal
    return [
        Milestone(
            id="m-0",
            description=cleaned_goal,
            is_final=True,
            branch_id="b-0",
        )
    ]

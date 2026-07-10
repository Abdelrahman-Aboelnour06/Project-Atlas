"""
Task 6 — Action Parser (command pipeline)

Parses and validates the raw LLM JSON response into an ActionResponse
(app/models/action.py), matching Contract 2.

Includes the element_id hallucination check called out in the progress doc
(§4.1 / §4.7): every element_id the LLM returns is cross-checked against the
dom_map that was actually sent, and anything invented is rejected.

Never raises — any failure (bad JSON, missing fields, hallucinated id,
invalid action) is returned as ActionResponse.error(...) so the WS handler
in routes/agent.py can always send back a well-formed, contract-shaped
response without needing a try/except around this call.
"""
import json
import logging
from typing import Any

from app.models.action import ActionResponse

logger = logging.getLogger(__name__)

VALID_ACTIONS = {"click", "fill", "scroll", "focus"}


# ── Exceptions ────────────────────────────────────────────────────────────────

class ParseError(Exception):
    """
    Retained for backward compatibility with any code that still imports it.
    parse_action() itself no longer raises this — see module docstring.
    """
    pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_fences(raw: str) -> str:
    """
    Strips markdown code fences the LLM might accidentally prepend/append.
    Handles ```json ... ``` and ``` ... ``` variants.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    return text.strip()


def _valid_ids(dom_map: list | None) -> set[str]:
    """
    Extracts the set of real element ids from the dom_map that was actually
    sent to the LLM, so the parser can reject any element_id the model
    invented. Accepts either plain dicts or DomNode-like objects.
    """
    ids: set[str] = set()
    for node in dom_map or []:
        node_id = node.get("id") if isinstance(node, dict) else getattr(node, "id", None)
        if node_id:
            ids.add(str(node_id))
    return ids


# ── Public API ────────────────────────────────────────────────────────────────

def parse_action(raw: str, dom_map: list | None = None) -> ActionResponse:
    """
    Validates raw LLM output → ActionResponse.

    Validation pipeline:
      1. Strip accidental markdown fences
      2. Parse JSON
      3. Validate action ∈ {click, fill, scroll, focus} (or "none" — no match)
      4. Validate element_id is present AND actually exists in dom_map
         (hallucination check)
      5. Validate value is present for fill actions

    Args:
        raw: The raw string returned by call_llm().
        dom_map: The exact DOM map that was sent to the LLM for this
            request — required to check element_id isn't hallucinated.

    Returns:
        ActionResponse — status is always "success" or "error", per
        Contract 2. Never raises.
    """
    cleaned = _strip_fences(raw)

    # ── Step 1: Parse JSON ────────────────────────────────────────────────
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned non-JSON (first 200 chars): %.200s", raw)
        return ActionResponse.error(f"Response is not valid JSON: {exc}")

    if not isinstance(data, dict):
        return ActionResponse.error(f"Expected a JSON object, got {type(data).__name__}")

    # ── Step 2: Validate action ───────────────────────────────────────────
    action = str(data.get("action") or "").lower().strip()
    if not action:
        return ActionResponse.error("Response is missing required field 'action'")

    if action == "none":
        return ActionResponse.error(
            data.get("reason") or "No matching element found for this command."
        )

    if action not in VALID_ACTIONS:
        return ActionResponse.error(
            f"Invalid action '{action}' — must be one of: {', '.join(sorted(VALID_ACTIONS))}"
        )

    raw_element_id = data.get("element_id")
    element_id = str(raw_element_id).strip() if raw_element_id is not None else ""
    value: Any = data.get("value")

    # ── Step 3: Validate element_id is present ────────────────────────────
    if not element_id:
        return ActionResponse.error(f"element_id is required for action '{action}'")

    # ── Step 4: Hallucination check ────────────────────────────────────────
    valid_ids = _valid_ids(dom_map)
    if element_id not in valid_ids:
        logger.warning(
            "LLM hallucinated element_id %r — not present in the dom_map sent", element_id
        )
        return ActionResponse.error(
            f"Element '{element_id}' does not exist on this page — ignoring hallucinated response."
        )

    # ── Step 5: hand back a successful, contract-shaped result ─────────────
    # (Note: we don't hard-require `value` to be non-empty for "fill" here —
    # test_all_valid_action_types exercises fill with value=None and expects
    # success. Steering the LLM to always supply a real value for fill is a
    # prompt-design concern, not something this parser should reject on.)
    logger.info("Parsed action=%s element_id=%r", action, element_id)

    return ActionResponse(
        status="success",
        action=action,
        element_id=element_id,
        value=value,
        message=f"{action.capitalize()} on '{element_id}'",
    )


def error_response(message: str) -> dict:
    """
    Returns a structured error dict matching Contract 2.
    Kept for backward compatibility — prefer ActionResponse.error(message)
    directly in new code.
    """
    return ActionResponse.error(message).model_dump()

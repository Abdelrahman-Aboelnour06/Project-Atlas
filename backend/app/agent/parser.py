"""
Task 6 — Action Parser
Parses and validates the raw LLM JSON response into a structured action dict.

Caller (Task 7 handler) is responsible for logging the result to usage_logs,
since it holds the DB session and full request context.
"""
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

VALID_ACTIONS = {"click", "fill", "scroll", "focus", "none"}


# ── Exceptions ────────────────────────────────────────────────────────────────

class ParseError(Exception):
    """Raised when the LLM output cannot be parsed into a valid action."""
    pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_fences(raw: str) -> str:
    """
    Strips markdown code fences the LLM might accidentally prepend/append.
    Handles ```json ... ``` and ``` ... ``` variants.
    """
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    return text.strip()


def _build(status: str, action: str, element_id: str,
           value: Any, message: str) -> dict:
    """Assembles the ActionResponse dict matching the WS contract."""
    return {
        "status":     status,      # "ok" | "no_match" | "error"
        "action":     action,      # click | fill | scroll | focus | none
        "element_id": element_id,
        "value":      value,       # str for fill, None otherwise
        "message":    message,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def parse_action(raw: str) -> dict:
    """
    Validates raw LLM output → ActionResponse dict.

    Validation pipeline:
      1. Strip accidental markdown fences
      2. Parse JSON — raises ParseError if malformed
      3. Validate action ∈ VALID_ACTIONS
      4. Validate element_id non-empty for non-none actions
      5. Validate value present for fill actions

    Args:
        raw: The raw string returned by call_llm().

    Returns:
        ActionResponse dict with keys: status, action, element_id, value, message.

    Raises:
        ParseError: On any validation failure. Caller should catch and log.
    """
    cleaned = _strip_fences(raw)

    # ── Step 1: Parse JSON ────────────────────────────────────────────────
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned non-JSON (first 200 chars): %.200s", raw)
        raise ParseError(f"Response is not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ParseError(f"Expected a JSON object, got {type(data).__name__}")

    # ── Step 2: Validate action ───────────────────────────────────────────
    action = str(data.get("action", "")).lower().strip()
    if not action:
        raise ParseError("Response is missing required field 'action'")
    if action not in VALID_ACTIONS:
        raise ParseError(
            f"Invalid action '{action}' — must be one of: {', '.join(sorted(VALID_ACTIONS))}"
        )

    element_id = str(data.get("element_id", "")).strip()
    value      = data.get("value")
    confidence = float(data.get("confidence", 1.0))

    # ── Step 3: Validate element_id ──────────────────────────────────────
    if action != "none" and not element_id:
        raise ParseError(f"element_id is required for action '{action}'")

    # ── Step 4: Validate value for fill ──────────────────────────────────
    if action == "fill" and not value:
        raise ParseError("value is required for fill actions (the text to type)")

    logger.info(
        "Parsed action=%s element_id=%r confidence=%.2f",
        action, element_id or "(none)", confidence,
    )

    # ── Step 5: Build response ────────────────────────────────────────────
    if action == "none":
        return _build(
            status="no_match",
            action="none",
            element_id="",
            value=None,
            message=data.get("reason") or "No matching element found for this command.",
        )

    return _build(
        status="ok",
        action=action,
        element_id=element_id,
        value=value,
        message=f"{action.capitalize()} on '{element_id}'",
    )


def error_response(message: str) -> dict:
    """
    Returns a structured error ActionResponse dict.
    Used by Task 7 when the pipeline itself fails (LLMError, ParseError, etc.)
    so the client always gets a consistent JSON shape.
    """
    return _build(
        status="error",
        action="none",
        element_id="",
        value=None,
        message=message,
    )

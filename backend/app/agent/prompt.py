"""
Task 5 — Prompt Engineering
Builds the system + user prompt for the Atlas LLM agent.

Output is a single string ready for call_llm() — Ollama /api/generate format.
"""
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are Atlas, an AI web accessibility agent embedded in a user's browser.
Your job is to interpret a user's voice command and map it to exactly one action on the page.

You will receive:
1. A DOM MAP — a flat JSON array of interactive elements currently visible on the page
2. A USER COMMAND — a natural-language instruction spoken by the user

## Response format
Return ONLY a raw JSON object. No markdown. No explanation. No code fences. Just JSON.

### Matching element found:
{"action": "click",  "element_id": "btn-checkout",  "value": null,          "confidence": 0.95}
{"action": "fill",   "element_id": "input-email",   "value": "text to type","confidence": 0.90}
{"action": "scroll", "element_id": "section-cart",  "value": null,          "confidence": 0.85}
{"action": "focus",  "element_id": "input-search",  "value": null,          "confidence": 0.80}

### No matching element:
{"action": "none", "element_id": "", "value": null, "confidence": 0.0, "reason": "No checkout button found"}

## Rules
- action MUST be exactly one of: click, fill, scroll, focus, none
- element_id MUST exactly match an id from the DOM map (case-sensitive); empty string only for "none"
- value is ONLY included for fill actions; null otherwise
- confidence is a float 0.0–1.0
- If the command is ambiguous or no element matches, use "none" with a descriptive reason
- NEVER include passwords, emails, or any sensitive user data in your output\
"""

# Appended when the DOM has very few elements to guide the fallback
_FALLBACK_HINT = (
    "\n\nNOTE: The DOM map is sparse. "
    "If no element clearly matches the command, use action \"none\" with a descriptive reason."
)


def _serialize_node(node: Any) -> dict:
    """Converts a DomNode (Pydantic model or dict) to a plain dict."""
    if hasattr(node, "model_dump"):          # Pydantic v2
        return node.model_dump(exclude_none=True)
    if hasattr(node, "dict"):                # Pydantic v1
        return node.dict(exclude_none=True)
    return node                              # Already a dict


def build_prompt(dom_map: list, command: str) -> str:
    """
    Builds the full prompt string for call_llm().

    Serialises the DOM map to compact JSON, injects the user command,
    and appends a fallback hint when the DOM is sparse (< 3 elements).

    Args:
        dom_map:  List of DomNode objects (or dicts) from the DOM serialiser.
        command:  The user's natural-language voice command.

    Returns:
        A single string to pass directly to call_llm().
    """
    nodes = [_serialize_node(n) for n in dom_map]
    dom_json = json.dumps(nodes, indent=2)

    fallback_hint = _FALLBACK_HINT if len(dom_map) < 3 else ""

    logger.debug("Building prompt: %d DOM nodes, command=%r", len(dom_map), command)

    return (
        f"{SYSTEM_PROMPT}"
        f"{fallback_hint}\n\n"
        f"DOM MAP:\n{dom_json}\n\n"
        f"USER COMMAND: {command}\n\n"
        f"JSON response:"
    )

"""
"Simplify all elements" response parser (headline feature — powers the sidebar).

Validates the raw LLM output for the simplify pipeline into the list shape
Contract 5 defines: [{element_id, label, category}, ...].

Never raises. Any failure — malformed JSON, wrong top-level shape, entries
missing required fields — is dropped rather than blowing up the request,
so the WS handler in routes/agent.py can always send back a well-formed
`{"status": "success", "elements": [...]}` response. Worst case the
sidebar just shows fewer items than the page actually has, which is far
better than a broken WebSocket connection.

Hallucination check: every element_id must exist in the dom_map that was
actually sent to the LLM (§4.1 of the progress doc calls this out
explicitly as the one thing this parser must not skip). Anything invented
is dropped and logged as a warning.
"""
import json
import logging

logger = logging.getLogger(__name__)

VALID_CATEGORIES = {"button", "link", "input", "select", "textarea", "form", "other"}
DEFAULT_CATEGORY = "other"


def _strip_fences(raw: str) -> str:
    """Strips markdown code fences (```json ... ``` or ``` ... ```)."""
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    return text.strip()


def _valid_ids(dom_map: list | None) -> set[str]:
    """Extracts the set of real element ids from the dom_map actually sent."""
    ids: set[str] = set()
    for node in dom_map or []:
        node_id = node.get("id") if isinstance(node, dict) else getattr(node, "id", None)
        if node_id:
            ids.add(str(node_id))
    return ids


def parse_simplify_response(raw: str, dom_map: list | None) -> list[dict]:
    """
    Validates raw LLM output → list of {element_id, label, category} dicts.

    Args:
        raw: The raw string returned by call_llm().
        dom_map: The exact DOM map that was sent to the LLM for this
            request — required to drop hallucinated element_ids.

    Returns:
        A clean list of dicts, each with element_id/label/category.
        Returns [] on any malformed/unusable input — this must never
        raise, since a bad simplify response should mean an empty
        sidebar, not a broken connection.
    """
    valid_ids = _valid_ids(dom_map)
    cleaned = _strip_fences(raw)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Simplify LLM returned non-JSON (first 200 chars): %.200s", raw)
        return []

    if not isinstance(data, list):
        logger.warning("Simplify LLM did not return a JSON array (got %s)", type(data).__name__)
        return []

    clean_elements: list[dict] = []
    seen_ids: set[str] = set()

    for entry in data:
        if not isinstance(entry, dict):
            continue

        element_id = str(entry.get("element_id") or "").strip()
        label = str(entry.get("label") or "").strip()
        category = str(entry.get("category") or "").strip().lower()

        if not element_id or not label:
            continue

        # Hallucination check — drop anything not actually in the dom_map sent.
        if element_id not in valid_ids:
            logger.warning(
                "Dropping hallucinated element_id %r from simplify response", element_id
            )
            continue

        # De-dupe: only keep the first entry per real element.
        if element_id in seen_ids:
            continue
        seen_ids.add(element_id)

        if category not in VALID_CATEGORIES:
            category = DEFAULT_CATEGORY

        clean_elements.append({
            "element_id": element_id,
            "label": label,
            "category": category,
        })

    return clean_elements

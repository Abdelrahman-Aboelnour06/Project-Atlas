"""
"Simplify all elements" prompt builder (headline feature — powers the sidebar).

Input:  one DOM map, no user command.
Output: a prompt asking the LLM to return a JSON array — one entry per
        interactive element — each with element_id, label, category.

Mirrors the shape of app/agent/prompt.py's build_prompt() for the command
pipeline, but describes every element instead of resolving one command.
Assumes the dom_map handed in has already been through
app.agent.sanitize.strip_pii_from_dom() (routes/agent.py does this before
calling either prompt builder), so no PII stripping happens here.
"""
import json

VALID_CATEGORIES = ("button", "link", "input", "select", "textarea", "form", "other")

SYSTEM_PROMPT = """You are an accessibility assistant helping an elderly or disabled user understand a webpage they cannot easily read or navigate themselves.

You will be given a JSON array of interactive elements found on the page (buttons, links, inputs, etc.). For EVERY element in the array, describe what it does in short, plain, everyday language (aim for 2-6 words, no jargon). Do not skip any element. Do not invent elements that are not in the input array.

Return ONLY a raw JSON array — no markdown fences, no commentary, no explanation — in exactly this shape:
[
  {"element_id": "<copied exactly from the element's id field>", "label": "<short plain-language description>", "category": "<button|link|input|select|textarea|form|other>"}
]

Rules:
- "element_id" MUST be copied exactly, character-for-character, from the "id" field of the matching input element. Never invent an id that isn't in the input array — inputs that lack an id should be skipped rather than given a made-up one.
- "label" describes the purpose or action in language a non-technical person would understand, e.g. "Search the site", "Go to checkout", "Enter your email address", "Close this popup" — not the raw tag name or CSS class.
- "category" must be exactly one of: button, link, input, select, textarea, form, other.
- Base your description on inner_text, placeholder, aria_label, and tag — whichever are present and most informative.
- If an element genuinely has no usable information, still include it with your best guess and category "other" rather than omitting it.
"""


def build_simplify_prompt(dom_map: list) -> str:
    """
    Builds the prompt for the "simplify whole page" pipeline.

    Args:
        dom_map: the (already PII-stripped) list of DomNode-shaped dicts
            describing every interactive element on the current page.

    Returns:
        The full prompt string to hand to call_llm().
    """
    dom_json = json.dumps(dom_map, indent=2)

    fallback_hint = ""
    if not dom_map:
        fallback_hint = "\nHint: The element list is empty. Return an empty JSON array: []"

    return (
        f"{SYSTEM_PROMPT}{fallback_hint}\n\n"
        f"INTERACTIVE ELEMENTS ({len(dom_map)} total):\n{dom_json}\n\n"
        f"JSON response:"
    )

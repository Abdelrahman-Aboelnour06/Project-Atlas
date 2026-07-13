"""
"Resolve one command" prompt builder (command pipeline — app/agent/parser.py
parses what this returns).

Assumes the dom_map handed in has already been through
app.agent.sanitize.strip_pii_from_dom() (routes/agent.py does this once,
centrally, before calling either prompt builder), so no PII stripping
happens here. Mirrors app/agent/simplify_prompt.py's build_simplify_prompt()
for the simplify pipeline.

(Previously this file carried its own local copy of the PII-stripping
logic and re-scrubbed the dom_map a second time, using a different
redaction string ('[REDACTED]') than app/agent/sanitize.py
('[REDACTED_PII]'). That was dead weight at best — routes/agent.py already
sanitizes before this is ever called — and a drift risk at worst: two
independent copies of the same policy will eventually disagree. Removed in
favor of the single sanitize.py implementation, matching how
simplify_prompt.py already does it.)
"""
import json


def build_prompt(dom_map: list, command: str) -> str:
    """
    Builds the prompt for the "resolve one command" pipeline.

    Args:
        dom_map: the (already PII-stripped) list of DomNode-shaped dicts
            describing every interactive element on the current page.
        command: the raw user command, e.g. "click checkout".

    Returns:
        The full prompt string to hand to call_llm().
    """
    dom_json = json.dumps(dom_map, indent=2)

    system_prompt = """
    You are an accessibility assistant. Return ONLY raw JSON.
    Format: {"action": "click|fill|scroll|focus|none", "element_id": "id", "value": "text"}
    """

    fallback_hint = ""
    if len(dom_map) < 3:
        fallback_hint = "\nHint: There are very few elements here. If the command does not match, return action 'none'."

    return f"{system_prompt}{fallback_hint}\n\nDOM MAP:\n{dom_json}\n\nUSER COMMAND: {command}\n\nJSON response:"

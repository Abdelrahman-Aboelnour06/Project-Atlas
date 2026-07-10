"""
app/agent — Atlas AI pipeline

Public API:
    call_llm(prompt)                       → str            (llm_client.py)
    build_prompt(dom_map, command)         → str            (prompt.py — command pipeline)
    parse_action(raw, dom_map)             → ActionResponse (parser.py — command pipeline)
    build_simplify_prompt(dom_map)         → str            (simplify_prompt.py — simplify pipeline)
    parse_simplify_response(raw, dom_map)  → list[dict]     (simplify_parser.py — simplify pipeline)
    error_response(msg)                    → dict           (parser.py, back-compat)

Errors:
    LLMError    — raised by call_llm on total failure (timeout / bad HTTP / etc.)

Note: parse_action() and parse_simplify_response() never raise — both
return an error-shaped result instead (ActionResponse.error(...) / []),
so routes/agent.py doesn't need a ParseError catch anymore. ParseError is
kept in parser.py only for backward compatibility with old imports.
"""
from app.agent.llm_client import call_llm, LLMError
from app.agent.prompt import build_prompt
from app.agent.parser import parse_action, ParseError, error_response
from app.agent.simplify_prompt import build_simplify_prompt
from app.agent.simplify_parser import parse_simplify_response

__all__ = [
    "call_llm", "LLMError",
    "build_prompt", "parse_action", "ParseError", "error_response",
    "build_simplify_prompt", "parse_simplify_response",
]

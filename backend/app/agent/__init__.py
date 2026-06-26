"""
app/agent — Atlas AI pipeline

Public API:
    call_llm(prompt)     → str          (Task 4 — llm_client.py)
    build_prompt(...)    → str          (Task 5 — prompt.py)
    parse_action(raw)    → dict         (Task 6 — parser.py)
    error_response(msg)  → dict         (Task 6 — parser.py)

Errors:
    LLMError    — raised by call_llm on total failure
    ParseError  — raised by parse_action on invalid LLM output
"""
from app.agent.llm_client import call_llm, LLMError
from app.agent.prompt import build_prompt
from app.agent.parser import parse_action, ParseError, error_response

__all__ = [
    "call_llm", "LLMError",
    "build_prompt",
    "parse_action", "ParseError", "error_response",
]

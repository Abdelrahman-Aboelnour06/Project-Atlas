from typing import Literal
from pydantic import BaseModel
from .dom import DomNode


class AgentMessage(BaseModel):
    session_id: str
    api_key:    str
    url:        str
    dom_map:    list[DomNode]
    command:    str
    # Contract 1 v1.1 — which pipeline to run. Required, no default: an
    # explicit type keeps the two pipelines unambiguous rather than
    # silently guessing "command" for a malformed/incomplete message.
    type:       Literal["command", "simplify"]

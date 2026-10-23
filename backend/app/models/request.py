from typing import Any, Literal
from pydantic import BaseModel, field_validator
from .dom import DomNode, coerce_dom_map


class AgentMessage(BaseModel):
    session_id: str
    api_key:    str | None = None
    url:        str
    dom_map:    list[DomNode]
    command:    str
    type:       Literal["command", "simplify", "chat", "summary"]
    page_text:  str = ""
    language:   str | None = None

    @field_validator("dom_map", mode="before")
    @classmethod
    def _validate_dom_map(cls, v: Any) -> list[DomNode]:
        return coerce_dom_map(v)


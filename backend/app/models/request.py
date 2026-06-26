from pydantic import BaseModel
from .dom import DomNode


class AgentMessage(BaseModel):
    session_id: str
    api_key:    str
    url:        str
    dom_map:    list[DomNode]
    command:    str

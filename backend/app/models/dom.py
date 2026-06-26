from pydantic import BaseModel


class DomNode(BaseModel):
    id:          str | None
    tag:         str
    type:        str | None
    inner_text:  str | None
    placeholder: str | None
    aria_label:  str | None
    href:        str | None
    name:        str | None
    role:        str | None

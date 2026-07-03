from pydantic import BaseModel


class DomNode(BaseModel):
    # NOTE (Contract 3, v1.1): `id` is the synthetic `data-atlas-id` value
    # injected by the content script — never the element's native HTML `id`.
    # Most real sites don't have a native `id` on interactive elements, so
    # backend and frontend both key off this synthetic value everywhere.
    id:          str | None
    tag:         str
    type:        str | None
    inner_text:  str | None
    placeholder: str | None
    aria_label:  str | None
    href:        str | None
    name:        str | None
    role:        str | None
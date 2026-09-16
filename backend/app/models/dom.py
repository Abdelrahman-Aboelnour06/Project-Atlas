from pydantic import BaseModel


class SelectOption(BaseModel):
    value: str
    label: str
    selected: bool = False


class DomNode(BaseModel):
    # NOTE (Contract 3, v1.1): `id` is the synthetic `data-atlas-id` value
    # injected by the content script — never the element's native HTML `id`.
    # Most real sites don't have a native `id` on interactive elements, so
    # backend and frontend both key off this synthetic value everywhere.
    id:          str | None = None
    tag:         str
    type:        str | None = None
    inner_text:  str | None = None
    placeholder: str | None = None
    aria_label:  str | None = None
    href:        str | None = None
    name:        str | None = None
    role:           str | None = None
    sensitive:      bool | None = False
    resolved_label: str | None = None
    group_label:    str | None = None

    # v2 extensions (§9.3)
    ref:            str | None = None
    form_id:        str | None = None
    required:       bool | None = False
    disabled:       bool | None = False
    current_value:  str | None = None
    checked:        bool | None = None
    options:        list[SelectOption] | None = None
    pattern:        str | None = None
    maxlength:      int | None = None
    inputmode:      str | None = None
    autocomplete:   str | None = None
    invalid:        bool | None = None
    error_text:     str | None = None
    section_label:  str | None = None
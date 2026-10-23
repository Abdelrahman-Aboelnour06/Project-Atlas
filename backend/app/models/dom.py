import logging
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, PrivateAttr, model_validator

logger = logging.getLogger("atlas.dom.coercion")


class SelectOption(BaseModel):
    value: str
    label: str
    selected: bool = False


class MenuInfo(BaseModel):
    haspopup: str | None = None
    expanded: bool | None = None
    controls: str | None = None


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

    # v3 extensions (§9.3 / latent nodes)
    visible:        bool | None = True
    reveal_via:     str | None = None
    menu:           MenuInfo | None = None
    landmark:       Literal['header', 'nav', 'main', 'footer', 'aside'] | None = None
    breadcrumb:     list[str] | None = None

    # v4 extensions (live-run fixes: L3, L7)
    opens_new_tab:    bool | None = False
    target_origin:    str | None = None
    in_modal:         bool | None = False
    blocked_by_modal: bool | None = False


def coerce_dom_map(raw_list: Any) -> list[DomNode]:
    """
    Per-node validation and graceful coercion for dom_map payloads (L8).
    Coerces long strings, casts numeric strings, nulls unknown enum values,
    and drops unrecoverable malformed nodes while preserving HTTP 200 responses.
    Logs WARNING with field names and counts only (zero values logged).
    """
    if not raw_list:
        return []
    if not isinstance(raw_list, list):
        logger.warning("DOM map validation dropped entire non-list payload")
        return []

    coerced_counts: dict[str, int] = {}
    dropped_count = 0
    valid_nodes: list[DomNode] = []

    for item in raw_list:
        if isinstance(item, DomNode):
            valid_nodes.append(item)
            continue
        if not isinstance(item, dict):
            dropped_count += 1
            continue

        d = dict(item)

        # Tag is required. If missing or non-string, drop node
        raw_tag = d.get("tag")
        if not raw_tag or not isinstance(raw_tag, str):
            dropped_count += 1
            continue

        # Generous string limits (labels 512, inner_text 2000, href 2048)
        string_limits = [
            ("resolved_label", 512),
            ("aria_label", 512),
            ("placeholder", 512),
            ("name", 512),
            ("group_label", 512),
            ("section_label", 512),
            ("pattern", 512),
            ("error_text", 512),
            ("inner_text", 2000),
            ("current_value", 2000),
            ("href", 2048),
            ("target_origin", 2048),
            ("id", 128),
            ("ref", 128),
            ("tag", 128),
            ("type", 128),
            ("role", 128),
            ("form_id", 128),
            ("inputmode", 64),
            ("autocomplete", 64),
            ("reveal_via", 128),
        ]
        for field, max_len in string_limits:
            if field in d and d[field] is not None:
                val = d[field]
                coerced = False
                if not isinstance(val, str):
                    val = str(val)
                    coerced = True
                if len(val) > max_len:
                    val = val[:max_len]
                    coerced = True
                if coerced:
                    coerced_counts[field] = coerced_counts.get(field, 0) + 1
                d[field] = val

        # Maxlength: cast numeric strings to int, null if invalid
        if "maxlength" in d and d["maxlength"] is not None:
            ml = d["maxlength"]
            if not isinstance(ml, int) or isinstance(ml, bool):
                try:
                    d["maxlength"] = int(str(ml).strip())
                    coerced_counts["maxlength"] = coerced_counts.get("maxlength", 0) + 1
                except (ValueError, TypeError):
                    d["maxlength"] = None
                    coerced_counts["maxlength"] = coerced_counts.get("maxlength", 0) + 1

        # Landmark: null unknown enum values
        if "landmark" in d and d["landmark"] is not None:
            lm = str(d["landmark"]).lower().strip()
            if lm not in ("header", "nav", "main", "footer", "aside"):
                d["landmark"] = None
                coerced_counts["landmark"] = coerced_counts.get("landmark", 0) + 1
            else:
                d["landmark"] = lm

        # Booleans: coerce truthy/falsy strings or ints
        for bool_field in (
            "required",
            "disabled",
            "checked",
            "invalid",
            "visible",
            "sensitive",
            "in_modal",
            "blocked_by_modal",
            "opens_new_tab",
        ):
            if bool_field in d and d[bool_field] is not None:
                bv = d[bool_field]
                if not isinstance(bv, bool):
                    if isinstance(bv, str):
                        d[bool_field] = bv.lower().strip() in ("true", "1", "yes")
                    else:
                        d[bool_field] = bool(bv)
                    coerced_counts[bool_field] = coerced_counts.get(bool_field, 0) + 1

        # Options: coerce list of dicts/SelectOption, null if corrupt
        if "options" in d and d["options"] is not None:
            if not isinstance(d["options"], list):
                d["options"] = None
                coerced_counts["options"] = coerced_counts.get("options", 0) + 1
            else:
                cleaned_opts = []
                for opt in d["options"]:
                    if isinstance(opt, (dict, SelectOption)):
                        cleaned_opts.append(opt)
                    else:
                        coerced_counts["options"] = coerced_counts.get("options", 0) + 1
                d["options"] = cleaned_opts

        # Menu: coerce dict/MenuInfo, null if corrupt
        if "menu" in d and d["menu"] is not None:
            if not isinstance(d["menu"], (dict, MenuInfo)):
                d["menu"] = None
                coerced_counts["menu"] = coerced_counts.get("menu", 0) + 1

        try:
            node = DomNode(**d)
            valid_nodes.append(node)
        except Exception:
            dropped_count += 1

    if dropped_count > 0 or coerced_counts:
        for field, count in coerced_counts.items():
            logger.warning("DOM map validation: coerced %d node(s) on field '%s'", count, field)
        if dropped_count > 0:
            logger.warning("DOM map validation: dropped %d malformed node(s)", dropped_count)

    return valid_nodes


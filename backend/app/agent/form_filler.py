"""
Form Filler Agent
backend/app/agent/form_filler.py

Plans whole-form field-to-value assignments in a single pass.
Enforces privacy rails: emits vault tokens ({password}, {cc_number}) and profile tokens ({profile.email}).
Never fabricates personal information or auto-checks consent/terms checkboxes.
Complies with Project Atlas Universal Rule: 100% universal across all websites, zero domain hardcoding.
"""

import json
import logging
import re
import secrets
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from app.agent import llm_client
from app.agent.intent_synonyms import (
    _normalize_text,
    matches_any_keyword,
    matches_keyword_sequence,
)
from app.i18n import resolve_reply_language, t
from app.models.dom import DomNode
from app.models.goal import FieldPlan, FormPlan, InputField, InputFieldKind

logger = logging.getLogger(__name__)

CONSENT_TERMS_KEYWORDS: Set[str] = {
    "terms",
    "terms of service",
    "terms and conditions",
    "privacy policy",
    "consent",
    "agree",
    "agreement",
    "acknowledge",
}

LANGUAGE_MIRRORING_DIRECTIVE = (
    "Reply in the same language the user is using. If language is an Arabic locale (e.g. 'ar-EG'), "
    "reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. "
    "If unset, infer from script. If mixed, mirror the mix."
)

FORM_FILLER_SYSTEM_PROMPT = """You are Atlas Form Filler. Map each field to a value.

HARD RULES:
1. Reference ONLY refs present in the FORM INVENTORY. Never invent a ref.
2. For select_option, the value MUST be one of that field's listed options.
3. For any field marked sensitive, emit a vault token ({password}, {cc_number}, {otp}, {pin}, ...).
   NEVER emit a literal secret. You do not have access to real secret values.
4. For any field sourced from the user profile, emit {profile.<key>} (e.g. {profile.email}, {profile.phone}, {profile.full_name}, {profile.address_line1}). Never a literal.
5. If a required field cannot be sourced, add its ref to missing_required. Do not invent
   personal data — never fabricate a name, birth date, phone number, or address.
6. Consent/terms/privacy checkboxes MUST NEVER be checked by the agent. Place their refs in missing_required.
7. Put the submit control in submit_ref. NEVER place it in fields[].
8. If you observe a CAPTCHA, OTP prompt, or file upload requirement, list it in blockers.
9. Language mirroring: Reply in the same language the user is using. If language is an Arabic locale (e.g. 'ar-EG'), reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. If unset, infer from script. If mixed, mirror the mix.

RESPONSE JSON SCHEMA:
{
  "form_id": "form_identifier",
  "fields": [
    {
      "ref": "valid_ref",
      "action": "fill" | "select_option" | "set_checkbox" | "set_radio" | "upload_file",
      "value": "string_or_token",
      "source": "profile" | "vault" | "user" | "default",
      "confidence": 1.0,
      "rationale": "Reason for assignment"
    }
  ],
  "submit_ref": "submit_button_ref_or_null",
  "missing_required": ["unsourced_or_consent_ref"],
  "blockers": ["captcha", "otp"]
}"""


def _clean_json_str(raw: str) -> str:
    """Extracts clean JSON object string from raw LLM output."""
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines) - 1 if lines and lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])
    match = re.search(r"\{[\s\S]*\}", text)
    return match.group(0) if match else text.strip()


def _is_consent_checkbox(node: Dict[str, Any]) -> bool:
    """Detects whether a checkbox represents consent/terms of service agreement."""
    tag = (node.get("tag") or "").lower()
    node_type = (node.get("type") or "").lower()
    role = (node.get("role") or "").lower()

    if not (tag == "input" and node_type == "checkbox") and role != "checkbox":
        return False

    combined = f"{node.get('name', '')} {node.get('resolved_label', '')} {node.get('aria_label', '')}".lower()
    return any(kw in combined for kw in CONSENT_TERMS_KEYWORDS)


TOKEN_REGEX = re.compile(
    r"^\{(?:vault:[a-zA-Z0-9_]+|password|login_id|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret|national_id|profile\.[a-z0-9_]+)(?:_\d+)?\}$"
)
TOKEN_FIND_REGEX = re.compile(
    r"\{(?:vault:[a-zA-Z0-9_]+|password|login_id|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret|national_id|profile\.[a-z0-9_]+)(?:_\d+)?\}"
)

IDENTITY_KEYWORDS = (
    "national id",
    "national_id",
    "national-id",
    "civil id",
    "civil_id",
    "civil-id",
    "passport",
    "الرقم القومي",
    "رقم الهوية",
    "جواز السفر",
    "بطاقة الرقم القومي",
)

ID_LIKE_LABEL_KEYWORDS = (
    "id",
    "identity",
    "identification",
    "رقم",
    "هوية",
    "قومي",
)


def _is_sensitive_field(node: Dict[str, Any]) -> bool:
    """
    Universal classifier for sensitive fields adhering strictly to the Prime Directive.
    Rule 2:
      Sensitive = existing classifySensitiveField categories
                + identity-number keywords (national id/civil id/passport/الرقم القومي/رقم الهوية/جواز السفر)
                + numeric-only fields with maxlength or pattern length >= 9 and an id-like label.
    """
    if node.get("sensitive") is True:
        return True

    tag = (node.get("tag") or "").lower()
    node_type = (node.get("type") or "").lower()
    if node_type == "password":
        return True

    name = (node.get("name") or "").lower()
    label = (node.get("resolved_label") or node.get("aria_label") or node.get("inner_text") or "").lower()
    placeholder = (node.get("placeholder") or "").lower()
    autocomplete = (node.get("autocomplete") or "").lower()
    combined = f"{autocomplete} {name} {label} {placeholder}".lower()

    if any(kw in combined for kw in (
        "password", "passwd",
        "cc-number", "card-number", "card_number", "credit-card", "credit card", "cc_number",
        "cvv", "cvc", "csc",
        "cc-exp", "expiry", "expiration",
        "cardholder",
        "ssn", "social security", "social-security",
        "one-time-code", "otp", "2fa", "mfa", "verification-code", "verification_code", "رمز التحقق",
        "pin", "secret",
    )):
        return True

    if any(kw in combined for kw in IDENTITY_KEYWORDS):
        return True

    pattern = str(node.get("pattern") or "")
    maxlength = node.get("maxlength") or node.get("max_length")
    has_id_label = any(kw in combined for kw in ID_LIKE_LABEL_KEYWORDS)

    pattern_length = None
    if pattern:
        m_len = re.search(r"\{(\d+)(?:,\s*(\d*))?\}", pattern)
        if m_len:
            pattern_length = int(m_len.group(1))

    is_numeric = (
        node_type in ("number", "tel")
        or "0-9" in pattern
        or r"\d" in pattern
        or node.get("inputmode") == "numeric"
    )

    effective_length = maxlength if (maxlength and isinstance(maxlength, int)) else pattern_length
    if is_numeric and effective_length and effective_length >= 9 and has_id_label:
        return True

    return False


def _determine_field_kind(node: Dict[str, Any]) -> InputFieldKind:
    tag = (node.get("tag") or "").lower()
    node_type = (node.get("type") or "").lower()
    name = (node.get("name") or "").lower()
    combined = f"{name} {node.get('resolved_label', '')} {node.get('autocomplete', '')}".lower()

    if node_type == "password" or "password" in combined:
        return "password"
    if "otp" in combined or "one-time-code" in combined or "رمز التحقق" in combined:
        return "otp"
    if tag == "select":
        return "select"
    if node_type == "email" or "email" in combined:
        return "email"
    if node_type in ("tel", "phone") or "phone" in combined:
        return "phone"
    if node_type == "date" or "date" in combined:
        return "date"
    if node_type == "number":
        return "number"
    return "text"


def is_search_or_filter_form(nodes: List[Dict[str, Any]]) -> bool:
    """
    Returns True if the nodes represent a site search box or filter bar,
    which should never be treated as the service target form for submit confirmation (L6).
    """
    if not nodes:
        return False

    # 1. Explicit search role, type, or query parameter names
    has_search = any(
        (n.get("role") or "").lower() in ("search", "searchbox")
        or (n.get("type") or "").lower() == "search"
        or (n.get("name") or "").lower() in ("q", "query", "search", "s", "searchbox", "keyword")
        for n in nodes
    )
    if has_search:
        return True

    # 2. Header or nav landmark with single text input + button
    inputs = [
        n for n in nodes
        if (n.get("tag") or "").lower() in ("input", "textarea")
        and (n.get("type") or "").lower() not in ("hidden", "submit", "button", "checkbox", "radio")
    ]
    if len(inputs) == 1:
        inp = inputs[0]
        landmark = (inp.get("landmark") or "").lower()
        if landmark in ("header", "nav"):
            return True

    # 3. Filter/sort control bars
    filter_keywords = ("filter", "sort", "تصفية", "ترتيب", "فلتر")
    control_labels = " ".join(
        (n.get("resolved_label") or n.get("aria_label") or n.get("inner_text") or "")
        for n in nodes
    ).lower()
    if any(fk in control_labels for fk in filter_keywords) and not any(n.get("required") for n in nodes):
        if len(inputs) <= 3 and not any(n.get("sensitive") for n in nodes):
            return True

    return False


LANGUAGE_NAMES_EXACT: Set[str] = {
    "english", "en", "عربي", "العربية", "ar", "français", "francais", "french", "fr",
    "deutsch", "de", "español", "es", "italiano", "it", "русский", "ru"
}


_matches_any_keyword_whole_word = matches_any_keyword


def _is_language_switch_control(node: Dict[str, Any], label: str) -> bool:
    """
    Detects a language switch ONLY when the WHOLE label is a language name or code,
    or when the control has lang or hreflang attributes.
    """
    if node.get("lang") or node.get("hreflang"):
        return True
    clean = label.strip().lower()
    norm = _normalize_text(label).strip()
    return clean in LANGUAGE_NAMES_EXACT or norm in {"عربي", "العربيه"}


def _is_icon_only_without_label(node: Dict[str, Any]) -> bool:
    """
    An icon-only exclusion applies only when the control has no text label at all:
    no resolved_label, aria_label, title, or inner_text with alphanumeric characters.
    """
    raw_labels = [
        str(node.get("resolved_label") or ""),
        str(node.get("aria_label") or ""),
        str(node.get("title") or ""),
        str(node.get("inner_text") or ""),
        str(node.get("value") or ""),
        str(node.get("current_value") or ""),
    ]
    combined = " ".join(raw_labels).strip()
    if not combined:
        return True
    text_only = re.sub(r"[\s☰×✕✖+−\-_<>‹›«»|•\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F]", "", combined)
    return len(text_only) == 0


EXCLUDED_SUBMIT_KEYWORDS: Set[str] = {
    # Back / previous
    "back", "previous", "رجوع", "السابق", "عودة", "العودة",
    # Cancel / reset / clear
    "cancel", "reset", "clear", "إلغاء", "الغاء", "مسح", "إعادة تعيين", "اعادة تعيين",
    # Close
    "close", "إغلاق", "اغلاق",
    # Home
    "home", "الرئيسية", "الرئيسيه",
    # Print
    "print", "طباعة", "طباعه",
    # Help
    "help", "مساعدة", "مساعده",
}


def _is_excluded_submit_candidate(node: Dict[str, Any]) -> bool:
    """
    Universal filter for controls that must NEVER be chosen as a submit button.
    Excludes back, cancel, reset, close, home, print, help, menu/disclosure toggles,
    language switches, icon-only buttons with no label, and header/nav/banner/contentinfo landmarks.
    """
    lbl = (
        node.get("resolved_label")
        or node.get("aria_label")
        or node.get("inner_text")
        or node.get("title")
        or node.get("value")
        or node.get("current_value")
        or ""
    ).strip()

    # 1. Landmark exclusion: nav, banner, contentinfo, header
    landmark = (node.get("landmark") or "").lower()
    if landmark in ("nav", "banner", "contentinfo", "header"):
        return True

    # 2. Language switch
    if _is_language_switch_control(node, lbl):
        return True

    # 3. Icon-only without label
    if _is_icon_only_without_label(node):
        return True

    # 4. Menu / disclosure toggles (E-F13: aria-controls dropped on its own, aria-expanded/aria-haspopup kept)
    menu_obj = node.get("menu")
    if isinstance(menu_obj, dict):
        if menu_obj.get("expanded") is not None or menu_obj.get("haspopup"):
            return True
    if node.get("aria_expanded") is not None or node.get("aria_haspopup"):
        return True
    role = (node.get("role") or "").lower()
    if role in ("menuitem", "tab"):
        return True
    if (node.get("tag") or "").lower() == "details":
        return True

    # 5. Whole-word / whole-token keyword exclusion
    if matches_any_keyword(lbl, EXCLUDED_SUBMIT_KEYWORDS):
        return True

    return False


SUBMIT_SEMANTICS_KEYWORDS: Set[str] = {
    # Arabic
    "استعلام", "بحث", "عرض", "إرسال", "ارسال", "تأكيد", "تاكيد", "متابعة", "متابعه", "التالي",
    # English
    "submit", "search", "inquire", "continue", "next", "send",
}


def _score_submit_candidate(node: Dict[str, Any]) -> int:
    """
    Ranks submit candidate priority:
    Higher score = better candidate.
    - type=submit with submit semantics: 100
    - submit semantics in label: 80
    - type=submit: 60
    - other: 10
    """
    node_type = (node.get("type") or "").lower()
    lbl = (
        node.get("resolved_label")
        or node.get("aria_label")
        or node.get("inner_text")
        or ""
    ).strip()
    has_submit_semantics = _matches_any_keyword_whole_word(lbl, SUBMIT_SEMANTICS_KEYWORDS)
    is_submit_type = (node_type == "submit")

    if is_submit_type and has_submit_semantics:
        return 100
    if has_submit_semantics:
        return 80
    if is_submit_type:
        return 60
    return 10


def _is_control_wrong(node: Dict[str, Any], wrong_controls: Optional[List[Any]]) -> bool:
    """
    Checks if this control was previously recorded as navigating backwards/wrong.
    Keyed by (form_id, normalized_label); secondary check on element_id.
    """
    if not wrong_controls:
        return False

    node_form_id = str(node.get("form_id") or "").strip()
    lbl = (
        node.get("resolved_label")
        or node.get("aria_label")
        or node.get("inner_text")
        or ""
    ).strip()
    norm_lbl = _normalize_text(lbl)
    node_ref = str(node.get("ref") or node.get("id") or "")

    for wc in wrong_controls:
        if isinstance(wc, (list, tuple)) and len(wc) >= 2:
            wc_form, wc_label = str(wc[0]), str(wc[1])
            wc_id = str(wc[2]) if len(wc) > 2 else ""
            if wc_form and node_form_id and wc_form == node_form_id and _normalize_text(wc_label) == norm_lbl:
                return True
            if not wc_form and _normalize_text(wc_label) == norm_lbl:
                return True
            if wc_id and wc_id == node_ref:
                return True
        elif isinstance(wc, dict):
            wc_form = str(wc.get("form_id") or "")
            wc_label = str(wc.get("normalized_label") or wc.get("label") or "")
            wc_id = str(wc.get("element_id") or "")
            if wc_form and node_form_id and wc_form == node_form_id and _normalize_text(wc_label) == norm_lbl:
                return True
            if not wc_form and _normalize_text(wc_label) == norm_lbl:
                return True
            if wc_id and wc_id == node_ref:
                return True
        elif isinstance(wc, str):
            if wc == node_ref or _normalize_text(wc) == norm_lbl:
                return True

    return False


def _is_field_required(node: Dict[str, Any]) -> bool:
    """
    A field is required when it has:
    - HTML required attribute (required is True / "true")
    - aria-required (aria_required is True / "true")
    - Visible required marker in raw label, label container, placeholder, or inner_text:
      "*" (asterisk), "مطلوب", "إجباري", "اجباري", "required", "mandatory".
    """
    if node.get("required") in (True, "true"):
        return True
    if node.get("aria_required") in (True, "true"):
        return True

    raw_labels = [
        str(node.get("resolved_label") or ""),
        str(node.get("aria_label") or ""),
        str(node.get("inner_text") or ""),
        str(node.get("placeholder") or ""),
        str(node.get("name") or ""),
    ]
    combined_raw = " ".join(raw_labels)

    if "*" in combined_raw:
        return True

    REQUIRED_MARKERS: Set[str] = {"مطلوب", "إجباري", "اجباري", "required", "mandatory"}
    if _matches_any_keyword_whole_word(combined_raw, REQUIRED_MARKERS):
        return True

    return False


def is_field_value_empty(node: Dict[str, Any]) -> bool:
    """Checks whether an input or select currently lacks a user-supplied value."""
    val = node.get("current_value") if node.get("current_value") is not None else node.get("value")
    if val is None:
        return True
    str_val = str(val).strip()
    if not str_val:
        return True
    tag = (node.get("tag") or "").lower()
    if tag == "select":
        placeholder_indicators = {"اختر", "--", "select", "none", "choose", "- اختر -"}
        if any(pi in str_val.lower() for pi in placeholder_indicators):
            return True
    return False


def extract_target_form_fields(
    dom_nodes: List[Union[DomNode, Dict[str, Any]]],
    form_id: Optional[str] = None,
    goal: Optional[str] = None,
) -> Tuple[List[InputField], List[InputField]]:
    """
    Universally extracts (required_fields, optional_fields) for the target form.
    - required_fields: all inputs where _is_field_required(n) is True.
    - optional_fields: if total target user-data inputs <= 8, includes empty non-required inputs marked required=False.
    Skips search inputs, consent checkboxes, hidden, readonly, and disabled inputs.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_nodes)
    if any(bool(n.get("in_modal")) for n in raw_nodes):
        raw_nodes = [n for n in raw_nodes if bool(n.get("in_modal"))]

    # Filter to form_id if specified and present
    if form_id and any(str(n.get("form_id") or "") == str(form_id) for n in raw_nodes):
        form_nodes = [n for n in raw_nodes if str(n.get("form_id") or "") == str(form_id)]
    else:
        form_nodes = raw_nodes

    # Auth wall protection: auth-wall forms never go to form filler
    auth_wall = classify_auth_wall(form_nodes) or classify_auth_wall(raw_nodes)
    if auth_wall:
        is_modal = any(bool(n.get("in_modal")) for n in raw_nodes)
        is_auth_goal = matches_any_keyword((goal or "").lower(), AUTH_KEYWORDS) if goal else False
        if is_modal or (goal and not is_auth_goal):
            return [], []

    user_data_inputs: List[Dict[str, Any]] = []
    for n in form_nodes:
        ref = n.get("ref") or n.get("id")
        if not ref:
            continue
        tag = (n.get("tag") or "").lower()
        node_type = (n.get("type") or "").lower()
        role = (n.get("role") or "").lower()

        if tag not in ("input", "select", "textarea") and role not in ("textbox", "combobox", "spinbutton"):
            continue
        if node_type in ("submit", "hidden", "button", "reset"):
            continue
        if n.get("disabled") in (True, "true") or n.get("readonly") in (True, "true"):
            continue
        if role in ("search", "searchbox") or node_type == "search":
            continue
        if (n.get("name") or "").lower() in ("q", "query", "search", "s"):
            continue
        if _is_consent_checkbox(n):
            continue

        user_data_inputs.append(n)

    required_fields: List[InputField] = []
    optional_fields: List[InputField] = []
    total_count = len(user_data_inputs)

    for n in user_data_inputs:
        ref = str(n.get("ref") or n.get("id"))
        is_req = _is_field_required(n)
        label = (
            n.get("resolved_label")
            or n.get("aria_label")
            or n.get("inner_text")
            or n.get("placeholder")
            or n.get("name")
            or ref
        )
        label = re.sub(r"\s*\*+$", "", str(label)).strip()
        label = re.sub(r"\s*\(?(?:مطلوب|إجباري|اجباري|required|mandatory)\)?", "", str(label), flags=re.IGNORECASE).strip()

        sensitive = _is_sensitive_field(n)
        kind = _determine_field_kind(n)
        pattern = n.get("pattern")
        maxlength = n.get("maxlength") or n.get("max_length")

        opts: List[str] = []
        if n.get("options"):
            opts = [
                o.get("value") if isinstance(o, dict) else (o.value if hasattr(o, "value") else str(o))
                for o in n["options"][:20]
            ]

        field_obj = InputField(
            ref=ref,
            label=label,
            kind=kind,
            sensitive=sensitive,
            pattern=str(pattern) if pattern else None,
            maxlength=int(maxlength) if maxlength is not None else None,
            required=is_req,
            options=opts,
        )

        if is_req:
            required_fields.append(field_obj)
        elif total_count <= 8 and is_field_value_empty(n):
            optional_fields.append(field_obj)

    return required_fields, optional_fields


AUTH_KEYWORDS: Set[str] = {
    # Login
    "تسجيل الدخول", "دخول", "sign in", "log in", "login", "log into", "sign into",
    # Signup
    "إنشاء حساب", "انشاء حساب", "تسجيل جديد", "حساب جديد", "sign up", "signup", "register", "create account",
}

SIGNUP_SPECIFIC_KEYWORDS: Set[str] = {
    "إنشاء حساب", "انشاء حساب", "تسجيل جديد", "حساب جديد", "sign up", "signup", "register", "create account",
}

LOGIN_SPECIFIC_KEYWORDS: Set[str] = {
    # Login
    "تسجيل الدخول", "دخول", "sign in", "log in", "login", "log into", "sign into",
}


def _score_auth_submit_candidate(node: Dict[str, Any]) -> int:
    tag = (node.get("tag") or "").lower()
    ntype = (node.get("type") or "").lower()
    lbl = (
        node.get("resolved_label")
        or node.get("aria_label")
        or node.get("inner_text")
        or node.get("value")
        or node.get("current_value")
        or ""
    ).strip()

    is_submit_type = (ntype == "submit") or (tag == "button" and ntype not in ("button", "reset"))
    matches_auth = matches_any_keyword(lbl, AUTH_KEYWORDS)
    matches_signup = matches_any_keyword(lbl, SIGNUP_SPECIFIC_KEYWORDS)
    matches_semantics = matches_any_keyword(lbl, SUBMIT_SEMANTICS_KEYWORDS)

    if is_submit_type and (matches_auth or matches_signup):
        return 100
    if is_submit_type and matches_semantics:
        return 80
    if is_submit_type:
        return 60
    if (matches_auth or matches_signup) and ntype != "button":
        return 50
    if matches_auth or matches_signup:
        return 30
    if matches_semantics:
        return 20
    return 10


def classify_auth_wall(
    dom_nodes: List[Union[DomNode, Dict[str, Any]]],
    page_text: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Detects if the current DOM has an auth wall (login or sign-up modal/page) adhering to WS12 E-F2.
    Rules:
    - Page without a modal: an auth wall needs a visible password input. Text alone never counts,
      and page_text is not used.
    - Modal:
      * with 2 or more password inputs: sign-up;
      * with exactly 1 password input: decide by the submit button of the password's form (or modal);
        it is sign-up only when that submit matches sign-up words and not login words, otherwise login;
      * without password inputs: sign-up if modal heading/buttons match sign-up words;
        login by text only when modal heading/buttons match login words AND it has an identifier input.
    - Identifier, password and submit must come from the same form_id, or the same modal.
    - If type is login but no password or no identifier field was found, returns None for missing field.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_nodes)
    is_modal = any(bool(n.get("in_modal")) for n in raw_nodes)
    if is_modal:
        modal_nodes = [n for n in raw_nodes if bool(n.get("in_modal"))]
        nodes_to_check = modal_nodes
    else:
        nodes_to_check = raw_nodes

    password_nodes = [
        n for n in nodes_to_check
        if (n.get("tag") or "").lower() == "input" and (n.get("type") or "").lower() == "password"
    ]

    # Non-modal page: MUST have a visible password input. Text alone never counts, page_text not used (E-F2).
    if not is_modal and not password_nodes:
        return None

    # Form scoping: prefer nodes sharing the form_id of the first password field
    if password_nodes and password_nodes[0].get("form_id"):
        target_form_id = password_nodes[0].get("form_id")
        matching_form_nodes = [n for n in nodes_to_check if n.get("form_id") == target_form_id]
        form_nodes = matching_form_nodes if matching_form_nodes else nodes_to_check
    else:
        form_nodes = nodes_to_check

    # Identify submit button in auth form
    submit_candidates = [
        n for n in form_nodes
        if (
            (n.get("tag") or "").lower() == "button"
            or (n.get("type") or "").lower() in ("submit", "button")
            or (n.get("role") or "").lower() in ("button", "submit")
        )
        and not _is_excluded_submit_candidate(n)
    ]
    if not submit_candidates and form_nodes is not nodes_to_check:
        submit_candidates = [
            n for n in nodes_to_check
            if (
                (n.get("tag") or "").lower() == "button"
                or (n.get("type") or "").lower() in ("submit", "button")
                or (n.get("role") or "").lower() in ("button", "submit")
            )
            and not _is_excluded_submit_candidate(n)
        ]

    submit_ref = None
    submit_label = None
    if submit_candidates:
        best_submit = max(submit_candidates, key=_score_auth_submit_candidate)
        submit_ref = str(best_submit.get("ref") or best_submit.get("id") or "")
        submit_label = (
            best_submit.get("resolved_label")
            or best_submit.get("aria_label")
            or best_submit.get("inner_text")
            or best_submit.get("value")
            or best_submit.get("current_value")
            or ""
        ).strip() or "Submit"

    # Decide auth_type
    # R2-5: with exactly one password input, decide by the submit button of the password's form (or modal).
    # It is sign-up only when that submit matches sign-up words and not login words.
    # Two or more passwords is still sign-up. The existing no-password text rule stays.
    if len(password_nodes) >= 2:
        auth_type = "signup"
    elif len(password_nodes) == 1:
        sub_lbl = submit_label or ""
        is_signup_submit = (
            matches_any_keyword(sub_lbl, SIGNUP_SPECIFIC_KEYWORDS)
            and not matches_any_keyword(sub_lbl, LOGIN_SPECIFIC_KEYWORDS)
        )
        auth_type = "signup" if is_signup_submit else "login"
    elif not is_modal:
        return None
    else:
        # Modal page with 0 password inputs (E-F2):
        modal_headings_and_btns = [
            n for n in nodes_to_check
            if ((n.get("tag") or "").lower() in ("h1", "h2", "h3", "h4", "h5", "h6", "button")
            or (n.get("role") or "").lower() in ("heading", "button")
            or (n.get("type") or "").lower() == "submit")
            and (n.get("tag") or "").lower() != "a"
        ]
        combined_modal_text = " ".join([
            str(n.get("resolved_label") or n.get("aria_label") or n.get("inner_text") or "")
            for n in modal_headings_and_btns
        ])

        candidate_identifiers = [
            n for n in nodes_to_check
            if (n.get("tag") or "").lower() in ("input", "textarea")
            and (n.get("type") or "").lower() in ("text", "email", "tel", "number", "")
            and (n.get("type") or "").lower() not in ("hidden", "submit", "button", "checkbox", "radio")
        ]

        if matches_any_keyword(combined_modal_text, SIGNUP_SPECIFIC_KEYWORDS):
            auth_type = "signup"
        elif matches_any_keyword(combined_modal_text, AUTH_KEYWORDS) and candidate_identifiers:
            auth_type = "login"
        else:
            return None

    # Identify identifier field (non-password text, email or tel input before password in DOM order)
    identifier_ref = None
    identifier_label = None
    if password_nodes:
        pwd_idx = form_nodes.index(password_nodes[0]) if password_nodes[0] in form_nodes else len(form_nodes)
        candidate_ids = []
        for i, n in enumerate(form_nodes):
            if i >= pwd_idx:
                break
            tag = (n.get("tag") or "").lower()
            ntype = (n.get("type") or "").lower()
            if tag in ("input", "textarea") and ntype in ("text", "email", "tel", "number", ""):
                candidate_ids.append(n)
        if candidate_ids:
            target_id_node = candidate_ids[-1]
            identifier_ref = str(target_id_node.get("ref") or target_id_node.get("id") or "")
            identifier_label = target_id_node.get("resolved_label") or target_id_node.get("name") or target_id_node.get("placeholder") or None
        else:
            for n in form_nodes:
                tag = (n.get("tag") or "").lower()
                ntype = (n.get("type") or "").lower()
                if tag in ("input", "textarea") and ntype in ("text", "email", "tel", "number", ""):
                    identifier_ref = str(n.get("ref") or n.get("id") or "")
                    identifier_label = n.get("resolved_label") or n.get("name") or n.get("placeholder") or None
                    break
    else:
        # No password node (e.g. text login modal or signup without password)
        for n in form_nodes:
            tag = (n.get("tag") or "").lower()
            ntype = (n.get("type") or "").lower()
            if tag in ("input", "textarea") and ntype in ("text", "email", "tel", "number", "") and ntype not in ("hidden", "submit", "button"):
                identifier_ref = str(n.get("ref") or n.get("id") or "")
                identifier_label = n.get("resolved_label") or n.get("name") or n.get("placeholder") or None
                break

    password_ref = str(password_nodes[0].get("ref") or password_nodes[0].get("id") or "") if password_nodes else None
    confirm_pwd_ref = str(password_nodes[1].get("ref") or password_nodes[1].get("id") or "") if len(password_nodes) >= 2 else None

    return {
        "type": auth_type,
        "modal": is_modal,
        "identifier_ref": identifier_ref,
        "identifier_label": identifier_label,
        "password_ref": password_ref,
        "confirm_password_ref": confirm_pwd_ref,
        "submit_ref": submit_ref,
        "submit_label": submit_label,
    }


def extract_required_form_fields(
    dom_nodes: List[Union[DomNode, Dict[str, Any]]]
) -> List[InputField]:
    """
    Universally discovers required form inputs from dom_nodes.
    Stateless: recomputed from the live DOM on every hop.
    """
    reqs, _ = extract_target_form_fields(dom_nodes)
    return reqs


def extract_tokens_from_goal(
    goal: str, required_fields: List[InputField]
) -> Dict[str, str]:
    """
    Extracts tokens already present in the user goal (any TOKEN_REGEX match).
    CRITICAL (Rule 1): The backend NEVER extracts raw sensitive digits or values.
    Only tokens already present in the goal text may be matched to fields.
    """
    if not goal:
        return {}

    tokens_in_goal = TOKEN_FIND_REGEX.findall(goal)
    if not tokens_in_goal:
        return {}

    extracted: Dict[str, str] = {}
    used_tokens: Set[str] = set()

    for field in required_fields:
        if not field.sensitive:
            continue
        for token in tokens_in_goal:
            if token in used_tokens:
                continue
            extracted[field.ref] = token
            used_tokens.add(token)
            break

    return extracted


def format_missing_fields_prompt(
    fields: List[InputField],
    language: Optional[str] = None
) -> str:
    """
    Formats localized prompt in user's language using the page's own labels.
    Arabic: "محتاج الرقم القومي ورقم اللوحة للمتابعة."
    English: "Please provide National ID and plate numbers to proceed."
    """
    if not fields:
        return ""

    reply_lang = resolve_reply_language(language, None)
    labels = [f.label or f.ref for f in fields]

    if reply_lang == "ar-EG":
        if len(labels) == 1:
            joined = labels[0]
        elif len(labels) == 2:
            joined = f"{labels[0]} و{labels[1]}"
        else:
            joined = "، ".join(labels[:-1]) + f" و{labels[-1]}"
        return t("form_missing_fields_prompt", reply_lang, fields=joined)
    else:
        if len(labels) == 1:
            joined = labels[0]
        elif len(labels) == 2:
            joined = f"{labels[0]} and {labels[1]}"
        else:
            joined = ", ".join(labels[:-1]) + f", and {labels[-1]}"
        return t("form_missing_fields_prompt", reply_lang, fields=joined)


def _convert_dom_nodes_to_dicts(dom_nodes: List[Union[DomNode, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Normalizes a list of DomNode instances or dicts into uniform dict representations."""
    raw_nodes: List[Dict[str, Any]] = []
    for node in dom_nodes:
        if hasattr(node, "model_dump"):
            raw_nodes.append(node.model_dump())
        elif hasattr(node, "dict"):
            raw_nodes.append(node.dict())
        elif isinstance(node, dict):
            raw_nodes.append(dict(node))
        else:
            raw_nodes.append(vars(node))
    return raw_nodes


async def plan_form_fill(
    form_id: str,
    dom_nodes: List[Union[DomNode, Dict[str, Any]]],
    goal: str,
    profile_hints: Optional[List[str]] = None,
    prior_errors: Optional[Dict[str, str]] = None,
    language: Optional[str] = None,
    wrong_controls: Optional[List[Any]] = None,
) -> FormPlan:
    """
    Produces a complete FormPlan for the specified form.
    Guarantees privacy constraints and never auto-consents to terms.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_nodes)
    # L7: Modal scoping: if any node has in_modal: True, only consider in_modal nodes until modal closes
    if any(bool(n.get("in_modal")) for n in raw_nodes):
        raw_nodes = [n for n in raw_nodes if bool(n.get("in_modal"))]

    has_form_id_match = bool(form_id and any(str(n.get("form_id") or "") == str(form_id) for n in raw_nodes))
    target_nodes = [n for n in raw_nodes if str(n.get("form_id") or "") == str(form_id)] if has_form_id_match else raw_nodes

    # Auth wall protection: auth-wall forms never go to form filler
    auth_wall = classify_auth_wall(target_nodes) or classify_auth_wall(raw_nodes)
    if auth_wall:
        is_modal = any(bool(n.get("in_modal")) for n in raw_nodes)
        is_auth_goal = matches_any_keyword((goal or "").lower(), AUTH_KEYWORDS)
        if is_modal or not is_auth_goal:
            return FormPlan(form_id=form_id or "", fields=[], submit_ref=None, missing_required=[], blockers=["auth_wall"])

    profile_keys = profile_hints or []
    valid_refs: Dict[str, Dict[str, Any]] = {}
    consent_refs: Set[str] = set()

    # Scope candidates to target form
    last_input_idx = -1
    for idx, n in enumerate(raw_nodes):
        tag = (n.get("tag") or "").lower()
        ntype = (n.get("type") or "").lower()
        role = (n.get("role") or "").lower()
        if (tag in ("input", "select", "textarea") or role in ("textbox", "combobox")) and ntype not in ("submit", "hidden", "button", "reset"):
            if not has_form_id_match or str(n.get("form_id") or "") == str(form_id):
                last_input_idx = idx

    submit_candidate_nodes: List[Dict[str, Any]] = []

    for idx, n in enumerate(raw_nodes):
        ref = n.get("ref") or n.get("id")
        if not ref:
            continue

        tag = (n.get("tag") or "").lower()
        node_type = (n.get("type") or "").lower()
        role = (n.get("role") or "").lower()

        is_control = (
            tag in ("input", "select", "textarea")
            or role in ("textbox", "combobox", "searchbox", "spinbutton", "slider", "checkbox", "radio", "listbox")
        )

        is_potential_submit = (
            not is_control
            and (tag == "button" or node_type in ("button", "submit") or role in ("button", "submit"))
        )

        if is_potential_submit:
            # Check exclusions and backwards-nav wrong controls
            if not _is_excluded_submit_candidate(n) and not _is_control_wrong(n, wrong_controls):
                # Scope check
                if has_form_id_match:
                    if str(n.get("form_id") or "") == str(form_id):
                        submit_candidate_nodes.append(n)
                else:
                    # No form tag: must be after the last target input in DOM order before next heading
                    if last_input_idx >= 0 and idx > last_input_idx:
                        # Check if any heading occurs between last_input_idx and idx
                        has_heading_between = any(
                            (raw_nodes[h_idx].get("tag") or "").lower() in ("h1", "h2", "h3", "h4", "h5", "h6")
                            or (raw_nodes[h_idx].get("role") or "").lower() == "heading"
                            for h_idx in range(last_input_idx + 1, idx)
                        )
                        if not has_heading_between:
                            submit_candidate_nodes.append(n)
                    elif last_input_idx < 0:
                        submit_candidate_nodes.append(n)

        if not (is_control or is_potential_submit or n.get("required")):
            continue

        valid_refs[ref] = n

        # Identify terms/consent checkboxes
        if _is_consent_checkbox(n):
            consent_refs.add(ref)

    # Sort submit candidates by heuristic score
    submit_candidate_nodes.sort(key=lambda node: _score_submit_candidate(node), reverse=True)
    submit_candidates = [str(n.get("ref") or n.get("id")) for n in submit_candidate_nodes]

    # Prepare sanitized inventory for LLM
    form_inventory = []
    for ref, n in valid_refs.items():
        opts = []
        if n.get("options"):
            opts = [{"value": o.get("value") if isinstance(o, dict) else o.value, "label": o.get("label") if isinstance(o, dict) else o.label} for o in n["options"][:20]]

        form_inventory.append({
            "ref": ref,
            "tag": n.get("tag"),
            "type": n.get("type"),
            "name": n.get("name"),
            "role": n.get("role"),
            "label": n.get("resolved_label") or n.get("aria_label"),
            "required": bool(n.get("required")),
            "sensitive": bool(n.get("sensitive")),
            "options": opts if opts else None,
            "error_text": n.get("error_text"),
        })

    inventory_json = json.dumps(form_inventory, indent=2)
    nonce = secrets.token_hex(8)

    reply_lang = resolve_reply_language(language, goal)
    lang_context = f"\nREQUESTED USER LANGUAGE: {language}" if language else ""

    user_body = f"""USER GOAL:
"{goal}"{lang_context}
REPLY LANGUAGE: {reply_lang}

TARGET FORM ID:
"{form_id}"

AVAILABLE USER PROFILE KEYS (HINTS ONLY, NO REAL VALUES):
{json.dumps(profile_keys)}

PRIOR VALIDATION ERRORS:
{json.dumps(prior_errors or {})}

--- BEGIN UNTRUSTED FORM INVENTORY (BOUNDARY_ID: {nonce}) ---
{inventory_json}
--- END UNTRUSTED FORM INVENTORY (BOUNDARY_ID: {nonce}) ---

FORM PLAN JSON:"""

    raw_fields: List[Dict[str, Any]] = []
    submit_ref = submit_candidates[0] if submit_candidates else None
    missing_required: Set[str] = set(consent_refs)
    blockers: List[str] = []

    try:
        raw_llm = await llm_client.call_llm(
            user_prompt=user_body,
            system_prompt=FORM_FILLER_SYSTEM_PROMPT,
            role="form_filler",
        )
        cleaned = _clean_json_str(raw_llm)
        parsed = json.loads(cleaned)

        raw_fields = parsed.get("fields", [])
        candidate_set = set(submit_candidates)
        llm_sub = parsed.get("submit_ref")
        if llm_sub and str(llm_sub) in candidate_set:
            submit_ref = str(llm_sub)

        for r in parsed.get("missing_required", []):
            if r in valid_refs:
                missing_required.add(r)

        blockers = list(parsed.get("blockers") or [])

    except Exception as exc:
        logger.warning("Form Filler LLM call or JSON parsing failed: %s. Using heuristic plan.", exc)

    # Post-processing and safety rail enforcement
    sanitized_fields: List[FieldPlan] = []
    for f in raw_fields:
        ref = f.get("ref")
        if not ref or ref not in valid_refs:
            continue

        # RULE 6: submit_ref NEVER appears inside fields[]
        if ref == submit_ref or ref in submit_candidates:
            continue

        # RULE 3: Terms and consent checkboxes are NEVER auto-checked by the agent
        if ref in consent_refs:
            missing_required.add(ref)
            continue

        node = valid_refs[ref]
        val = f.get("value")
        action = f.get("action", "fill")
        source = f.get("source", "user")

        # RULE 3 (Privacy): Sensitive fields get vault or profile tokens, never literal passwords
        is_sensitive = bool(node.get("sensitive") or _is_sensitive_field(node))
        if is_sensitive:
            if not (isinstance(val, str) and TOKEN_REGEX.match(val)):
                val = "{password}" if (node.get("type") == "password" or "pass" in str(node.get("name", "")).lower()) else "{secret}"
                source = "vault"

        # RULE 5: Check if required field lacks value or was fabricated without profile hint
        if node.get("required") and not val:
            missing_required.add(ref)
            continue

        # Personal data protection: If field asks for date of birth and no DOB hint, do not fabricate
        combined_label = f"{node.get('name', '')} {node.get('resolved_label', '')}".lower()
        if ("birth" in combined_label or "dob" in combined_label) and "date_of_birth" not in profile_keys and "dob" not in profile_keys:
            if node.get("required"):
                missing_required.add(ref)
                continue

        sanitized_fields.append(
            FieldPlan(
                ref=ref,
                action=action,
                value=str(val) if val is not None else None,
                source=source if source in {"profile", "user", "generated", "default", "vault"} else "user",
                confidence=float(f.get("confidence", 1.0)),
                rationale=f.get("rationale"),
            )
        )

    # Ensure all consent checkboxes are surfaced in missing_required
    for cr in consent_refs:
        if valid_refs[cr].get("required"):
            missing_required.add(cr)

    # Ensure all required fields from DOM that have no assigned value are surfaced in missing_required
    dom_required = extract_required_form_fields(dom_nodes)
    field_refs_with_values = {f.ref for f in sanitized_fields if f.value}
    for req_field in dom_required:
        if req_field.ref not in field_refs_with_values:
            missing_required.add(req_field.ref)

    return FormPlan(
        form_id=form_id,
        fields=sanitized_fields,
        submit_ref=submit_ref,
        missing_required=list(missing_required),
        blockers=blockers,
    )

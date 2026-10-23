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
from typing import Any, Dict, List, Optional, Set, Union

from app.agent import llm_client
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
    r"^\{(?:vault:[a-zA-Z0-9_]+|password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret|national_id|profile\.[a-z0-9_]+)(?:_\d+)?\}$"
)
TOKEN_FIND_REGEX = re.compile(
    r"\{(?:vault:[a-zA-Z0-9_]+|password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret|national_id|profile\.[a-z0-9_]+)(?:_\d+)?\}"
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


def extract_required_form_fields(
    dom_nodes: List[Union[DomNode, Dict[str, Any]]]
) -> List[InputField]:
    """
    Universally discovers required form inputs from dom_nodes.
    Stateless: recomputed from the live DOM on every hop.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_nodes)
    required_fields: List[InputField] = []

    for n in raw_nodes:
        ref = n.get("ref") or n.get("id")
        if not ref:
            continue

        tag = (n.get("tag") or "").lower()
        node_type = (n.get("type") or "").lower()

        if node_type in ("submit", "hidden") or tag == "button":
            continue

        is_req = bool(n.get("required") or n.get("aria_required") in (True, "true"))
        if not is_req:
            continue

        if _is_consent_checkbox(n):
            continue

        label = (
            n.get("resolved_label")
            or n.get("aria_label")
            or n.get("inner_text")
            or n.get("placeholder")
            or n.get("name")
            or ref
        )
        label = re.sub(r"\s*\*+$", "", str(label)).strip()

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

        required_fields.append(
            InputField(
                ref=ref,
                label=label,
                kind=kind,
                sensitive=sensitive,
                pattern=str(pattern) if pattern else None,
                maxlength=int(maxlength) if maxlength is not None else None,
                required=True,
                options=opts,
            )
        )

    return required_fields


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
) -> FormPlan:
    """
    Produces a complete FormPlan for the specified form.
    Guarantees privacy constraints and never auto-consents to terms.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_nodes)
    profile_keys = profile_hints or []
    valid_refs: Dict[str, Dict[str, Any]] = {}
    submit_candidates: List[str] = []
    consent_refs: Set[str] = set()

    for n in raw_nodes:
        ref = n.get("ref") or n.get("id")
        if not ref:
            continue
        valid_refs[ref] = n

        # Identify submit buttons
        tag = (n.get("tag") or "").lower()
        node_type = (n.get("type") or "").lower()
        if node_type == "submit" or (tag == "button" and ("submit" in (n.get("resolved_label", "") or "").lower() or "register" in (n.get("resolved_label", "") or "").lower() or "sign up" in (n.get("resolved_label", "") or "").lower() or "complete" in (n.get("resolved_label", "") or "").lower())):
            submit_candidates.append(ref)

        # Identify terms/consent checkboxes
        if _is_consent_checkbox(n):
            consent_refs.add(ref)

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
        if parsed.get("submit_ref") and parsed.get("submit_ref") in valid_refs:
            submit_ref = parsed.get("submit_ref")

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
        if node.get("sensitive"):
            if not (isinstance(val, str) and val.startswith("{") and val.endswith("}")):
                val = "{password}"
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

    return FormPlan(
        form_id=form_id,
        fields=sanitized_fields,
        submit_ref=submit_ref,
        missing_required=list(missing_required),
        blockers=blockers,
    )

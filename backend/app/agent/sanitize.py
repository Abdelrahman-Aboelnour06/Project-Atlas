import copy
import re
from typing import List, Dict, Any, Tuple

MAX_TEXT_LENGTH = 200

# Server-side defense-in-depth patterns.
# NOTE: This is a fallback safety net for client-side tokenization bugs, NOT the
# primary control. Client-side tokenization (secret-vault.js) is authoritative.
SSN_REGEX = re.compile(r'\b\d{3}-?\d{2}-?\d{4}\b')
CARD_CANDIDATE_REGEX = re.compile(r'\b(?:\d[ -]*?){13,19}\b')
PASSWORD_VERBATIM_REGEX = re.compile(
    r'(?i)\b(?:fill\s+in|type\s+in|fill|enter|type|input|set|put|my)?\s*(?:the\s+)?(password|passwd|pass|credit[-_ ]?card|card[-_ ]?number|card|cvv|cvc|csc|pin|ssn|social|otp|2fa|mfa|expir\w*|secret|token)\s*(?:\b(?:with|to|as|is)\b|[:=])\s*([^\s,;]+)'
)
TOKEN_CHECK_REGEX = re.compile(r'^\{(?:password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret)(?:_\d+)?\}$')
REDACTED_CHECK_REGEX = re.compile(r'^\[REDACTED_[A-Z0-9_]+\]$')


def is_luhn_valid(number_str: str) -> bool:
    """Verifies Luhn checksum for 13-19 digit candidate credit card numbers."""
    digits = [int(c) for c in number_str if c.isdigit()]
    if not (13 <= len(digits) <= 19):
        return False
    checksum = 0
    reverse_digits = digits[::-1]
    for i, d in enumerate(reverse_digits):
        if i % 2 == 1:
            doubled = d * 2
            checksum += doubled - 9 if doubled > 9 else doubled
        else:
            checksum += d
    return checksum % 10 == 0


def scan_for_raw_secrets(command: str) -> List[Dict[str, Any]]:
    """
    Scans incoming command text for high-confidence raw-secret patterns:
      1. Luhn-valid 13-19 digit credit card sequences.
      2. SSN-shaped digit sequences (\\d{3}-?\\d{2}-?\\d{4}).
      3. Verbatim password/PIN/CVV/OTP/Expiry typed after sensitive keywords.

    Returns a list of dicts with 'category', 'start', and 'end'.
    SECURITY INVARIANT: The matched secret value is NEVER returned in the output.
    """
    if not command or not isinstance(command, str):
        return []

    hits: List[Dict[str, Any]] = []
    occupied_spans: List[Tuple[int, int]] = []

    def spans_overlap(start: int, end: int) -> bool:
        return any(max(start, o_start) < min(end, o_end) for o_start, o_end in occupied_spans)

    # 1. Credit card candidates (Luhn-checked)
    for m in CARD_CANDIDATE_REGEX.finditer(command):
        matched_str = m.group(0)
        digits_only = re.sub(r'\D', '', matched_str)
        if 13 <= len(digits_only) <= 19 and is_luhn_valid(digits_only):
            start, end = m.span()
            if not spans_overlap(start, end):
                hits.append({"category": "cc_number", "start": start, "end": end})
                occupied_spans.append((start, end))

    # 2. SSN candidates
    for m in SSN_REGEX.finditer(command):
        start, end = m.span()
        if not spans_overlap(start, end):
            hits.append({"category": "ssn", "start": start, "end": end})
            occupied_spans.append((start, end))

    # 3. Verbatim passwords / PINs / OTPs / Expiry after sensitive keywords
    for m in PASSWORD_VERBATIM_REGEX.finditer(command):
        keyword = m.group(1).lower()
        val = m.group(2)
        # Skip if already tokenized ({password}) or previously redacted ([REDACTED_...])
        if TOKEN_CHECK_REGEX.match(val) or REDACTED_CHECK_REGEX.match(val):
            continue

        val_start, val_end = m.span(2)
        if not spans_overlap(val_start, val_end):
            category = "password"
            if any(k in keyword for k in ("cvv", "cvc", "csc")):
                category = "cc_cvv"
            elif "pin" in keyword:
                category = "pin"
            elif "exp" in keyword:
                category = "cc_expiry"
            elif "ssn" in keyword or "social" in keyword:
                category = "ssn"
            elif any(k in keyword for k in ("otp", "2fa", "mfa")):
                category = "otp"
            elif "card" in keyword:
                category = "cc_number"
            elif "secret" in keyword or "token" in keyword:
                category = "secret"

            hits.append({"category": category, "start": val_start, "end": val_end})
            occupied_spans.append((val_start, val_end))

    # Sort hits by start position
    hits.sort(key=lambda h: h["start"])
    return hits


def redact_raw_secrets(command: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Finds raw secrets in the command string and replaces each matched span with
    [REDACTED_{category}]. Returns the sanitized command and the list of detected hits.
    """
    if not command or not isinstance(command, str):
        return command, []

    hits = scan_for_raw_secrets(command)
    if not hits:
        return command, []

    # Replace from right to left so earlier indices remain valid
    sanitized = command
    for hit in sorted(hits, key=lambda h: h["start"], reverse=True):
        cat = hit["category"]
        replacement = f"[REDACTED_{cat}]"
        sanitized = sanitized[:hit["start"]] + replacement + sanitized[hit["end"]:]

    return sanitized, hits


def strip_pii_from_dom(dom_map: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Creates a safe copy of the DOM map, completely masking sensitive user inputs
    before they are sent to the LLM or logged in the database.
    """
    # Create a shallow copy per node so we don't freeze the event loop with deepcopy
    safe_dom = [dict(node) for node in dom_map]
    
    # Define triggers that indicate a field is handling sensitive data
    sensitive_types = {'password', 'email', 'tel', 'number', 'credit-card'}
    sensitive_keywords = ['card', 'cvv', 'ssn', 'password', 'phone', 'email']

    for node in safe_dom:
        node_tag = str(node.get('tag', '')).lower()
        node_type = str(node.get('type', '')).lower()
        node_id = str(node.get('id', '')).lower()
        node_name = str(node.get('name', '')).lower()

        # Flag 1: Is the HTML type explicitly sensitive?
        # Flag 2: Does the ID or Name contain a sensitive keyword?
        # Flag 3: Is it explicitly flagged sensitive by client-side detector?
        is_sensitive = (
            bool(node.get('sensitive')) or
            node_type in sensitive_types or
            any(kw in node_id for kw in sensitive_keywords) or
            any(kw in node_name for kw in sensitive_keywords)
        )

        # If it is an input field, we must scrub any typed content
        if is_sensitive or node_tag == 'input':
            # If the user typed something into 'inner_text', nuke it.
            if node.get('inner_text'):
                node['inner_text'] = '[REDACTED_PII]'
            
            # Note: We LEAVE the 'placeholder' and 'aria_label' alone 
            # because the LLM needs those to know what the button/field actually does.
        for field in ('inner_text', 'placeholder', 'aria_label', 'resolved_label', 'group_label'):
            if field in node and isinstance(node[field], str):
                node[field] = node[field][:MAX_TEXT_LENGTH]

    return safe_dom


def trim_log_payload(command: str, action_response: dict) -> dict:
    """
    Trims the massive data chunks so we don't overload the PostgreSQL DB 
    or store unnecessary user activity history. Enforces secret redaction on command.
    """
    safe_command, _ = redact_raw_secrets(command) if command else ("", [])
    return {
        "command_snippet": safe_command[:100] + "..." if len(safe_command) > 100 else safe_command,
        "resolved_action": action_response.get("action") if isinstance(action_response, dict) else None,
        "target_element": action_response.get("element_id") if isinstance(action_response, dict) else None,
        "status": action_response.get("status") if isinstance(action_response, dict) else None
    }

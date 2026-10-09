"""
Page Scout Agent
backend/app/agent/scout.py

Rapid page classification and blocker detection on newly-loaded pages.
Classifies page_kind: "form", "list", "article", "auth_wall", "captcha", "confirmation", "other".
Detects blockers: "captcha", "otp", "auth_wall".
Extracts form inventory and primary CTA.
Complies with Project Atlas Universal Rule: 100% universal across all websites, zero domain hardcoding.
"""

import json
import logging
import re
import secrets
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field

from app.agent import llm_client
from app.agent.jev_client import get_jev_client
from app.models.dom import DomNode

logger = logging.getLogger(__name__)

PageKind = Literal[
    "form",
    "list",
    "article",
    "auth_wall",
    "captcha",
    "confirmation",
    "other",
]


LANGUAGE_MIRRORING_DIRECTIVE = (
    "Reply in the same language the user is using. If language is an Arabic locale (e.g. 'ar-EG'), "
    "reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. "
    "If unset, infer from script. If mixed, mirror the mix."
)


class ScoutResult(BaseModel):
    """Classification assessment of the current webpage."""
    page_kind: PageKind = Field(default="other", description="High-level category of page")
    blockers: List[str] = Field(default_factory=list, description="Active blockers: 'captcha', 'otp', 'auth_wall'")
    form_inventory: List[str] = Field(default_factory=list, description="IDs or labels of forms detected on page")
    primary_cta: Optional[str] = Field(default=None, description="Element ID/ref of primary call-to-action button")
    summary: Optional[str] = Field(default=None, description="Concise description of page contents")
    detected_language: Optional[str] = Field(default=None, description="Detected page language code, e.g. 'ar' or 'en'")


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


def _convert_dom_nodes_to_dicts(dom_map: List[Union[DomNode, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Normalizes a list of DomNode instances or dicts into uniform dict representations."""
    raw_nodes: List[Dict[str, Any]] = []
    for node in dom_map:
        if hasattr(node, "model_dump"):
            raw_nodes.append(node.model_dump())
        elif hasattr(node, "dict"):
            raw_nodes.append(node.dict())
        elif isinstance(node, dict):
            raw_nodes.append(dict(node))
        else:
            raw_nodes.append(vars(node))
    return raw_nodes


def _analyze_dom_heuristics(
    dom_nodes: List[Dict[str, Any]],
    current_url: Optional[str],
    page_text: Optional[str],
) -> ScoutResult:
    """Universal heuristic fallback classification when LLM is unavailable or malformed."""
    blockers: List[str] = []
    form_inventory_set = set()
    input_count = 0
    primary_cta = None

    url_lower = (current_url or "").lower()
    text_lower = (page_text or "").lower()

    # 1. Blocker detection: CAPTCHA / bot challenge
    captcha_pattern = re.compile(r"recaptcha|hcaptcha|turnstile|cf-turnstile|bot challenge|robot|captcha", re.I)
    for n in dom_nodes:
        combined = f"{n.get('id', '')} {n.get('aria_label', '')} {n.get('inner_text', '')} {n.get('resolved_label', '')}"
        if captcha_pattern.search(combined):
            if "captcha" not in blockers:
                blockers.append("captcha")

    if captcha_pattern.search(text_lower) and ("robot" in text_lower or "human" in text_lower or "challenge" in text_lower):
        if "captcha" not in blockers:
            blockers.append("captcha")

    # 2. Blocker detection: OTP / Two-factor
    otp_pattern = re.compile(r"one-time-code|two-step|verification code|\botp\b|security code", re.I)
    for n in dom_nodes:
        combined = f"{n.get('autocomplete', '')} {n.get('name', '')} {n.get('resolved_label', '')}"
        if otp_pattern.search(combined):
            if "otp" not in blockers:
                blockers.append("otp")

    # 3. Form inventory and field analysis
    for n in dom_nodes:
        tag = (n.get("tag") or "").lower()
        node_type = (n.get("type") or "").lower()
        form_id = n.get("form_id")

        if form_id:
            form_inventory_set.add(form_id)

        if tag in {"input", "select", "textarea"} and node_type != "hidden":
            input_count += 1

        if tag == "button" or node_type == "submit":
            if not primary_cta:
                primary_cta = n.get("id") or n.get("ref")

    form_inventory = list(form_inventory_set)
    if not form_inventory and input_count >= 2:
        form_inventory = ["form-default"]

    # 4. Determine page kind
    if "captcha" in blockers:
        page_kind: PageKind = "captcha"
    elif "otp" in blockers:
        page_kind = "form"
    elif re.search(r"welcome|signed in|order confirmed|thank you|registration complete", text_lower):
        page_kind = "confirmation"
    elif input_count >= 2 or len(form_inventory) > 0:
        page_kind = "form"
    elif "login" in url_lower or "sign-in" in url_lower or "signin" in url_lower:
        page_kind = "auth_wall" if input_count == 0 else "form"
    else:
        page_kind = "other"

    # 5. Language detection heuristic
    detected_lang: Optional[str] = None
    sample_text = f"{page_text or ''} {' '.join(str(n.get('resolved_label') or n.get('aria_label') or n.get('inner_text') or '') for n in dom_nodes)}"
    if sample_text.strip():
        arabic_chars = len(re.findall(r"[\u0600-\u06FF]", sample_text))
        total_letters = len(re.findall(r"[a-zA-Z\u0600-\u06FF]", sample_text))
        if total_letters > 0 and (arabic_chars / total_letters) > 0.15:
            detected_lang = "ar"
        elif total_letters > 0:
            detected_lang = "en"

    return ScoutResult(
        page_kind=page_kind,
        blockers=blockers,
        form_inventory=form_inventory,
        primary_cta=primary_cta,
        summary=f"Heuristic classification: {page_kind} with {len(form_inventory)} form(s)",
        detected_language=detected_lang,
    )


SCOUT_SYSTEM_PROMPT = """You are Atlas Scout, an intelligent AI accessibility scout.
Your job is to analyze webpage content and interactive elements to provide rapid classification.

CATEGORIES FOR page_kind:
- "form": Page contains an interactive form (signup, login, survey, checkout, settings inputs).
- "list": Directory, search results table, catalog, file listing, or card grid.
- "article": Reading content, blog post, document, news, or knowledge base article.
- "auth_wall": Login gate or paywall blocking access to content.
- "captcha": Bot challenge, Cloudflare verification, or CAPTCHA blocking navigation.
- "confirmation": Post-action success screen ("Welcome, you're signed in", "Order confirmed", "Payment received").
- "other": Generic homepages or uncategorized navigation interfaces.

BLOCKER DETECTION:
Identify if any of these active blockers prevent automated progress:
- "captcha": Requires human CAPTCHA solving.
- "otp": Requires human SMS/email one-time verification code.
- "auth_wall": Requires human account authentication.

LANGUAGE MIRRORING:
Reply in the same language the user is using. If language is an Arabic locale (e.g. 'ar-EG'), reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. If unset, infer from script. If mixed, mirror the mix.

RESPONSE JSON SCHEMA:
{
  "page_kind": "form" | "list" | "article" | "auth_wall" | "captcha" | "confirmation" | "other",
  "blockers": ["captcha", "otp", "auth_wall"],
  "form_inventory": ["form_id_1", "form_id_2"],
  "primary_cta": "element_id_or_ref",
  "summary": "Brief summary of page and key interactive components",
  "detected_language": "ar" | "en" | null
}"""


async def classify_page(
    current_url: Optional[str],
    dom_map: List[Union[DomNode, Dict[str, Any]]],
    page_text: Optional[str] = None,
    language: Optional[str] = None,
) -> ScoutResult:
    """
    Classifies the page kind, identifies blockers, and collects form inventory.
    Runs concurrently with the Verifier during the perception fan-out.
    """
    raw_nodes = _convert_dom_nodes_to_dicts(dom_map)
    heuristic_fallback = _analyze_dom_heuristics(raw_nodes, current_url, page_text)

    # If heuristic already finds a clear CAPTCHA blocker, we can respect it immediately
    if "captcha" in heuristic_fallback.blockers:
        return heuristic_fallback

    # Build concise representation for LLM (capped to top 15 nodes, compact serialization)
    concise_dom = []
    for n in raw_nodes[:15]:
        lbl = (n.get("resolved_label") or n.get("aria_label") or n.get("inner_text") or "")[:50]
        node_dict = {
            "id": n.get("id") or n.get("ref"),
            "tag": n.get("tag"),
            "role": n.get("role"),
            "type": n.get("type"),
        }
        if lbl:
            node_dict["label"] = lbl
        if n.get("form_id"):
            node_dict["form_id"] = n.get("form_id")
        concise_dom.append(node_dict)

    dom_json = json.dumps(concise_dom, separators=(',', ':'))
    summary_nonce = secrets.token_hex(6)
    dom_nonce = secrets.token_hex(6)

    lang_context = f"\nREQUESTED USER LANGUAGE: {language}" if language else ""

    user_body = f"""PAGE CONTEXT:
URL: {current_url or "Unknown"}{lang_context}

--- BEGIN UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---
{(page_text or "").strip()[:350] if page_text else "No page summary available"}
--- END UNTRUSTED WEBPAGE SUMMARY (BOUNDARY_ID: {summary_nonce}) ---

--- BEGIN UNTRUSTED DOM ELEMENTS (BOUNDARY_ID: {dom_nonce}) ---
{dom_json}
--- END UNTRUSTED DOM ELEMENTS (BOUNDARY_ID: {dom_nonce}) ---

JSON CLASSIFICATION:"""

    try:
        raw_llm = await llm_client.call_llm(
            user_prompt=user_body,
            system_prompt=SCOUT_SYSTEM_PROMPT,
            role="scout",
        )
        cleaned = _clean_json_str(raw_llm)
        parsed = json.loads(cleaned)

        page_kind = str(parsed.get("page_kind", "other")).lower()
        if page_kind not in {"form", "list", "article", "auth_wall", "captcha", "confirmation", "other"}:
            page_kind = heuristic_fallback.page_kind

        blockers = list(parsed.get("blockers") or [])
        # Merge any heuristic-detected blockers
        for b in heuristic_fallback.blockers:
            if b not in blockers:
                blockers.append(b)

        forms = list(parsed.get("form_inventory") or heuristic_fallback.form_inventory)
        primary_cta = parsed.get("primary_cta") or heuristic_fallback.primary_cta
        summary = parsed.get("summary") or heuristic_fallback.summary
        detected_language = parsed.get("detected_language") or heuristic_fallback.detected_language

        return ScoutResult(
            page_kind=page_kind,  # type: ignore
            blockers=blockers,
            form_inventory=forms,
            primary_cta=primary_cta,
            summary=summary,
            detected_language=detected_language,
        )

    except Exception as exc:
        logger.warning("Scout LLM classification failed: %s. Using Jev 3/heuristic fallback.", exc)
        try:
            jev = get_jev_client()
            judge_res = await jev.judge(
                state={"url": current_url, "dom_count": len(raw_nodes), "text": (page_text or "")[:200]},
                statement="The page contains a captcha, turnstile, or bot challenge",
            )
            if judge_res.result and judge_res.confidence >= 0.85:
                heuristic_fallback.page_kind = "captcha"
                if "captcha" not in heuristic_fallback.blockers:
                    heuristic_fallback.blockers.append("captcha")
        except Exception:
            pass
        return heuristic_fallback

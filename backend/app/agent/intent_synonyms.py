"""
Bilingual Intent Canonicalization Module (§Track N2a)
backend/app/agent/intent_synonyms.py

Provides semantic canonicalization of high-frequency user actions across
English, Modern Standard Arabic (MSA), and Egyptian Colloquial Arabic (العامية المصرية).
Maps diverse natural language phrasings into universal canonical intent keys
and resolves them against interactive DOM elements without website-specific hacks.
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple


# Arabic character mapping tables for Unicode normalization and folding (§Track N1)
_ARABIC_DIGITS_TRANS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789"
)
_ARABIC_FOLD_TRANS = str.maketrans({
    "أ": "ا",
    "إ": "ا",
    "آ": "ا",
    "ٱ": "ا",
    "ى": "ي",
    "ة": "ه",
    "ؤ": "و",
    "ئ": "ي",
})


def _normalize_text(s: str) -> str:
    """
    Universal alphanumeric and Arabic normalization:
    - Unicode NFKC normalization
    - Arabic-Indic & Persian digit conversion (٠-٩ / ۰-۹ -> 0-9)
    - Stripping tashkeel (diacritics) and tatweel (kashida) [\\u064B-\\u065F\\u0670\\u0640]
    - Arabic letter folding (أ/إ/آ/ٱ -> ا, ى -> ي, ة -> ه, ؤ -> و, ئ -> ي)
    - Lowercase Latin characters
    - Preserves standard alphanumeric Latin and Arabic base letters
    """
    if not s or not isinstance(s, str):
        return ""
    norm = unicodedata.normalize("NFKC", s)
    norm = norm.translate(_ARABIC_DIGITS_TRANS)
    norm = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", norm)
    norm = norm.translate(_ARABIC_FOLD_TRANS)
    norm = norm.lower()
    return re.sub(r"[^a-z0-9\u0621-\u064A]", "", norm)


# 4 Core Canonical Intents mapping English, MSA, and Egyptian Colloquial Arabic
CANONICAL_INTENTS: Dict[str, Dict[str, List[str]]] = {
    "add_to_cart": {
        "triggers": [
            # English
            "add to cart", "add to basket", "add to bag", "buy now", "purchase",
            "buy this", "order now", "put in cart", "add item to cart", "add this to cart",
            "place order", "buy it",
            # MSA (Modern Standard Arabic)
            "أضف إلى السلة", "اضف الى السلة", "أضف للسلة", "اضف للسلة", "أضف للسله", "اضف للسله",
            "إضافة إلى السلة", "اضافة الى السلة", "إضافة للسلة", "اضافة للسلة",
            "أضف إلى عربة التسوق", "اضف الى عربة التسوق", "عربة التسوق",
            "شراء الآن", "شراء الان", "شراء هذا", "اشتري هذا", "اشتر الان", "اشتري الان",
            # Egyptian Colloquial Arabic (اللهجة المصرية)
            "اشتريلي الحاجه دي", "اشتريلي الحاجة دي", "اشتريلي ده", "اشتريلي دي", "اشتريلي دا",
            "اشتريلي", "اشتري دا", "اشتري دي", "اشتري ده", "اشترى", "اشتري",
            "حط في السلة", "حط في السله", "حط في العربة", "حط في العربيه",
            "حطه في السلة", "حطه في السله", "حطها في السلة", "حطها في السله",
            "ضيف في السلة", "ضيف في السله", "ضيف للسلة", "ضيف للسله",
            "عايز اشتري", "عاوز اشتري", "عايز اشتري ده", "عاوز اشتري ده",
            "هات الحاجه دي", "هات الحاجة دي", "هات دي", "هات ده",
        ],
        "dom_labels": [
            # English
            "add to cart", "add to basket", "add to bag", "buy now", "purchase",
            "order now", "add", "checkout", "buy",
            # Arabic
            "أضف إلى السلة", "اضف الى السلة", "أضف للسلة", "اضف للسله", "إضافة إلى السلة",
            "اضافة الى السلة", "إضافة للسلة", "اضافة للسله", "أضف إلى عربة التسوق",
            "اضف الى عربة التسوق", "عربة التسوق", "السلة", "السله", "شراء الآن", "شراء الان",
            "شراء", "اشتري الآن", "اشتري الان",
        ],
    },
    "search": {
        "triggers": [
            # English
            "search", "find", "look for", "search for", "query", "seek", "locate",
            # MSA
            "ابحث", "بحث", "ابحث عن", "البحث عن", "فتش عن",
            # Egyptian Colloquial
            "دور على", "دور علي", "دورلي على", "دورلي علي", "ابحثلي عن", "شوفلي",
            "عايز ابحث", "عاوز ادور", "هاتلي نتائج",
        ],
        "dom_labels": [
            # English
            "search", "search products", "search store", "find", "query", "go",
            # Arabic
            "بحث", "ابحث", "ابحث هنا", "بحث في الموقع", "بحث عن المنتجات",
        ],
    },
    "go_home": {
        "triggers": [
            # English
            "go home", "home", "homepage", "go to home", "back to home", "main page",
            "navigate to home", "return home",
            # MSA
            "الصفحة الرئيسية", "الصفحه الرئيسيه", "الرئيسية", "الرئيسيه",
            "الذهاب إلى الرئيسية", "الذهاب للرئيسية", "الذهاب للرئيسيه",
            "العودة للرئيسية", "العوده للرئيسيه", "الصفحة الأولى", "الصفحه الاولي",
            # Egyptian Colloquial
            "روح للرئيسية", "روح للرئيسيه", "وديني الرئيسية", "وديني الرئيسيه",
            "ارجع للرئيسية", "ارجع للرئيسيه", "افتح الرئيسية", "افتح الرئيسيه",
            "روح على الصفحة الرئيسية", "روح علي الصفحه الرئيسيه",
        ],
        "dom_labels": [
            # English
            "home", "homepage", "main page", "back to home", "logo",
            # Arabic
            "الرئيسية", "الرئيسيه", "الصفحة الرئيسية", "الصفحه الرئيسيه",
            "الصفحة الأولى", "الصفحه الاولي", "البداية", "البدايه",
        ],
    },
    "subscribe": {
        "triggers": [
            # English
            "subscribe", "sign up", "join", "newsletter", "follow", "subscription",
            "subscribe to newsletter",
            # MSA
            "اشتراك", "اشترك", "انضم", "متابعة", "متابعه", "تسجيل اشتراك",
            "النشرة الإخبارية", "النشره الاخباريه", "النشرة البريدية", "النشره البريديه",
            # Egyptian Colloquial
            "دوس على اشتراك", "دوس علي اشتراك", "اشترك دلوقتي", "سجل اشتراك",
            "اعمل اشتراك", "عايز اشترك", "عاوز اشترك", "اشترك في النشرة",
        ],
        "dom_labels": [
            # English
            "subscribe", "sign up", "join", "newsletter", "follow",
            # Arabic
            "اشتراك", "اشترك", "انضم", "متابعة", "متابعه", "تسجيل اشتراك",
            "النشرة البريدية", "النشره البريديه", "النشرة الإخبارية", "النشره الاخباريه",
        ],
    },
}


def canonicalize_intent(user_message: str) -> Optional[str]:
    """
    Map raw natural language user messages (English, MSA, or Egyptian colloquial)
    to a canonical intent key: 'add_to_cart', 'search', 'go_home', or 'subscribe'.

    Returns:
        str: Canonical intent key if matched, or None if no match.
    """
    if not user_message or not isinstance(user_message, str):
        return None

    clean_user = _normalize_text(user_message)
    if not clean_user:
        return None

    # 1. Exact match against normalized trigger phrases
    for intent_key, data in CANONICAL_INTENTS.items():
        for trigger in data.get("triggers", []):
            if clean_user == _normalize_text(trigger):
                return intent_key

    # 2. Substring matching (longest matching trigger wins for specificity)
    best_intent: Optional[str] = None
    best_len = 0
    for intent_key, data in CANONICAL_INTENTS.items():
        for trigger in data.get("triggers", []):
            norm_trig = _normalize_text(trigger)
            if len(norm_trig) >= 3 and norm_trig in clean_user:
                if len(norm_trig) > best_len:
                    best_len = len(norm_trig)
                    best_intent = intent_key

    return best_intent


def match_canonical_intent(
    intent_key: str, concise_dom: List[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, Any]], float]:
    """
    Matches a canonical intent key against interactive DOM elements on current page.
    Universally inspects accessible labels and attributes without site-specific selectors.

    Args:
        intent_key: One of the 4 canonical keys ('add_to_cart', 'search', 'go_home', 'subscribe')
        concise_dom: List of serialized interactive DOM elements (dicts or DomNode instances)

    Returns:
        tuple[Optional[Dict[str, Any]], float]: Matched DOM node and confidence score (0.0 to 1.0).
    """
    if not intent_key or intent_key not in CANONICAL_INTENTS:
        return None, 0.0

    dom_labels = CANONICAL_INTENTS[intent_key].get("dom_labels", [])
    norm_dom_labels = {_normalize_text(lbl) for lbl in dom_labels if _normalize_text(lbl)}

    candidates: List[Tuple[Dict[str, Any], float]] = []

    for raw_node in concise_dom:
        if raw_node is None:
            continue

        # Extract label and id supporting both dict and object/Pydantic schemas
        if isinstance(raw_node, dict):
            raw_lbl = raw_node.get("label") or raw_node.get("aria_label") or raw_node.get("text") or ""
            node_dict = raw_node
        else:
            raw_lbl = getattr(raw_node, "label", None) or getattr(raw_node, "resolved_label", None) or getattr(raw_node, "text", "") or ""
            node_dict = raw_node if isinstance(raw_node, dict) else (raw_node.dict() if hasattr(raw_node, "dict") else raw_node)

        if not isinstance(raw_lbl, str) or not raw_lbl:
            continue

        clean_lbl = _normalize_text(raw_lbl)
        if not clean_lbl:
            continue

        # 1. Exact match with canonical DOM labels
        if clean_lbl in norm_dom_labels:
            return node_dict, 1.0

        # 2. Substring match
        for norm_dl in norm_dom_labels:
            if len(norm_dl) >= 3 and (norm_dl in clean_lbl or clean_lbl in norm_dl):
                candidates.append((node_dict, 0.85))
                break

    if candidates:
        candidates.sort(key=lambda x: x[1], reverse=True)
        if candidates[0][1] >= 0.5:
            return candidates[0][0], candidates[0][1]

    return None, 0.0

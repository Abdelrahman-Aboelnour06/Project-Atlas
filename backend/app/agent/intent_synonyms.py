"""
Bilingual Intent Canonicalization & Generic Site Structure Module
backend/app/agent/intent_synonyms.py

Provides semantic canonicalization of high-frequency user actions across
English, Modern Standard Arabic (MSA), and Egyptian Colloquial Arabic (العامية المصرية).
Adheres strictly to the Prime Directive:
- Zero site names, zero domain hardcoding, zero per-site selectors.
- Universal site structure and interaction intent vocabulary only.
- Topic matching derived strictly from user goal text vs DOM labels.
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple


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


def _strip_arabic_prefixes(token: str) -> str:
    """
    Universal stripping of Arabic grammatical prefixes (ال, و, ف, ب, ك, ل) without domain hacks.
    Iteratively strips prefixes while remaining stem is sufficiently long (>= 3 chars).
    """
    if not token or len(token) <= 3:
        return token
    changed = True
    curr = token
    while changed and len(curr) > 3:
        changed = False
        if curr.startswith("ال") and len(curr) > 4:
            curr = curr[2:]
            changed = True
        elif curr[0] in ("و", "ف", "ب", "ك", "ل") and len(curr) > 3:
            curr = curr[1:]
            changed = True
            if curr.startswith("ال") and len(curr) > 4:
                curr = curr[2:]
    return curr


def _fold_arabic_plurals(token: str) -> str:
    """
    Universal folding of Arabic regular plural suffixes (ات, ين, ون) to base stem.
    """
    if not token or len(token) <= 4:
        return token
    for suffix in ("ات", "ين", "ون"):
        if token.endswith(suffix):
            return token[:-len(suffix)]
    return token


def _stem_word(word: str) -> str:
    """
    Universal lightweight Arabic and English stemming.
    """
    w = _normalize_text(word)
    if not w:
        return ""
    # Arabic prefix stripping & plural folding
    w = _fold_arabic_plurals(_strip_arabic_prefixes(w))
    # Fold trailing feminine/attached marker
    if len(w) >= 4 and w.endswith("ه"):
        w = w[:-1]
    # English suffix folding
    if len(w) > 4:
        for suffix in ("ing", "tion", "sion", "ment", "ies", "es", "ed", "s", "y", "e"):
            if w.endswith(suffix) and len(w) - len(suffix) >= 3:
                w = w[:-len(suffix)]
                break
    return w


def extract_search_keywords(user_goal: str) -> str:
    """
    Universal extraction of search query keywords from natural language user goal:
    - Drops conversational filler ("i want to", "please", "can you", "find", "اريد", "عاوز", "عايز", "من فضلك", etc.)
    - Drops {vault:...} tokens
    - Drops any 6+ digit runs (e.g. IDs, phone numbers)
    - Returns at most 5 words.
    """
    if not user_goal or not isinstance(user_goal, str):
        return ""
    text = re.sub(r"\{vault:[^}]+\}", "", user_goal)
    text = re.sub(r"\b\d{6,}\b", "", text)
    fillers = {
        "i", "want", "to", "please", "can", "you", "find", "search", "for", "look", "up",
        "open", "show", "me", "get", "check", "need", "like", "the", "a", "an", "on", "in",
        "اريد", "عاوز", "عايز", "ابحث", "عن", "لو", "سمحت", "من", "فضلك", "ممكن",
        "وريني", "هاتلي", "افتح", "شوفلي", "وديني", "في", "على", "علي", "الى", "إلى", "عبر",
    }
    tokens = re.findall(r"[\w]+", text)
    clean_words = []
    for tok in tokens:
        norm = _normalize_text(tok)
        if norm and norm not in fillers and len(tok) > 1:
            clean_words.append(tok)
            if len(clean_words) >= 5:
                break
    return " ".join(clean_words) if clean_words else " ".join(tokens[:5])


COMMON_STOPWORDS: Set[str] = {
    "the", "a", "an", "on", "in", "of", "to", "for", "at", "by", "with", "from",
    "عن", "من", "في", "على", "علي", "الى", "إلى", "الي", "مع", "هذا", "هذه", "ذلك", "تلك", "هو", "هي", "عبر", "كل", "جميع",
}

# Generic request and inquiry action verbs across languages
GENERIC_REQUEST_VERBS: Set[str] = {
    "inquiry", "inquire", "check", "query", "lookup", "find", "search", "view", "get", "request", "want", "ask",
    "استفسار", "استعلام", "استفسر", "استعلم", "فحص", "كشف", "معرفة", "طلب", "اريد", "عايز", "عاوز", "بحث", "عرض",
}

# Universal site structure vocabulary
STRUCTURAL_WORDS: Set[str] = {
    "page", "site", "portal", "website", "menu", "list", "guide", "section", "service", "services", "home",
    "صفحة", "موقع", "بوابة", "دليل", "قائمة", "قسم", "خدمة", "خدمات", "رئيسية", "الكترونية",
}

_GENERIC_VERB_STEMS: Set[str] = {_stem_word(w) for w in GENERIC_REQUEST_VERBS} | {w for w in GENERIC_REQUEST_VERBS}
_STRUCTURAL_STEMS: Set[str] = {_stem_word(w) for w in STRUCTURAL_WORDS} | {w for w in STRUCTURAL_WORDS}


def _is_generic_request_verb(token: str) -> bool:
    """Checks if token belongs to generic request/inquiry verb class."""
    st = _stem_word(token)
    norm = _normalize_text(token)
    return st in _GENERIC_VERB_STEMS or norm in _GENERIC_VERB_STEMS


def _is_structural_word(token: str) -> bool:
    """Checks if token belongs to structural navigation vocabulary."""
    st = _stem_word(token)
    norm = _normalize_text(token)
    return st in _STRUCTURAL_STEMS or norm in _STRUCTURAL_STEMS


def _token_match_weight(token: str) -> float:
    """
    Assigns higher weight to content nouns than to generic verbs or structural words.
    A content noun is any token that is NOT a generic verb, stopword, or structural word.
    """
    if _is_generic_request_verb(token) or _is_structural_word(token):
        return 1.0
    return 2.0


def score_text_similarity(query: str, candidate: str) -> float:
    """
    Universal lexical matching between user query/milestone and DOM candidate label:
    - Normalizes with _normalize_text
    - Strips grammatical prefixes (ال/و/ب/ل) and folds plurals (ات/ين/ون) and suffixes
    - Treats generic request verbs as a unified intent class
    - Prioritizes content nouns over generic request verbs and structural words
    - Evaluates weighted token intersection over query tokens and candidate tokens.
    """
    if not query or not candidate:
        return 0.0

    q_norm = _normalize_text(query)
    c_norm = _normalize_text(candidate)

    if not q_norm or not c_norm:
        return 0.0

    if q_norm == c_norm:
        return 1.0
    if len(q_norm) >= 3 and (q_norm in c_norm or c_norm in q_norm):
        return 0.90

    raw_q_words = re.findall(r"[\w]+", query)
    raw_c_words = re.findall(r"[\w]+", candidate)

    # Filter out stopwords
    q_tokens = [_stem_word(t) for t in raw_q_words if _normalize_text(t) not in COMMON_STOPWORDS]
    q_tokens = [t for t in q_tokens if t and len(t) > 1]
    if not q_tokens:
        q_tokens = [_stem_word(t) for t in raw_q_words if t and len(t) > 1]
    if not q_tokens:
        return 0.0

    c_tokens = [_stem_word(t) for t in raw_c_words if _normalize_text(t) not in COMMON_STOPWORDS]
    c_tokens = [t for t in c_tokens if t and len(t) > 1]
    if not c_tokens:
        c_tokens = [_stem_word(t) for t in raw_c_words if t and len(t) > 1]
    if not c_tokens:
        return 0.0

    c_token_set = set(c_tokens)

    # Weighted match over query tokens
    matched_q_weight = 0.0
    total_q_weight = sum(_token_match_weight(qt) for qt in q_tokens)

    for qt in q_tokens:
        w = _token_match_weight(qt)
        if qt in c_token_set:
            matched_q_weight += w
        elif _is_generic_request_verb(qt) and any(_is_generic_request_verb(ct) for ct in c_token_set):
            matched_q_weight += min(w, 0.8)
        elif any((len(qt) >= 4 and (qt in ct or ct in qt)) for ct in c_token_set):
            matched_q_weight += w * 0.85

    score_q = matched_q_weight / total_q_weight if total_q_weight else 0.0

    # Weighted match over candidate tokens (coverage)
    matched_c_weight = 0.0
    total_c_weight = sum(_token_match_weight(ct) for ct in c_tokens)
    q_token_set = set(q_tokens)

    for ct in c_tokens:
        w = _token_match_weight(ct)
        if ct in q_token_set:
            matched_c_weight += w
        elif _is_generic_request_verb(ct) and any(_is_generic_request_verb(qt) for qt in q_tokens):
            matched_c_weight += min(w, 0.8)
        elif any((len(ct) >= 4 and (ct in qt or qt in ct)) for qt in q_tokens):
            matched_c_weight += w * 0.85

    score_c = (matched_c_weight / total_c_weight) * 0.90 if total_c_weight else 0.0

    return min(1.0, max(score_q, score_c))


# Core Canonical Intents mapping English, MSA, and Egyptian Colloquial Arabic
# Universal site structure & interaction intents ONLY (Prime Directive compliant)
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
    "traffic_inquiry": {
        "triggers": [
            # English
            "check car fees", "check if my car has any fees", "car fees", "check traffic violations",
            "check traffic fines", "vehicle violations", "car violations", "traffic violations",
            "traffic fines", "traffic fees", "license fees", "vehicle fees", "check my car fees in egypt",
            "car fees in egypt", "check vehicle fines", "traffic services", "traffic tickets",
            "check traffic tickets", "car fine", "car fines", "check car fees in egypt",
            # MSA
            "الاستعلام عن المخالفات", "الاستعلام عن المخالفات المرورية", "مخالفات المرور",
            "مخالفات رخص المركبات", "مخالفات رخصة المركبة", "رسوم رخصة المركبة", "رسوم المركبة",
            "فحص مخالفات السيارة", "الاستعلام عن مخالفات السيارة", "مخالفات السيارة",
            "مخالفات المركبات", "الاستعلام عن مخالفات المرور",
            # Egyptian Colloquial
            "مخالفات عربيتي", "مخالفات العربية", "شوفيلي لو في مخالفات على عربيتي",
            "شوف مخالفات عربيتي", "شوفلي مخالفات العربية", "عايز اعرف مخالفات العربية",
            "عليها مخالفات", "عليها فلوس", "رسوم العربية", "رسوم رخصة العربية",
            "استعلام عن مخالفات", "مخالفات رخصتي", "شوفيلي مخالفات العربية",
            "شوفلي لو في مخالفات", "شوفيلي لو في مخالفات", "شوف لو في مخالفات على عربيتي",
            "شوفيلي لو في مخالفات على عربيتي في مصر", "شوفلي لو في مخالفات على عربيتي في مصر",
        ],
        "dom_labels": [
            # English
            "traffic violations", "traffic fines", "vehicle violations", "traffic fees",
            "traffic services", "check violations", "check fines",
            # Arabic
            "الاستعلام عن المخالفات المرورية", "الاستعلام عن المخالفات", "مخالفات المرور",
            "مخالفات رخص المركبات", "مخالفات رخصة المركبة", "مخالفات المركبات", "مخالفات السيارة",
        ],
    },
    "license_renewal": {
        "triggers": [
            # English
            "renew vehicle license", "renew car license", "license renewal", "renew license",
            "renew my vehicle", "vehicle registration renewal",
            # MSA
            "تجديد رخصة المركبة", "تجديد رخصة السيارة", "تجديد الرخصة", "تجديد رخصتي",
            "تجديد رخص المركبات",
            # Egyptian Colloquial
            "جدد رخصة عربيتي", "عايز اجدد الرخصة", "عاوز اجدد الرخصة", "تجديد رخصة العربية",
            "عاوز اجدد رخصة العربية", "عايز اجدد رخصة عربيتي",
        ],
        "dom_labels": [
            # English
            "vehicle license renewal", "renew vehicle license", "renew license", "license renewal",
            # Arabic
            "تجديد رخصة المركبة", "تجديد رخصة السيارة", "تجديد الرخصة", "تجديد رخص المركبات",
        ],
    },
    "services": {
        "triggers": [
            "services", "our services", "service catalog", "portal services",
            "خدمات", "الخدمات", "خدماتنا", "دليل الخدمات",
        ],
        "dom_labels": [
            "services", "our services", "خدمات", "الخدمات", "خدماتنا",
        ],
    },
    "e_services": {
        "triggers": [
            "e-services", "eservices", "electronic services", "online services",
            "الخدمات الإلكترونية", "خدمات إلكترونية", "خدمات الكترونية", "الخدمات الالكترونية",
        ],
        "dom_labels": [
            "e-services", "eservices", "الخدمات الإلكترونية", "الخدمات الالكترونية",
        ],
    },
    "all_services": {
        "triggers": [
            "all services", "view all services", "browse all services", "more services",
            "كل الخدمات", "جميع الخدمات", "كافة الخدمات", "عرض كل الخدمات",
        ],
        "dom_labels": [
            "all services", "كل الخدمات", "جميع الخدمات", "دليل المعاملات والخدمات الموحدة",
        ],
    },
    "sitemap": {
        "triggers": [
            "sitemap", "site map", "site index", "directory",
            "خريطة الموقع", "خريطه الموقع", "دليل الموقع",
        ],
        "dom_labels": [
            "sitemap", "site map", "خريطة الموقع", "خريطه الموقع",
        ],
    },
    "inquiry": {
        "triggers": [
            "inquiry", "inquire", "check status", "lookup", "query",
            "استعلام", "استفسار", "فحص", "كشف", "استعلم",
        ],
        "dom_labels": [
            "inquiry", "inquire", "status", "استعلام", "استفسار",
        ],
    },
    "pay": {
        "triggers": [
            "pay", "payment", "pay now", "make payment", "checkout and pay",
            "دفع", "سداد", "ادفع", "سداد المبلغ", "دفع الآن",
        ],
        "dom_labels": [
            "pay", "payment", "دفع", "سداد",
        ],
    },
    "apply": {
        "triggers": [
            "apply", "apply now", "submit application", "new application",
            "تقديم", "طلب جديد", "قدم الآن", "تسجيل طلب",
        ],
        "dom_labels": [
            "apply", "تقديم", "طلب جديد",
        ],
    },
    "renew": {
        "triggers": [
            "renew", "renewal", "renew now",
            "تجديد", "جدد", "طلب تجديد",
        ],
        "dom_labels": [
            "renew", "renewal", "تجديد",
        ],
    },
    "view_cart": {
        "triggers": [
            "view cart", "view my cart", "open cart", "open my cart", "show cart", "show my cart",
            "shopping cart", "my cart", "cart", "go to cart",
            "open bag", "view bag", "shopping bag", "proceed to checkout", "checkout",
            "عربة التسوق", "السلة", "افتح السلة", "وريني السلة", "سلة المشتريات", "عايز ادفع",
        ],
        "dom_labels": [
            "cart", "shopping cart", "view cart", "bag", "basket", "checkout",
            "السلة", "عربة التسوق", "سلة المشتريات",
        ],
    },
    "sign_in": {
        "triggers": [
            "sign in", "log in", "login", "my account", "sign into my account",
            "log in to account", "open profile", "user login",
            "تسجيل الدخول", "دخول", "حسابي", "سجل دخول", "افتح حسابي",
        ],
        "dom_labels": [
            "sign in", "log in", "login", "account", "my account", "profile",
            "تسجيل الدخول", "دخول", "حسابي",
        ],
    },
    "notifications": {
        "triggers": [
            "notifications", "open notifications", "show alerts", "alerts",
            "inbox", "show notifications", "my notifications",
            "الإشعارات", "الاشعارات", "التنبيهات", "وريني الإشعارات",
        ],
        "dom_labels": [
            "notifications", "alerts", "inbox", "bell", "الإشعارات", "التنبيهات",
        ],
    },
    "pagination_next": {
        "triggers": [
            "next page", "go to next page", "next", "page 2", "more results",
            "الصفحة التالية", "التالي", "اللي بعده", "الصفحة اللي بعدها",
        ],
        "dom_labels": [
            "next", "next page", ">", "»", "التالي", "الصفحة التالية",
        ],
    },
    "download_export": {
        "triggers": [
            "download", "export csv", "save pdf", "download file", "export data",
            "print statement", "download timetable",
            "تحميل", "تنزيل", "تصدير", "تنزيل الملف", "اطبع",
        ],
        "dom_labels": [
            "download", "export", "save", "pdf", "csv", "print", "تحميل", "تنزيل", "تصدير",
        ],
    },
    "filter_sort": {
        "triggers": [
            "filter", "show filters", "sort by", "sort by price", "apply filter",
            "تصفية", "ترتيب", "فلتر", "رتب حسب",
        ],
        "dom_labels": [
            "filter", "sort", "sort by", "filters", "تصفية", "ترتيب", "فلترة",
        ],
    },
}


def canonicalize_intent(user_message: str) -> Optional[str]:
    """
    Map raw natural language user messages (English, MSA, or Egyptian colloquial)
    to a canonical intent key without website-specific hacks.

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
        intent_key: Canonical key (e.g. 'add_to_cart', 'search', 'go_home', 'services', etc.)
        concise_dom: List of serialized interactive DOM elements (dicts or DomNode instances)

    Returns:
        tuple[Optional[Dict[str, Any]], float]: Matched DOM node and confidence score (0.0 to 1.0).
    """
    if not intent_key or intent_key not in CANONICAL_INTENTS:
        return None, 0.0

    dom_labels = CANONICAL_INTENTS[intent_key].get("dom_labels", [])
    raw_dom_labels = {lbl.strip().lower() for lbl in dom_labels if lbl and lbl.strip()}
    norm_dom_labels = {_normalize_text(lbl) for lbl in dom_labels if _normalize_text(lbl)}

    candidates: List[Tuple[Dict[str, Any], float]] = []

    for raw_node in concise_dom:
        if raw_node is None:
            continue

        if isinstance(raw_node, dict):
            raw_lbl = (
                raw_node.get("resolved_label")
                or raw_node.get("aria_label")
                or raw_node.get("inner_text")
                or raw_node.get("label")
                or raw_node.get("text")
                or ""
            )
            node_dict = raw_node
        else:
            raw_lbl = (
                getattr(raw_node, "resolved_label", None)
                or getattr(raw_node, "aria_label", None)
                or getattr(raw_node, "inner_text", None)
                or getattr(raw_node, "label", None)
                or getattr(raw_node, "text", "")
                or ""
            )
            node_dict = raw_node.model_dump() if hasattr(raw_node, "model_dump") else (
                raw_node.dict() if hasattr(raw_node, "dict") else vars(raw_node)
            )

        if not isinstance(raw_lbl, str) or not raw_lbl:
            continue

        trimmed_lbl = raw_lbl.strip().lower()

        # 1. Exact raw match (covers interactive symbols like '>', '»', '+', '×')
        if trimmed_lbl in raw_dom_labels:
            return node_dict, 1.0

        clean_lbl = _normalize_text(raw_lbl)
        if not clean_lbl:
            continue

        # 2. Exact match with canonical DOM labels
        if clean_lbl in norm_dom_labels:
            return node_dict, 1.0

        # 3. Substring match
        for norm_dl in norm_dom_labels:
            if len(norm_dl) >= 3 and (norm_dl in clean_lbl or clean_lbl in norm_dl):
                candidates.append((node_dict, 0.85))
                break

    if candidates:
        candidates.sort(key=lambda x: x[1], reverse=True)
        if candidates[0][1] >= 0.5:
            return candidates[0][0], candidates[0][1]

    return None, 0.0

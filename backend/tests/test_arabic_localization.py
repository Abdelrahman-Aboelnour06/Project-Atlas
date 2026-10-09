"""
Unit Tests for Wave 1 Backend Core: Arabic Normalization, Contract Language Signal, and Intent Synonyms
Tracks N1, 0b, N2a
backend/tests/test_arabic_localization.py
"""

import pytest
from app.agent.agentic_planner import _normalize_text, find_heuristic_match
from app.agent.intent_synonyms import (
    CANONICAL_INTENTS,
    canonicalize_intent,
    match_canonical_intent,
)
from app.models.request import AgentMessage
from app.models.goal import GoalState, GoalStepRequest


# ── Track N1: Unicode & Arabic Normalization ─────────────────────────────────

class TestArabicNormalization:
    """Tests for _normalize_text verifying NFKC, letter folding, digits, and tashkeel."""

    def test_acceptance_criteria_add_to_cart(self):
        assert _normalize_text("أضف إلى السلة") == "اضفاليالسله"

    def test_acceptance_criteria_iphone_indic_digits(self):
        assert _normalize_text("iPhone ١٥") == "iphone15"

    def test_persian_eastern_arabic_digits(self):
        assert _normalize_text("صفحة ۱۲") == "صفحه12"

    def test_tashkeel_diacritics_stripping(self):
        # Tashkeel / harakat: damma, fatha, kasra, shadda, tanween
        assert _normalize_text("مُتَفَرِّعٌ") == "متفرع"
        assert _normalize_text("كِتَابٌ") == "كتاب"

    def test_tatweel_kashida_stripping(self):
        # Tatweel / kashida: \u0640
        assert _normalize_text("تـــــم") == "تم"
        assert _normalize_text("عــربــي") == "عربي"

    def test_arabic_letter_folding_all_variants(self):
        # Alef variants -> ا
        assert _normalize_text("أحمد") == "احمد"
        assert _normalize_text("إسلام") == "اسلام"
        assert _normalize_text("آمال") == "امال"
        assert _normalize_text("ٱسم") == "اسم"

        # Alif maqsura ى -> ي
        assert _normalize_text("مستشفى") == "مستشفي"

        # Taa marbuta ة -> ه
        assert _normalize_text("سيارة") == "سياره"

        # Waw with hamza ؤ -> و
        assert _normalize_text("مؤتمر") == "موتمر"

        # Yaa with hamza ئ -> ي
        assert _normalize_text("بيئة") == "بييه"
        assert _normalize_text("شاطئ") == "شاطي"

    def test_latin_english_behavior_preserved(self):
        assert _normalize_text("Search in Drive") == "searchindrive"
        assert _normalize_text("Hello, World! 123") == "helloworld123"

    def test_empty_and_special_cases(self):
        assert _normalize_text("") == ""
        assert _normalize_text("   ") == ""
        assert _normalize_text("!@#$%^&*()") == ""


# ── Track N1: Arabic Heuristic DOM Matching ──────────────────────────────────

class TestArabicHeuristicMatch:
    """Tests for find_heuristic_match with Arabic and English phrases."""

    def test_arabic_home_page_exact_match(self):
        concise_dom = [
            {"id": "btn-home", "label": "الصفحة الرئيسية"},
            {"id": "btn-cart", "label": "عربة التسوق"},
        ]
        node, score = find_heuristic_match("افتح الصفحة الرئيسية", concise_dom)
        assert node is not None
        assert node["id"] == "btn-home"
        assert score == 1.0

    def test_arabic_subscribe_exact_match(self):
        concise_dom = [
            {"id": "btn-sub", "label": "اشتراك"},
            {"id": "btn-cancel", "label": "إلغاء"},
        ]
        node, score = find_heuristic_match("دوس على اشتراك", concise_dom)
        assert node is not None
        assert node["id"] == "btn-sub"
        assert score == 1.0

    def test_arabic_egyptian_colloquial_verb_filtering(self):
        concise_dom = [
            {"id": "atlas-btn-cart", "label": "السلة"},
        ]
        node, score = find_heuristic_match("اضغط على زر السلة", concise_dom)
        assert node is not None
        assert node["id"] == "atlas-btn-cart"
        assert score == 1.0

    def test_english_heuristic_regression(self):
        concise_dom = [
            {"id": "atlas-input-1", "tag": "input", "label": "Search in Drive", "category": "search"}
        ]
        node, score = find_heuristic_match("the search bar", concise_dom)
        assert node is not None
        assert node["id"] == "atlas-input-1"
        assert score >= 0.5


# ── Track N2a: Bilingual Intent Canonicalization ──────────────────────────────

class TestIntentCanonicalization:
    """Tests for canonicalize_intent and match_canonical_intent."""

    def test_canonicalize_intent_add_to_cart_acceptance_criteria(self):
        assert canonicalize_intent("اشتريلي الحاجه دي") == "add_to_cart"

    def test_canonicalize_intent_core_keys(self):
        # 1. add_to_cart
        assert canonicalize_intent("add to cart") == "add_to_cart"
        assert canonicalize_intent("أضف إلى السلة") == "add_to_cart"
        assert canonicalize_intent("حط في السله") == "add_to_cart"
        assert canonicalize_intent("شراء الآن") == "add_to_cart"

        # 2. search
        assert canonicalize_intent("search for shoes") == "search"
        assert canonicalize_intent("ابحث عن هاتف") == "search"
        assert canonicalize_intent("دورلي على تلفون") == "search"

        # 3. go_home
        assert canonicalize_intent("go home") == "go_home"
        assert canonicalize_intent("الصفحة الرئيسية") == "go_home"
        assert canonicalize_intent("وديني الرئيسيه") == "go_home"

        # 4. subscribe
        assert canonicalize_intent("subscribe") == "subscribe"
        assert canonicalize_intent("اشترك في النشرة") == "subscribe"
        assert canonicalize_intent("دوس على اشتراك") == "subscribe"

    def test_canonicalize_intent_unrecognized(self):
        assert canonicalize_intent("what is the weather today?") is None
        assert canonicalize_intent("") is None
        assert canonicalize_intent("hello world") is None

    def test_match_canonical_intent_add_to_cart_acceptance_criteria(self):
        dom = [{"id": "atlas-btn-cart", "label": "أضف إلى السلة"}]
        node, score = match_canonical_intent("add_to_cart", dom)
        assert node is not None
        assert node["id"] == "atlas-btn-cart"
        assert score == 1.0

    def test_match_canonical_intent_all_keys(self):
        dom = [
            {"id": "btn-search", "label": "Search"},
            {"id": "btn-home", "label": "الرئيسية"},
            {"id": "btn-sub", "label": "اشتراك"},
        ]
        node_s, score_s = match_canonical_intent("search", dom)
        assert node_s is not None and node_s["id"] == "btn-search" and score_s == 1.0

        node_h, score_h = match_canonical_intent("go_home", dom)
        assert node_h is not None and node_h["id"] == "btn-home" and score_h == 1.0

        node_sub, score_sub = match_canonical_intent("subscribe", dom)
        assert node_sub is not None and node_sub["id"] == "btn-sub" and score_sub == 1.0

    def test_match_canonical_intent_empty_or_invalid(self):
        dom = [{"id": "btn-random", "label": "Contact Us"}]
        node, score = match_canonical_intent("unknown_intent", dom)
        assert node is None
        assert score == 0.0

        node_empty, score_empty = match_canonical_intent("add_to_cart", [])
        assert node_empty is None
        assert score_empty == 0.0


# ── Track 0b: Model Contract Language Fields ─────────────────────────────────

class TestModelLanguageSignalContracts:
    """Tests for language field on AgentMessage, GoalState, and GoalStepRequest."""

    def test_agent_message_language_field(self):
        # Optional field defaults to None
        msg_default = AgentMessage(
            session_id="sess-1",
            url="https://example.com",
            dom_map=[],
            command="click button",
            type="command",
        )
        assert msg_default.language is None

        # Accepts explicit language
        msg_ar = AgentMessage(
            session_id="sess-2",
            url="https://example.com",
            dom_map=[],
            command="اشتريلي دي",
            type="command",
            language="ar-EG",
        )
        assert msg_ar.language == "ar-EG"

    def test_goal_state_language_field(self):
        # Optional field defaults to None
        state_default = GoalState(goal="Search shoes")
        assert state_default.language is None

        # Accepts explicit language
        state_ar = GoalState(goal="اشتريلي ايفون", language="ar-EG")
        assert state_ar.language == "ar-EG"

    def test_goal_step_request_language_field(self):
        # Optional field defaults to None
        req_default = GoalStepRequest(
            goal="Buy laptop",
            current_url="https://example.com",
        )
        assert req_default.language is None

        # Accepts explicit language
        req_ar = GoalStepRequest(
            goal="شراء هاتف",
            current_url="https://example.com",
            language="ar-EG",
        )
        assert req_ar.language == "ar-EG"

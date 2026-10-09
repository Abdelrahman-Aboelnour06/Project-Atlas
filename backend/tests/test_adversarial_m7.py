"""
Adversarial Stress-Testing & Boundary Verification Suite for Milestone M7
backend/tests/test_adversarial_m7.py

Empirically challenges:
1. Arabic normalization edge cases (mixed scripts, extreme diacritics, Eastern/Persian digits, tatweel, NFKC variants).
2. Canonical intent resolution with complex prompts, multi-button DOM structures, and non-ASCII IDs.
3. Fast-path canonical plan execution in agentic_planner with non-ASCII DOM attributes.
4. Language mirroring across all 6 prompt surfaces and JSON response parsing robustness.
5. Synthetic language switch milestone creation under diverse locale casing and formatting.
"""

import json
import time
import unicodedata
import pytest
from unittest.mock import patch

from app.agent.agentic_planner import (
    _normalize_text as planner_normalize_text,
    find_heuristic_match,
    plan_agentic_action,
    _clean_json_str,
)
from app.agent.intent_synonyms import (
    _normalize_text as synonyms_normalize_text,
    CANONICAL_INTENTS,
    canonicalize_intent,
    match_canonical_intent,
)
from app.agent.planner import plan_goal, Milestone
from app.agent.scout import ScoutResult, classify_page
from app.agent.form_filler import plan_form_fill, FormPlan
from app.models.dom import DomNode
from app.models.goal import AgenticPlan, PlanStep
from app.agent import (
    agentic_planner,
    simplify_prompt,
    summary_prompt,
    planner,
    scout,
    form_filler,
    llm_client,
)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. ARABIC NORMALIZATION ADVERSARIAL STRESS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestArabicNormalizationAdversarial:
    """Stress tests for Unicode normalization, folding, and diacritic stripping."""

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_mixed_english_arabic_alphanumeric(self, norm_fn):
        # Mixed script strings with Latin, Arabic, and numbers
        assert norm_fn("iPhone 15 برو ماكس") == "iphone15بروماكس"
        assert norm_fn("MacBook Air M3 شريحة") == "macbookairm3شريحه"
        assert norm_fn("USB-C كابل 2.0") == "usbcكابل20"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_eastern_arabic_and_persian_digits_in_mixed_text(self, norm_fn):
        # Eastern Arabic digits: ٠١٢٣٤٥٦٧٨٩ -> 0123456789
        assert norm_fn("طلب رقم ٠١٢٣٤٥٦٧٨٩") == "طلبرقم0123456789"
        # Persian digits: ۰۱۲۳۴۵۶۷۸۹ -> 0123456789
        assert norm_fn("صفحة شماره ۰۱۲۳۴۵۶۷۸۹") == "صفحهشماره0123456789"
        # Mixed Indic and ASCII digits
        assert norm_fn("كود 123 و ٤٥٦") == "كود123و456"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_extreme_and_stacked_diacritics(self, norm_fn):
        # All 8 primary harakat (fatha, damma, kasra, fathatan, dammatan, kasratan, sukun, shadda)
        vowel_heavy = "بَ بِ بُ بً بٍ بٌ بْ بّ"
        assert norm_fn(vowel_heavy) == "بببببببب"

        # Stacked shadda + fatha + tanween + damma on single letters
        stacked = "مُتَفَرِِّّعٌٌّ كِتَـــــابٌ"
        assert norm_fn(stacked) == "متفرعكتاب"

        # Dagger alif / superscript alif (\u0670) e.g. هٰذا, رَحْمٰن
        dagger_alif = "هٰذَا الرَّحْمٰن"
        # In Arabic, هٰذَا strips \u0670 and fatha leaving هذا, and الرَّحْمٰن strips shadda/fatha/sukun/\u0670 leaving الرحمن
        assert norm_fn(dagger_alif) == "هذاالرحمن"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_massive_tatweel_kashida(self, norm_fn):
        # 1000 consecutive tatweel characters
        long_tatweel = "أ" + ("\u0640" * 1000) + "ض" + ("\u0640" * 500) + "ف"
        assert norm_fn(long_tatweel) == "اضف"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_nfkc_decomposed_vs_precomposed_alef_variants(self, norm_fn):
        # Decomposed: base alef \u0627 + hamza above \u0654
        decomposed_alef = "\u0627\u0654"
        # Precomposed: \u0623
        precomposed_alef = "أ"
        assert norm_fn(decomposed_alef) == "ا"
        assert norm_fn(precomposed_alef) == "ا"
        assert norm_fn(decomposed_alef) == norm_fn(precomposed_alef)

        # Decomposed: alef \u0627 + madda \u0653
        decomposed_madda = "\u0627\u0653"
        assert norm_fn(decomposed_madda) == "ا"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_arabic_ligatures_and_presentation_forms(self, norm_fn):
        # Presentation form Lam-Alef \uFEFB -> NFKC decomposes to \u0644\u0627
        lam_alef = "\uFEFB"
        assert norm_fn(lam_alef) == "لا"

        # Lam-Alef with hamza above \uFEF7 -> decomposes and folds to "لا"
        lam_alef_hamza = "\uFEF7"
        assert norm_fn(lam_alef_hamza) == "لا"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_bidi_and_zero_width_characters(self, norm_fn):
        # Zero-width joiner (\u200D), ZWNJ (\u200C), LTR mark (\u200E), RTL mark (\u200F)
        text_with_bidi = "أضف\u200D\u200C\u200E\u200F إلى السلة"
        assert norm_fn(text_with_bidi) == "اضفاليالسله"

    @pytest.mark.parametrize("norm_fn", [planner_normalize_text, synonyms_normalize_text])
    def test_pathological_inputs_do_not_throw(self, norm_fn):
        assert norm_fn("") == ""
        assert norm_fn("   \t\n  ") == ""
        assert norm_fn(None) == ""
        assert norm_fn(12345) == ""
        assert norm_fn(["list"]) == ""
        assert norm_fn({"key": "val"}) == ""
        assert norm_fn("!@#$%^&*()_+-=[]{}|;':\",.<>/?`~") == ""
        assert norm_fn("🛒🚀💻📱") == ""


# ═══════════════════════════════════════════════════════════════════════════════
# 2. CANONICAL INTENT RESOLUTION ADVERSARIAL STRESS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestCanonicalIntentResolutionAdversarial:
    """Stress tests for canonicalize_intent and match_canonical_intent."""

    @pytest.mark.parametrize(
        "phrase,expected_intent",
        [
            # Complex Egyptian colloquial phrases with polite preambles and chat
            ("لو سمحت يا أطلس اشتريلي الحاجة دي بسرعة شكراً", "add_to_cart"),
            ("عايز اشتري ده من فضلك", "add_to_cart"),
            ("عاوز اشتري الحاجه دي لو ممكن", "add_to_cart"),
            ("حط في السلة دي دلوقتي", "add_to_cart"),
            ("ضيف للسلة يا باشا", "add_to_cart"),
            ("هات الحاجة دي فوراً", "add_to_cart"),
            ("وديني بسرعة على الصفحة الرئيسية من فضلك", "go_home"),
            ("روح علي الصفحه الرئيسيه", "go_home"),
            ("افتح الرئيسيه يا باشا", "go_home"),
            ("ارجع للرئيسيه حالا", "go_home"),
            ("دورلي علي ارخص لابتوب موجود عندك", "search"),
            ("ابحثلي عن منتجات العناية بالبشرة", "search"),
            ("شوفلي اسعار التليفونات", "search"),
            ("دوس علي اشتراك في النشرة البريدية حالا", "subscribe"),
            ("اشترك في النشرة دلوقتي", "subscribe"),
            ("سجل اشتراك لو سمحت", "subscribe"),
            # English complex phrasings
            ("Could you please add this to cart right away?", "add_to_cart"),
            ("I want to buy this item now please", "add_to_cart"),
            ("Please take me back to home page", "go_home"),
            ("Please navigate to home right now", "go_home"),
            ("Kindly subscribe to newsletter for me", "subscribe"),
        ],
    )
    def test_canonicalize_complex_prompts(self, phrase, expected_intent):
        assert canonicalize_intent(phrase) == expected_intent

    def test_canonicalize_non_matching_phrases_return_none(self):
        assert canonicalize_intent("how is the weather today?") is None
        assert canonicalize_intent("who won the match last night?") is None
        assert canonicalize_intent("random unrelated text with no matching verbs") is None
        assert canonicalize_intent("صباح الخير يا جميل عامل ايه") is None
        assert canonicalize_intent("") is None
        assert canonicalize_intent(None) is None

    def test_match_canonical_intent_multi_button_disambiguation(self):
        """
        When both 'Add to Wishlist' and 'Add to Cart' exist,
        exact matching must prioritize 'Add to Cart' with 1.0 confidence.
        """
        concise_dom = [
            {"id": "btn-wishlist", "label": "Add to Wishlist", "tag": "button"},
            {"id": "btn-cart", "label": "Add to Cart", "tag": "button"},
            {"id": "btn-compare", "label": "Add to Compare", "tag": "button"},
        ]
        matched, score = match_canonical_intent("add_to_cart", concise_dom)
        assert matched is not None
        assert matched["id"] == "btn-cart"
        assert score == 1.0

    def test_match_canonical_intent_arabic_multi_button_disambiguation(self):
        """
        In Arabic DOM, exact match for 'أضف إلى السلة' must win over 'قائمة الرغبات'.
        """
        concise_dom = [
            {"id": "btn-wishlist", "label": "أضف إلى قائمة الرغبات", "tag": "button"},
            {"id": "btn-cart", "label": "أضف إلى السلة", "tag": "button"},
            {"id": "btn-details", "label": "تفاصيل المنتج", "tag": "button"},
        ]
        matched, score = match_canonical_intent("add_to_cart", concise_dom)
        assert matched is not None
        assert matched["id"] == "btn-cart"
        assert score == 1.0

    def test_match_canonical_intent_with_non_ascii_and_unicode_ids(self):
        """Verify non-ASCII and Arabic element IDs are preserved intact."""
        concise_dom = [
            {"id": "زر_إضافة_السلة_١٢٣", "label": "أضف إلى السلة", "tag": "button"},
            {"id": "🛒-checkout-button", "label": "عربة التسوق", "tag": "button"},
        ]
        matched, score = match_canonical_intent("add_to_cart", concise_dom)
        assert matched is not None
        assert matched["id"] == "زر_إضافة_السلة_١٢٣"
        assert score == 1.0

    def test_match_canonical_intent_with_numeric_ids(self):
        """Handles numeric integer IDs without string conversion error."""
        concise_dom = [
            {"id": 1042, "label": "Add to Cart", "tag": "button"},
        ]
        matched, score = match_canonical_intent("add_to_cart", concise_dom)
        assert matched is not None
        assert matched["id"] == 1042
        assert score == 1.0

    def test_match_canonical_intent_with_domnode_objects(self):
        """Supports DomNode Pydantic instances using resolved_label."""
        node1 = DomNode(
            id="node-sub",
            tag="button",
            resolved_label="اشتراك",
            category="button",
        )
        node2 = DomNode(
            id="node-cancel",
            tag="button",
            resolved_label="إلغاء",
            category="button",
        )
        matched, score = match_canonical_intent("subscribe", [node1, node2])
        assert matched is not None
        extracted_id = matched.get("id") if isinstance(matched, dict) else matched.id
        assert extracted_id == "node-sub"
        assert score == 1.0

    def test_match_canonical_intent_empty_or_malformed_dom(self):
        assert match_canonical_intent("add_to_cart", []) == (None, 0.0)
        assert match_canonical_intent("invalid_key", [{"id": "1", "label": "Add to Cart"}]) == (None, 0.0)
        malformed_dom = [
            None,
            {},
            {"id": "1"},  # missing label
            {"id": "2", "label": None},
            {"id": "3", "label": 12345},  # non-string label
            {"id": "4", "label": ""},
        ]
        matched, score = match_canonical_intent("add_to_cart", malformed_dom)
        assert matched is None
        assert score == 0.0

    def test_match_canonical_intent_large_dom_performance(self):
        """Ensures matching over 2,000 DOM elements completes in under 50ms."""
        large_dom = [
            {"id": f"elem-{i}", "label": f"Irrelevant item {i}", "tag": "button"}
            for i in range(2000)
        ]
        # Insert target element towards the end
        large_dom.append({"id": "target-cart", "label": "Add to Cart", "tag": "button"})

        t0 = time.perf_counter()
        matched, score = match_canonical_intent("add_to_cart", large_dom)
        t_elapsed = time.perf_counter() - t0

        assert matched is not None
        assert matched["id"] == "target-cart"
        assert score == 1.0
        assert t_elapsed < 0.050, f"Expected < 50ms, took {t_elapsed*1000:.2f}ms"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. AGENTIC PLANNER FAST-PATH & DOM INTEGRATION ADVERSARIAL TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAgenticPlannerFastPathAdversarial:
    """Stress tests for fast-path canonical plan generation in agentic_planner.py."""

    @pytest.mark.asyncio
    async def test_fast_path_egyptian_arabic_add_to_cart_plan(self):
        dom = [
            {"id": "btn-search", "tag": "button", "label": "بحث"},
            {"id": "btn-add-cart", "tag": "button", "label": "أضف إلى السلة"},
        ]
        plan = await plan_agentic_action(
            dom_map=dom,
            user_message="اشتريلي الحاجه دي بسرعة",
        )
        assert plan.type == "plan"
        assert len(plan.steps) == 1
        assert plan.steps[0].action == "click"
        assert plan.steps[0].element_id == "btn-add-cart"
        assert plan.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_fast_path_with_non_ascii_element_id(self):
        dom = [
            {"id": "زر-الشراء-١", "tag": "button", "label": "أضف إلى السلة"},
        ]
        plan = await plan_agentic_action(
            dom_map=dom,
            user_message="حط في السلة",
        )
        assert plan.type == "plan"
        assert plan.steps[0].element_id == "زر-الشراء-١"
        assert plan.steps[0].action == "click"

    @pytest.mark.asyncio
    async def test_fast_path_double_click_detection_on_canonical_intent(self):
        dom = [
            {"id": "folder-home", "tag": "div", "role": "row", "label": "الصفحة الرئيسية"},
        ]
        plan = await plan_agentic_action(
            dom_map=dom,
            user_message="double click الصفحة الرئيسية",
        )
        assert plan.type == "plan"
        assert plan.steps[0].action == "double_click"
        assert plan.steps[0].element_id == "folder-home"


# ═══════════════════════════════════════════════════════════════════════════════
# 4. PROMPT MIRRORING & JSON PARSING ADVERSARIAL TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestPromptMirroringAndJsonValidityAdversarial:
    """Validates language mirroring directive on all 6 surfaces and JSON robustness."""

    ALL_PROMPT_MODULES = [
        agentic_planner,
        simplify_prompt,
        summary_prompt,
        scout,
        form_filler,
        planner,
    ]

    def test_all_six_surfaces_export_mirroring_directive(self):
        for mod in self.ALL_PROMPT_MODULES:
            assert hasattr(mod, "LANGUAGE_MIRRORING_DIRECTIVE"), (
                f"Module {mod.__name__} must export LANGUAGE_MIRRORING_DIRECTIVE"
            )
            val = getattr(mod, "LANGUAGE_MIRRORING_DIRECTIVE")
            assert "Egyptian colloquial Arabic" in val
            assert "not Modern Standard Arabic" in val
            assert "not a literal translation" in val

    def test_clean_json_str_with_arabic_and_markdown(self):
        # Markdown wrapped JSON containing Arabic text in thought and reply
        raw_llm_output = """```json
{
  "type": "conversation",
  "thought": "المستخدم بيسأل عن حالة الطلب، هرد عليه بالمصري",
  "reply": "تمام يا فندم، طلبك وصل وجاري تجهيزه حالاً!",
  "steps": []
}
```"""
        cleaned = _clean_json_str(raw_llm_output)
        parsed = json.loads(cleaned)
        assert parsed["type"] == "conversation"
        assert "المستخدم" in parsed["thought"]
        assert "يا فندم" in parsed["reply"]

    def test_clean_json_str_with_surrounding_conversational_arabic(self):
        raw_output = """أهلاً بك! إليك الرد المطلوب:
{
  "type": "plan",
  "thought": "الضغط على زر الاشتراك",
  "reply": "هندوس على زر الاشتراك دلوقتي",
  "steps": [
    {
      "action": "click",
      "element_id": "btn-sub",
      "description": "دوس على اشتراك"
    }
  ]
}
أتمنى أن أكون قد أفدتك!"""
        cleaned = _clean_json_str(raw_output)
        parsed = json.loads(cleaned)
        assert parsed["type"] == "plan"
        assert parsed["steps"][0]["action"] == "click"
        assert parsed["steps"][0]["element_id"] == "btn-sub"

    def test_agentic_plan_pydantic_validation_with_arabic_fields(self):
        payload = {
            "type": "plan",
            "thought": "تفكير باللغة العربية العامية",
            "reply": "رد ودود بالعامية المصرية",
            "steps": [
                {
                    "action": "click",
                    "element_id": "زر_١",
                    "description": "اضغط هنا",
                }
            ],
            "requires_confirmation": True,
            "confirmation_prompt": "هل أنت متأكد من الشراء بمبلغ ١٥٠ جنيه؟",
            "confirmation_options": ["نعم، كمل", "لا، الغي"],
            "pending_step": {
                "action": "click",
                "element_id": "زر_١",
                "description": "تأكيد الطلب",
            },
            "confirmation_success_message": "تم تأكيد طلبك بنجاح!",
        }
        plan = AgenticPlan(**payload)
        assert plan.type == "plan"
        assert plan.requires_confirmation is True
        assert "١٥٠ جنيه" in plan.confirmation_prompt
        assert plan.steps[0].element_id == "زر_١"


# ═══════════════════════════════════════════════════════════════════════════════
# 5. SYNTHETIC LANGUAGE SWITCH MILESTONE ADVERSARIAL TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyntheticLanguageSwitchMilestoneAdversarial:
    """Stress tests for locale matching and synthetic language switch milestone insertion."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "user_lang,detected_lang,should_insert",
        [
            # Same language family - NO switch milestone should be inserted
            ("ar-EG", "ar", False),
            ("ar", "ar-EG", False),
            ("ar-EG", "ar-SA", False),
            ("ar-eg", "AR-EG", False),
            ("AR-EG", "ar", False),
            ("en-US", "en", False),
            ("en", "en-US", False),
            ("en-US", "en-GB", False),
            ("EN-US", "en-us", False),
            # Language mismatch - MUST insert synthetic switch milestone
            ("ar-EG", "en", True),
            ("ar", "en-US", True),
            ("AR-eg", "EN-us", True),
            ("en-US", "ar", True),
            ("en", "ar-EG", True),
            ("EN", "AR-EG", True),
            # Missing or None - NO switch milestone
            (None, "ar", False),
            ("ar-EG", None, False),
            (None, None, False),
            ("", "ar", False),
            ("ar-EG", "", False),
        ],
    )
    async def test_locale_casing_and_matching_matrix(
        self, user_lang, detected_lang, should_insert
    ):
        milestones = await plan_goal(
            goal="Add paracetamol to cart",
            language=user_lang,
            detected_language=detected_lang,
        )
        assert len(milestones) >= 1

        has_switch = any("Switch the page language" in m.description for m in milestones)
        if should_insert:
            assert has_switch, (
                f"Expected synthetic switch milestone for user_lang='{user_lang}' vs "
                f"detected_lang='{detected_lang}', but none was found."
            )
            assert milestones[0].id == "m-0"
            assert f"Switch the page language to {user_lang}" in milestones[0].description
            assert milestones[0].is_final is False
            assert milestones[0].satisfied_by_navigation is False
            # Ensure following milestones are properly indexed m-1, m-2, ...
            for idx, m in enumerate(milestones[1:], start=1):
                assert m.id == f"m-{idx}"
        else:
            assert not has_switch, (
                f"Did NOT expect synthetic switch milestone for user_lang='{user_lang}' vs "
                f"detected_lang='{detected_lang}', but found one: {milestones[0].description}"
            )

    @pytest.mark.asyncio
    async def test_fallback_planner_inserts_switch_milestone_on_exception(self):
        """
        When plan_goal encounters an LLM exception and enters fallback mode,
        it must still insert the synthetic switch milestone if language mismatches.
        """
        with patch.object(llm_client, "call_llm", side_effect=RuntimeError("LLM offline")):
            milestones = await plan_goal(
                goal="Search for groceries",
                language="ar-EG",
                detected_language="en",
            )
            assert len(milestones) == 2
            assert milestones[0].id == "m-0"
            assert "Switch the page language to ar-EG" in milestones[0].description
            assert milestones[0].is_final is False
            assert milestones[1].id == "m-1"
            assert milestones[1].is_final is True

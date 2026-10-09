"""
Unit and Integration Tests for Agentic Planner (§Tracks N2a-wire, N2b-wire, L1-full)
backend/tests/test_agentic_planner.py

Validates:
1. Canonical intent resolution in agentic_planner.py before LLM / heuristic fallback.
2. Egyptian colloquial Arabic language mirroring directive in SYSTEM_PROMPT.
3. Preservation of JSON schema and output structures.
4. Language signal propagation from goal_step to planner.plan_goal.
5. Synthetic language switch milestone insertion and execution.
6. Mock scout detected_language population.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch
from starlette.testclient import TestClient

from app.main import app
from app.agent import agentic_planner
from app.agent.agentic_planner import (
    plan,
    plan_agentic_action,
    LANGUAGE_MIRRORING_DIRECTIVE,
    SYSTEM_PROMPT,
)
from app.agent import llm_client
from app.agent.planner import plan_goal, Milestone
from app.agent.scout import ScoutResult


EXPECTED_DIRECTIVE_SNIPPETS = [
    "Reply in the same language the user is using",
    "Egyptian colloquial Arabic",
    "not Modern Standard Arabic",
    "not a literal translation",
    "If unset, infer from script",
    "If mixed, mirror the mix",
]

DEMO_API_KEY = "atlas_live_demo_key_99999"


@pytest.fixture(autouse=True)
def clean_mock_llm():
    """Ensure clean mock LLM queue and history across tests."""
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


@pytest.fixture
def api_client():
    """FastAPI TestClient with mocked database validate_api_key."""
    from app.main import app
    from app.db.connection import get_db

    async def override_get_db():
        mock_db = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_API_KEY else None),
    ):
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.clear()


class TestAgenticPlannerCanonicalIntents:
    """Validates Track N2a-wire: Canonical intent matching before heuristic / LLM match."""

    @pytest.mark.asyncio
    async def test_canonical_add_to_cart_english(self):
        sample_dom = [
            {"id": "btn-add-cart", "tag": "button", "label": "Add to Cart"},
            {"id": "btn-search", "tag": "button", "label": "Search"},
        ]
        # Should resolve to click on btn-add-cart without needing LLM
        plan_res = await plan_agentic_action(sample_dom, "add to cart")
        assert plan_res.type == "plan"
        assert len(plan_res.steps) == 1
        assert plan_res.steps[0].action == "click"
        assert plan_res.steps[0].element_id == "btn-add-cart"
        assert plan_res.requires_confirmation is False
        assert "add_to_cart" in plan_res.thought

    @pytest.mark.asyncio
    async def test_canonical_add_to_cart_egyptian_arabic(self):
        sample_dom = [
            {"id": "atlas-btn-cart", "tag": "button", "label": "أضف إلى السلة"},
            {"id": "atlas-btn-home", "tag": "a", "label": "الرئيسية"},
        ]
        # Egyptian colloquial trigger: اشتريلي الحاجه دي
        plan_res = await plan_agentic_action(sample_dom, "اشتريلي الحاجه دي")
        assert plan_res.type == "plan"
        assert len(plan_res.steps) == 1
        assert plan_res.steps[0].action == "click"
        assert plan_res.steps[0].element_id == "atlas-btn-cart"
        assert "أضف إلى السلة" in plan_res.reply or "السلة" in plan_res.reply
        assert plan_res.requires_confirmation is False

    @pytest.mark.asyncio
    async def test_canonical_subscribe_egyptian_arabic(self):
        sample_dom = [
            {"id": "btn-newsletter", "tag": "button", "label": "اشتراك"},
            {"id": "inp-email", "tag": "input", "label": "البريد الإلكتروني"},
        ]
        # Egyptian colloquial trigger: دوس على اشتراك
        plan_res = await plan_agentic_action(sample_dom, "دوس على اشتراك")
        assert plan_res.type == "plan"
        assert len(plan_res.steps) == 1
        assert plan_res.steps[0].action == "click"
        assert plan_res.steps[0].element_id == "btn-newsletter"
        assert "subscribe" in plan_res.thought

    @pytest.mark.asyncio
    async def test_canonical_go_home_egyptian_arabic(self):
        sample_dom = [
            {"id": "btn-home", "tag": "a", "label": "الصفحة الرئيسية"},
            {"id": "btn-help", "tag": "a", "label": "مساعدة"},
        ]
        # Egyptian colloquial trigger: وديني الرئيسية
        plan_res = await plan_agentic_action(sample_dom, "وديني الرئيسية")
        assert plan_res.type == "plan"
        assert len(plan_res.steps) == 1
        assert plan_res.steps[0].action == "click"
        assert plan_res.steps[0].element_id == "btn-home"
        assert "go_home" in plan_res.thought

    @pytest.mark.asyncio
    async def test_canonical_intent_resolves_before_llm(self):
        sample_dom = [
            {"id": "btn-cart-1", "tag": "button", "resolved_label": "Buy Now"},
        ]
        # If LLM raises an unhandled exception, canonical intent must resolve before call_llm
        with patch("app.agent.llm_client.call_llm", side_effect=RuntimeError("LLM should not be called")):
            plan_res = await plan(sample_dom, "buy now")
            assert plan_res.type == "plan"
            assert len(plan_res.steps) == 1
            assert plan_res.steps[0].element_id == "btn-cart-1"

    @pytest.mark.asyncio
    async def test_canonical_intent_resolves_in_fallback_path(self):
        sample_dom = [
            {"id": "btn-cart-2", "tag": "button", "resolved_label": "Purchase"},
        ]
        with patch("app.agent.llm_client.call_llm", side_effect=llm_client.LLMError("401 Unauthorized")):
            plan_res = await plan(sample_dom, "purchase")
            assert plan_res.type == "plan"
            assert len(plan_res.steps) == 1
            assert plan_res.steps[0].element_id == "btn-cart-2"

    @pytest.mark.asyncio
    async def test_canonical_intent_without_matching_dom_falls_back(self):
        sample_dom = [
            {"id": "btn-other", "tag": "button", "label": "Other Setting"},
        ]
        # "اشتريلي الحاجه دي" has no cart DOM node -> does not match canonical DOM label
        with patch("app.agent.llm_client.call_llm", side_effect=llm_client.LLMError("401 Unauthorized")):
            plan_res = await plan(sample_dom, "اشتريلي الحاجه دي")
            # Falls back to conversational response since no DOM matches
            assert plan_res.type == "conversation"
            assert len(plan_res.steps) == 0

    @pytest.mark.asyncio
    async def test_double_click_detection_on_canonical_intent(self):
        sample_dom = [
            {"id": "btn-cart-3", "tag": "button", "label": "Add to Cart"},
        ]
        plan_res = await plan(sample_dom, "double click add to cart")
        assert plan_res.type == "plan"
        assert len(plan_res.steps) == 1
        assert plan_res.steps[0].action == "double_click"
        assert plan_res.steps[0].click_count == 2
        assert plan_res.steps[0].element_id == "btn-cart-3"


class TestAgenticPlannerSystemPromptDirective:
    """Validates Track N2b-wire: Egyptian Arabic mirroring directive and schema."""

    def test_system_prompt_contains_egyptian_arabic_directive(self):
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in SYSTEM_PROMPT, f"Expected '{snippet}' in SYSTEM_PROMPT"

    def test_language_mirroring_directive_constant(self):
        assert hasattr(agentic_planner, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in LANGUAGE_MIRRORING_DIRECTIVE

    def test_system_prompt_json_schema_preserved(self):
        """Verifies that all JSON schema fields and action vocabulary remain verbatim."""
        assert '"type": "plan" | "conversation"' in SYSTEM_PROMPT
        assert '"thought":' in SYSTEM_PROMPT
        assert '"reply":' in SYSTEM_PROMPT
        assert '"steps":' in SYSTEM_PROMPT
        assert '"action": "click" | "open" | "double_click" | "triple_click" | "fill" | "scroll" | "focus"' in SYSTEM_PROMPT
        assert '"element_id":' in SYSTEM_PROMPT
        assert '"value":' in SYSTEM_PROMPT
        assert '"click_count":' in SYSTEM_PROMPT
        assert '"description":' in SYSTEM_PROMPT
        assert '"delay_ms":' in SYSTEM_PROMPT
        assert '"requires_confirmation":' in SYSTEM_PROMPT
        assert '"confirmation_prompt":' in SYSTEM_PROMPT
        assert '"confirmation_options":' in SYSTEM_PROMPT
        assert '"pending_step":' in SYSTEM_PROMPT
        assert '"confirmation_success_message":' in SYSTEM_PROMPT


class TestGoalStepLanguageIntegration:
    """Validates Track L1-full: Signal propagation in chat.py & synthetic milestone insertion."""

    def test_goal_step_endpoint_passes_language_signals_to_plan_goal(self, api_client):
        payload = {
            "goal": "Buy fresh groceries",
            "current_url": "https://example.com/groceries",
            "language": "ar-EG",
            "dom_map": [
                {"id": "btn-item", "tag": "button", "resolved_label": "Apples"},
            ],
            "api_key": DEMO_API_KEY,
        }

        captured_kwargs = {}

        async def mock_plan_goal(**kwargs):
            captured_kwargs.update(kwargs)
            return [
                Milestone(
                    id="m-0",
                    description=f"Switch the page language to {kwargs.get('language')}",
                    is_final=False,
                    satisfied_by_navigation=False,
                    branch_id="b-0",
                ),
                Milestone(
                    id="m-1",
                    description="Buy fresh groceries",
                    is_final=True,
                    satisfied_by_navigation=False,
                    branch_id="b-0",
                ),
            ]

        with patch("app.routes.chat.plan_goal", side_effect=mock_plan_goal):
            res = api_client.post("/v1/chat/goal_step", json=payload)
            assert res.status_code == 200
            data = res.json()

            # Confirm language signals were passed into plan_goal
            assert captured_kwargs.get("language") == "ar-EG"
            assert captured_kwargs.get("detected_language") in ("en", "ar", None)

            # Confirm synthetic language switch milestone was set as active
            milestones = data["goal_state"]["milestones"]
            assert len(milestones) == 2
            assert milestones[0]["description"] == "Switch the page language to ar-EG"
            assert milestones[0]["satisfied_by_navigation"] is False
            assert milestones[0]["status"] == "active"
            assert data["goal_state"]["language"] == "ar-EG"

    def test_synthetic_milestone_inserted_when_languages_differ(self, api_client):
        payload = {
            "goal": "Order a laptop",
            "current_url": "https://example.com/store",
            "language": "ar-EG",
            "dom_map": [
                {"id": "btn-laptop", "tag": "button", "resolved_label": "Laptops"},
            ],
            "page_text": "Welcome to our electronics store.",
            "api_key": DEMO_API_KEY,
        }

        # Mock scout returns detected_language="en"
        scout_mock = ScoutResult(
            page_kind="other",
            blockers=[],
            form_inventory=[],
            primary_cta=None,
            summary="Electronics store",
            detected_language="en",
        )

        with patch("app.routes.chat.classify_page", new=AsyncMock(return_value=scout_mock)):
            res = api_client.post("/v1/chat/goal_step", json=payload)
            assert res.status_code == 200
            data = res.json()

            milestones = data["goal_state"]["milestones"]
            assert len(milestones) >= 1
            # First milestone should be the synthetic language switch milestone
            assert "Switch the page language to ar-EG" in milestones[0]["description"]
            assert milestones[0]["satisfied_by_navigation"] is False
            assert milestones[0]["status"] == "active"

    def test_no_synthetic_milestone_when_language_matches_detected(self, api_client):
        payload = {
            "goal": "طلب لابتوب",
            "current_url": "https://example.com/ar/store",
            "language": "ar-EG",
            "dom_map": [
                {"id": "btn-laptop", "tag": "button", "resolved_label": "أجهزة لابتوب"},
            ],
            "page_text": "أهلا بكم في متجر الإلكترونيات",
            "api_key": DEMO_API_KEY,
        }

        # Mock scout returns detected_language="ar"
        scout_mock = ScoutResult(
            page_kind="other",
            blockers=[],
            form_inventory=[],
            primary_cta=None,
            summary="متجر الإلكترونيات",
            detected_language="ar",
        )

        with patch("app.routes.chat.classify_page", new=AsyncMock(return_value=scout_mock)):
            res = api_client.post("/v1/chat/goal_step", json=payload)
            assert res.status_code == 200
            data = res.json()

            milestones = data["goal_state"]["milestones"]
            assert len(milestones) >= 1
            # Should NOT have synthetic switch milestone because page is already in Arabic
            assert not any("Switch the page language" in m["description"] for m in milestones)


class TestMockScoutLanguageDetection:
    """Validates Track L1-full: detected_language population in mock scout response."""

    @pytest.mark.asyncio
    async def test_mock_scout_populates_detected_language_arabic(self):
        from app.agent.scout import classify_page

        arabic_dom = [
            {"id": "btn-1", "tag": "button", "resolved_label": "أضف إلى السلة"},
        ]
        res = await classify_page(
            dom_map=arabic_dom,
            current_url="https://example.com/ar",
            page_text="مرحبا بكم في موقعنا الإلكتروني لشراء أفضل المنتجات",
        )
        assert res.detected_language == "ar"

    @pytest.mark.asyncio
    async def test_mock_scout_populates_detected_language_english(self):
        from app.agent.scout import classify_page

        english_dom = [
            {"id": "btn-1", "tag": "button", "resolved_label": "Add to Cart"},
        ]
        res = await classify_page(
            dom_map=english_dom,
            current_url="https://example.com/en",
            page_text="Welcome to our website for purchasing items",
        )
        assert res.detected_language == "en"

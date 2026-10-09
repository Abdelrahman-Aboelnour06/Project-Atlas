"""
Unit Tests for Wave 1 Prompt Mirroring Batch (N2b)
Validates language mirroring directives, JSON schema preservation, and ScoutResult contracts
across all 5 prompt surfaces:
- backend/app/agent/simplify_prompt.py
- backend/app/agent/summary_prompt.py
- backend/app/agent/scout.py
- backend/app/agent/form_filler.py
- backend/app/agent/planner.py
"""

import json
import re
import pytest
from unittest.mock import AsyncMock, patch

from app.agent import simplify_prompt
from app.agent import summary_prompt
from app.agent import scout
from app.agent import form_filler
from app.agent import planner
from app.agent import agentic_planner
from app.agent.scout import ScoutResult, classify_page
from app.agent.planner import plan_goal, Milestone
from app.agent.form_filler import plan_form_fill, FormPlan
from app.models.dom import DomNode


EXPECTED_DIRECTIVE_SNIPPETS = [
    "Reply in the same language the user is using",
    "Egyptian colloquial Arabic",
    "not Modern Standard Arabic",
    "not a literal translation",
    "If unset, infer from script",
    "If mixed, mirror the mix",
]


class TestSimplifyPromptMirroring:
    """Tests for simplify_prompt.py directive and schema preservation."""

    def test_simplify_system_prompt_contains_mirroring_directive(self):
        prompt = simplify_prompt.SYSTEM_PROMPT
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in simplify SYSTEM_PROMPT"

    def test_simplify_prompt_constant_matches_directive(self):
        assert hasattr(simplify_prompt, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in simplify_prompt.LANGUAGE_MIRRORING_DIRECTIVE

    def test_simplify_json_schema_preserved(self):
        """Verifies that the JSON array output schema is intact."""
        prompt = simplify_prompt.SYSTEM_PROMPT
        assert '"element_id":' in prompt
        assert '"label":' in prompt
        assert '"category":' in prompt
        assert '"group":' in prompt
        assert '"emoji":' in prompt
        # Verify allowed categories
        for cat in simplify_prompt.VALID_CATEGORIES:
            assert cat in prompt

    def test_build_simplify_prompt_output(self):
        dom_map = [
            {"id": "btn-1", "tag": "button", "resolved_label": "Submit"},
            {"id": "inp-1", "tag": "input", "resolved_label": "Search"},
        ]
        sys_prompt, user_prompt = simplify_prompt.build_simplify_prompt(dom_map)
        assert "accessibility assistant" in sys_prompt
        assert "Egyptian colloquial Arabic" in sys_prompt
        assert "INTERACTIVE ELEMENTS (2 total):" in user_prompt

    def test_build_simplify_prompt_with_language_parameter(self):
        dom_map = [{"id": "btn-1", "tag": "button", "resolved_label": "Submit"}]
        sys_prompt, user_prompt = simplify_prompt.build_simplify_prompt(dom_map, language="ar-EG")
        assert "User preferred language: ar-EG" in sys_prompt
        assert "Egyptian colloquial Arabic" in sys_prompt


class TestSummaryPromptMirroring:
    """Tests for summary_prompt.py directive and truncation preservation."""

    def test_summary_prompt_contains_mirroring_directive(self):
        prompt = summary_prompt.build_summary_prompt("Some page content", "https://example.com")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in summary prompt"

    def test_summary_prompt_constant_matches_directive(self):
        assert hasattr(summary_prompt, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in summary_prompt.LANGUAGE_MIRRORING_DIRECTIVE

    def test_summary_prompt_with_language_parameter(self):
        prompt = summary_prompt.build_summary_prompt(
            "Some content", "https://example.com", language="ar-EG"
        )
        assert "USER LANGUAGE PREFERENCE: ar-EG" in prompt
        assert "Egyptian colloquial Arabic" in prompt

    def test_summary_preserves_page_text_truncation(self):
        long_text = "T" * 5000
        prompt = summary_prompt.build_summary_prompt(long_text, "https://example.com")
        assert "T" * 1000 in prompt
        assert "T" * 1001 not in prompt


class TestScoutPromptAndContract:
    """Tests for scout.py directive, ScoutResult.detected_language, and JSON schema."""

    def test_scout_system_prompt_contains_mirroring_directive(self):
        prompt = scout.SCOUT_SYSTEM_PROMPT
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in SCOUT_SYSTEM_PROMPT"

    def test_scout_prompt_constant_matches_directive(self):
        assert hasattr(scout, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in scout.LANGUAGE_MIRRORING_DIRECTIVE

    def test_scout_result_model_has_detected_language_field(self):
        # Default value must be None
        res_default = ScoutResult()
        assert res_default.detected_language is None
        assert res_default.page_kind == "other"
        assert res_default.blockers == []

        # Explicit value
        res_ar = ScoutResult(detected_language="ar")
        assert res_ar.detected_language == "ar"

        # Roundtrip serialization
        dumped = res_ar.model_dump()
        assert dumped["detected_language"] == "ar"
        restored = ScoutResult.model_validate(dumped)
        assert restored.detected_language == "ar"

    def test_scout_json_schema_preserved(self):
        prompt = scout.SCOUT_SYSTEM_PROMPT
        assert '"page_kind":' in prompt
        assert '"blockers":' in prompt
        assert '"form_inventory":' in prompt
        assert '"primary_cta":' in prompt
        assert '"summary":' in prompt
        assert '"detected_language":' in prompt

    def test_scout_heuristic_language_detection_arabic(self):
        arabic_dom = [
            {"id": "btn-1", "resolved_label": "تسجيل الدخول", "tag": "button"},
            {"id": "inp-1", "resolved_label": "اسم المستخدم", "tag": "input"},
        ]
        res = scout._analyze_dom_heuristics(
            dom_nodes=arabic_dom,
            current_url="https://example.com/ar/login",
            page_text="مرحبا بك في الموقع. يرجى تسجيل الدخول للمتابعة.",
        )
        assert res.detected_language == "ar"

    def test_scout_heuristic_language_detection_english(self):
        english_dom = [
            {"id": "btn-1", "resolved_label": "Sign In", "tag": "button"},
            {"id": "inp-1", "resolved_label": "Username", "tag": "input"},
        ]
        res = scout._analyze_dom_heuristics(
            dom_nodes=english_dom,
            current_url="https://example.com/en/login",
            page_text="Welcome to the site. Please sign in to continue.",
        )
        assert res.detected_language == "en"

    @pytest.mark.asyncio
    async def test_classify_page_parses_detected_language(self):
        mock_llm_reply = """{
            "page_kind": "form",
            "blockers": [],
            "form_inventory": ["login-form"],
            "primary_cta": "btn-login",
            "summary": "Login page",
            "detected_language": "ar"
        }"""
        with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_llm_reply
            result = await classify_page(
                current_url="https://example.com/login",
                dom_map=[DomNode(id="btn-login", tag="button", resolved_label="دخول")],
                page_text="صفحة الدخول",
                language="ar-EG",
            )
            assert result.detected_language == "ar"
            assert result.page_kind == "form"


class TestFormFillerPromptMirroring:
    """Tests for form_filler.py directive and schema preservation."""

    def test_form_filler_prompt_contains_mirroring_directive(self):
        prompt = form_filler.FORM_FILLER_SYSTEM_PROMPT
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in FORM_FILLER_SYSTEM_PROMPT"

    def test_form_filler_prompt_constant_matches_directive(self):
        assert hasattr(form_filler, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in form_filler.LANGUAGE_MIRRORING_DIRECTIVE

    def test_form_filler_json_schema_preserved(self):
        prompt = form_filler.FORM_FILLER_SYSTEM_PROMPT
        assert '"form_id":' in prompt
        assert '"fields":' in prompt
        assert '"ref":' in prompt
        assert '"action":' in prompt
        assert '"value":' in prompt
        assert '"source":' in prompt
        assert '"confidence":' in prompt
        assert '"rationale":' in prompt
        assert '"submit_ref":' in prompt
        assert '"missing_required":' in prompt
        assert '"blockers":' in prompt

    @pytest.mark.asyncio
    async def test_plan_form_fill_accepts_language_parameter(self):
        nodes = [
            DomNode(id="inp-name", ref="ref_name", tag="input", type="text", name="username", resolved_label="Username"),
            DomNode(id="btn-sub", ref="ref_sub", tag="button", type="submit", resolved_label="Submit"),
        ]
        mock_reply = """{
            "form_id": "main-form",
            "fields": [{"ref": "ref_name", "action": "fill", "value": "testuser", "source": "user"}],
            "submit_ref": "ref_sub",
            "missing_required": [],
            "blockers": []
        }"""
        with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_reply
            plan = await plan_form_fill(
                form_id="main-form",
                dom_nodes=nodes,
                goal="Fill username",
                language="ar-EG",
            )
            assert isinstance(plan, FormPlan)
            assert len(plan.fields) == 1
            # Verify call_llm received language in prompt
            call_args = mock_llm.call_args[1]
            assert "REQUESTED USER LANGUAGE: ar-EG" in call_args["user_prompt"]


class TestPlannerPromptMirroring:
    """Tests for planner.py directive, synthetic switch milestone, and schema preservation."""

    def test_planner_prompt_contains_mirroring_directive(self):
        prompt = planner.PLANNER_SYSTEM_PROMPT
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in PLANNER_SYSTEM_PROMPT"

    def test_planner_prompt_constant_matches_directive(self):
        assert hasattr(planner, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in planner.LANGUAGE_MIRRORING_DIRECTIVE

    def test_planner_json_schema_preserved(self):
        prompt = planner.PLANNER_SYSTEM_PROMPT
        assert '"thought":' in prompt
        assert '"milestones":' in prompt
        assert '"id":' in prompt
        assert '"description":' in prompt
        assert '"is_final":' in prompt
        assert '"satisfied_by_navigation":' in prompt
        assert '"branch_id":' in prompt
        assert '"target_url":' in prompt
        assert '"success_criteria":' in prompt

    @pytest.mark.asyncio
    async def test_planner_synthetic_language_switch_milestone_on_mismatch(self):
        """When requested language differs from detected_language, inserts switch milestone."""
        mock_response = """{
            "milestones": [
                {
                    "id": "m-0",
                    "description": "Find products",
                    "is_final": true,
                    "satisfied_by_navigation": false,
                    "branch_id": "b-0",
                    "success_criteria": "Products found"
                }
            ]
        }"""
        with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_response
            milestones = await plan_goal(
                goal="Search for groceries",
                language="ar-EG",
                detected_language="en",
            )
            assert len(milestones) == 2
            assert milestones[0].id == "m-0"
            assert "Switch the page language to ar-EG" in milestones[0].description
            assert milestones[0].is_final is False
            assert milestones[0].satisfied_by_navigation is False
            assert milestones[1].id == "m-1"
            assert milestones[1].is_final is True

    @pytest.mark.asyncio
    async def test_planner_no_switch_milestone_when_languages_match(self):
        """When requested language matches detected_language, does not insert switch milestone."""
        mock_response = """{
            "milestones": [
                {
                    "id": "m-0",
                    "description": "Find products",
                    "is_final": true,
                    "satisfied_by_navigation": false,
                    "branch_id": "b-0",
                    "success_criteria": "Products found"
                }
            ]
        }"""
        with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_response
            milestones = await plan_goal(
                goal="Search for groceries",
                language="ar-EG",
                detected_language="ar",
            )
            assert len(milestones) == 1
            assert milestones[0].id == "m-0"
            assert "Switch the page language" not in milestones[0].description


class TestAgenticPlannerPromptMirroring:
    """Tests for agentic_planner.py language mirroring directive and schema preservation (6th surface)."""

    def test_agentic_planner_system_prompt_contains_mirroring_directive(self):
        prompt = agentic_planner.SYSTEM_PROMPT
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in prompt, f"Expected '{snippet}' in agentic_planner SYSTEM_PROMPT"

    def test_agentic_planner_prompt_constant_matches_directive(self):
        assert hasattr(agentic_planner, "LANGUAGE_MIRRORING_DIRECTIVE")
        for snippet in EXPECTED_DIRECTIVE_SNIPPETS:
            assert snippet in agentic_planner.LANGUAGE_MIRRORING_DIRECTIVE

    def test_agentic_planner_json_schema_preserved(self):
        prompt = agentic_planner.SYSTEM_PROMPT
        assert '"type": "plan" | "conversation"' in prompt
        assert '"thought":' in prompt
        assert '"reply":' in prompt
        assert '"steps":' in prompt
        assert '"action": "click" | "open" | "double_click" | "triple_click" | "fill" | "scroll" | "focus"' in prompt
        assert '"element_id":' in prompt
        assert '"value":' in prompt
        assert '"click_count":' in prompt
        assert '"description":' in prompt
        assert '"delay_ms":' in prompt
        assert '"requires_confirmation":' in prompt
        assert '"confirmation_prompt":' in prompt
        assert '"confirmation_options":' in prompt
        assert '"pending_step":' in prompt
        assert '"confirmation_success_message":' in prompt


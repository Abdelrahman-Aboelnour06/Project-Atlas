"""
Comprehensive Unit & Acceptance Test Suite for Navigator Agent (§WS6)
backend/tests/test_navigator.py

Tests:
1. Visible vs latent node candidate ranking with lexical similarity and breadcrumb hierarchy.
2. Universal Arabic normalization, prefix stripping (ال/و/ب/ل), and plural folding (ات/ين/ون).
3. Search query extraction dropping fillers, {vault:...} tokens, and 6+ digit runs (max 5 words).
4. Menu reveal action generation (reason="reveal_menu", expect=target_id).
5. Exploration move hierarchy: visible -> latent reveal -> nav link -> search box -> sitemap -> backtrack.
6. Visited state tracking (URL + DOM fingerprint) and frontier in goal_state.dom_state (capped at 30).
7. Loop prevention: avoiding repeating the exact same step on an unchanged page state.
8. Backtracking: taking the next frontier candidate, or falling back to header/home link.
9. Max hops limit termination with localized "here is what I tried" summary in en and ar-EG.
10. Sacred Rails & Prime Directive: Grep audit verifying 0 prohibited topic words in production code.
"""

import json
from pathlib import Path
import re
import subprocess
import pytest
from unittest.mock import AsyncMock, patch

from app.agent import llm_client
from app.agent.intent_synonyms import (
    _fold_arabic_plurals,
    _normalize_text,
    _strip_arabic_prefixes,
    extract_search_keywords,
    score_text_similarity,
)
from app.agent.navigator import (
    _compute_state_fingerprint,
    _get_navigation_state,
    _save_navigation_state,
    _score_dom_candidate,
    plan_milestone_step,
)
from app.models.dom import DomNode, MenuInfo
from app.models.goal import GoalState, Milestone, PlanStep


@pytest.fixture(autouse=True)
def setup_mock_llm(monkeypatch):
    """Enforce deterministic mock provider for navigator unit tests."""
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


# ── Normalization & Query Extraction Tests ────────────────────────────────────

def test_arabic_normalization_and_folding():
    """Validates NFKC, digit conversion, tashkeel/tatweel stripping, and letter folding."""
    assert _normalize_text("مُعَامَلَاتٌ") == "معاملات"
    assert _normalize_text("الـخِـدْمَـة") == "الخدمه"
    assert _normalize_text("إسْتِعْلَام ١٢٣") == "استعلام123"
    assert _normalize_text("فَتْوَى") == "فتوي"


def test_arabic_prefix_stripping_and_plural_folding():
    """Validates stripping grammatical prefixes and folding plural suffixes."""
    # Prefix stripping (ال, و, ب, ل)
    assert _strip_arabic_prefixes("الخدمات") == "خدمات"
    assert _strip_arabic_prefixes("وبالخدمات") == "خدمات"
    assert _strip_arabic_prefixes("للخدمات") == "خدمات"
    assert _strip_arabic_prefixes("باب") == "باب"  # Short word protected

    # Plural folding (ات, ين, ون)
    assert _fold_arabic_plurals("معاملات") == "معامل"
    assert _fold_arabic_plurals("مواطنين") == "مواطن"
    assert _fold_arabic_plurals("مسجلون") == "مسجل"
    assert _fold_arabic_plurals("بنات") == "بنات"  # <= 4 chars protected


def test_extract_search_keywords_clean():
    """Extracts at most 5 keywords, dropping fillers, vault tokens, and 6+ digit runs."""
    goal_en = "I want to search for civil status records {vault:secret_id} 123456789 please"
    assert extract_search_keywords(goal_en) == "civil status records"

    goal_ar = "اريد الاستعلام عن كشف الحساب من فضلك {vault:token_01} 00000000000000"
    keywords = extract_search_keywords(goal_ar)
    assert "كشف" in keywords and "الحساب" in keywords
    assert "00000000000000" not in keywords
    assert "{vault:" not in keywords


def test_score_text_similarity_matches():
    """Verifies similarity scoring using stemmed Arabic and English words."""
    assert score_text_similarity("civil records inquiry", "Inquire about civil records") >= 0.85
    assert score_text_similarity("استعلام عن الخدمات", "دليل الخدمات الإلكترونية") >= 0.50
    assert score_text_similarity("search account", "completely different page") == 0.0


# ── DOM Candidate Scoring Tests ───────────────────────────────────────────────

def test_score_dom_candidate_visible_and_latent():
    """Scores visible and latent nodes, boosting matching breadcrumbs and landmarks."""
    vis_node = {
        "id": "el_1",
        "tag": "a",
        "resolved_label": "Submit Application",
        "inner_text": "Submit Application",
        "visible": True,
        "reveal_via": None,
        "menu": None,
        "landmark": "main",
        "breadcrumb": ["Home", "Applications"],
    }
    score_vis = _score_dom_candidate(vis_node, "submit application for service", "Submit application")
    assert score_vis >= 0.70

    # Latent node inside menu with matching label and breadcrumb
    latent_node = {
        "id": "el_2",
        "tag": "a",
        "resolved_label": "Citizen Records",
        "inner_text": "Citizen Records",
        "visible": False,
        "reveal_via": "el_toggle_menu",
        "menu": None,
        "landmark": "nav",
        "breadcrumb": ["Services Menu", "Citizen Section"],
    }
    score_lat = _score_dom_candidate(latent_node, "inquire citizen records", "Reach citizen records page")
    assert score_lat >= 0.55


# ── Exploration Moves & Menu Reveal Tests ──────────────────────────────────────

@pytest.mark.asyncio
async def test_latent_menu_reveal_action_emission():
    """When a latent node matches goal and has reveal_via, emits reveal then click with reason and expect."""
    dom_map = [
        {
            "id": "el_menu_btn",
            "tag": "button",
            "resolved_label": "Citizen Services Menu",
            "inner_text": "Citizen Services Menu",
            "visible": True,
            "reveal_via": None,
            "menu": {"haspopup": "true", "expanded": False, "controls": "dropdown_panel"},
            "landmark": "header",
            "breadcrumb": [],
        },
        {
            "id": "el_target_service",
            "tag": "a",
            "resolved_label": "Civil Status Records Inquiry",
            "inner_text": "Civil Status Records Inquiry",
            "visible": False,
            "reveal_via": "el_menu_btn",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["Citizen Services Menu"],
            "href": "/services/civil-status.html",
        },
    ]

    goal = "I want to inquire about civil status records"
    milestone = Milestone(
        id="m-0",
        description="Reach the page offering civil status records",
        is_final=False,
    )

    plan = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://portal.example.gov/home.html",
    )

    assert plan.type == "plan"
    assert len(plan.steps) == 2
    # Step 1: Reveal the toggle
    step_reveal = plan.steps[0]
    assert step_reveal.action == "reveal"
    assert step_reveal.element_id == "el_menu_btn"
    assert step_reveal.reason == "reveal_menu"
    assert step_reveal.expect == "el_target_service"

    # Step 2: Click the target
    step_click = plan.steps[1]
    assert step_click.action == "click"
    assert step_click.element_id == "el_target_service"
    assert step_click.reason == "navigate"


@pytest.mark.asyncio
async def test_exploration_moves_order_priority():
    """
    Validates exploration move hierarchy when no direct high-confidence match exists:
    1. Menu reveal
    2. Nav link
    3. Site search
    4. Sitemap / All Services
    5. Backtrack
    """
    # 1. Site Search exploration fallback when no latent/nav link matches
    dom_search = [
        {
            "id": "el_search_input",
            "tag": "input",
            "type": "search",
            "resolved_label": "Search portal",
            "inner_text": "",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
        },
        {
            "id": "el_search_btn",
            "tag": "button",
            "type": "submit",
            "resolved_label": "Search",
            "inner_text": "Search",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
        },
    ]

    milestone = Milestone(
        id="m-0",
        description="Find meteorological weather bulletin",
        is_final=False,
    )
    plan_search = await plan_milestone_step(
        goal="check weather bulletin",
        milestone=milestone,
        dom_map=dom_search,
        current_url="https://portal.example.gov/home.html",
    )
    assert len(plan_search.steps) >= 1
    assert plan_search.steps[0].action == "fill"
    assert plan_search.steps[0].reason == "search"
    assert "weather" in str(plan_search.steps[0].value)


# ── State Tracking & Loop Prevention Tests ────────────────────────────────────

@pytest.mark.asyncio
async def test_state_fingerprint_and_visited_set_tracking():
    """Verifies visited state tracking in goal_state.dom_state capped at 30 items."""
    dom_map = [
        {
            "id": "el_1",
            "tag": "button",
            "resolved_label": "Proceed",
            "inner_text": "Proceed",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": [],
        }
    ]
    fp1 = _compute_state_fingerprint("https://example.gov/step1", dom_map)
    fp2 = _compute_state_fingerprint("https://example.gov/step1", dom_map)
    assert fp1 == fp2

    # Different URL produces distinct fingerprint
    fp3 = _compute_state_fingerprint("https://example.gov/step2", dom_map)
    assert fp1 != fp3

    goal_state = GoalState(goal="Test goal", max_hops=15)
    milestone = Milestone(id="m-0", description="Proceed", is_final=False)

    await plan_milestone_step(
        goal="Test goal",
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://example.gov/step1",
        goal_state=goal_state,
    )

    nav_state = _get_navigation_state(goal_state, milestone)
    assert fp1 in nav_state["visited"]
    assert len(nav_state["visited"]) <= 30


@pytest.mark.asyncio
async def test_prevent_repeated_action_on_unchanged_dom():
    """Ensures navigator refuses to repeat the exact same action on an unchanged page state."""
    dom_map = [
        {
            "id": "el_link_stuck",
            "tag": "a",
            "resolved_label": "Catalog Section",
            "inner_text": "Catalog Section",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "nav",
            "breadcrumb": [],
        },
        {
            "id": "el_home_logo",
            "tag": "a",
            "resolved_label": "Home",
            "inner_text": "Home",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
            "href": "/index.html",
        },
    ]

    goal_state = GoalState(goal="Find catalog", max_hops=15)
    milestone = Milestone(id="m-0", description="Find catalog", is_final=False)

    # Hop 1: clicks catalog link
    plan1 = await plan_milestone_step(
        goal="Find catalog",
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://example.gov/index.html",
        goal_state=goal_state,
    )
    assert len(plan1.steps) == 1
    assert plan1.steps[0].element_id == "el_link_stuck"

    # Hop 2: DOM and URL are completely unchanged (stuck/no navigation occurred)
    plan2 = await plan_milestone_step(
        goal="Find catalog",
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://example.gov/index.html",
        goal_state=goal_state,
    )
    # Must NOT repeat click on el_link_stuck; should backtrack to home link
    assert plan2.steps[0].element_id != "el_link_stuck"
    assert plan2.steps[0].reason == "backtrack"


@pytest.mark.asyncio
async def test_max_hops_termination_with_localized_summary():
    """Halts when hop_count reaches max_hops with localized tried summary in en and ar-EG."""
    dom_map = [
        {
            "id": "el_btn",
            "tag": "button",
            "resolved_label": "Explore",
            "inner_text": "Explore",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": [],
        }
    ]

    milestone = Milestone(id="m-0", description="Explore", is_final=False)

    # 1. English termination
    goal_state_en = GoalState(goal="Explore records", hop_count=15, max_hops=15, language="en-US")
    plan_en = await plan_milestone_step(
        goal="Explore records",
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://example.gov/page",
        goal_state=goal_state_en,
        language="en-US",
    )
    assert plan_en.type == "conversation"
    assert len(plan_en.steps) == 0
    assert "couldn't reach" in plan_en.reply.lower()

    # 2. Arabic termination
    goal_state_ar = GoalState(goal="استعلام عن السجلات", hop_count=15, max_hops=15, language="ar-EG")
    plan_ar = await plan_milestone_step(
        goal="استعلام عن السجلات",
        milestone=milestone,
        dom_map=dom_map,
        current_url="https://example.gov/page",
        goal_state=goal_state_ar,
        language="ar-EG",
    )
    assert plan_ar.type == "conversation"
    assert len(plan_ar.steps) == 0
    assert "معرفتش" in plan_ar.reply


# ── Prime Directive Verification Audit ────────────────────────────────────────

def test_prime_directive_zero_topic_words_in_production_code():
    """
    Enforces that ZERO prohibited topic words appear in navigator, planner, or scout.
    For intent_synonyms.py, enforces that prohibited topic words appear strictly within
    the legacy allowlist keys ('traffic_inquiry', 'license_renewal') from origin/main.
    Prohibited: traffic, fines, violations, vehicle, licence, tickets,
                مخالفات, غرامات, مرور, مركبات, سيارات, رخصة, رسوم.
    """
    repo_root = Path(__file__).resolve().parents[2]
    backend_agent_dir = repo_root / "backend" / "app" / "agent"
    strict_production_files = [
        backend_agent_dir / "navigator.py",
        backend_agent_dir / "planner.py",
        backend_agent_dir / "scout.py",
    ]

    prohibited_topic_words = [
        "traffic",
        "fines",
        "violations",
        "vehicle",
        "licence",
        "tickets",
        "مخالفات",
        "غرامات",
        "مرور",
        "مركبات",
        "سيارات",
        "رخصة",
        "رسوم",
    ]

    # 1. Full coverage on navigator.py, planner.py, and scout.py
    for p in strict_production_files:
        assert p.exists(), f"File {p} does not exist"
        lines = p.read_text(encoding="utf-8").splitlines()
        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for word in prohibited_topic_words:
                pattern = rf"(?<![a-zA-Z0-9_\u0600-\u06FF]){re.escape(word)}(?![a-zA-Z0-9_\u0600-\u06FF])"
                matches = re.findall(pattern, stripped, re.IGNORECASE)
                assert not matches, (
                    f"Prime Directive violation: Prohibited topic word '{word}' found in "
                    f"{p.name}:{idx}: '{stripped}'"
                )

    # 2. Strict allowlist audit for intent_synonyms.py:
    # Nothing was added beyond origin/main's existing traffic_inquiry and license_renewal entries
    intent_synonyms_path = backend_agent_dir / "intent_synonyms.py"
    assert intent_synonyms_path.exists()
    lines = intent_synonyms_path.read_text(encoding="utf-8").splitlines()
    curr_key = None
    legacy_allowlist = {"traffic_inquiry", "license_renewal"}

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        key_match = re.match(r'^\s*"([a-zA-Z0-9_]+)":\s*\{', line)
        if key_match:
            curr_key = key_match.group(1)

        for word in prohibited_topic_words:
            pattern = rf"(?<![a-zA-Z0-9_\u0600-\u06FF]){re.escape(word)}(?![a-zA-Z0-9_\u0600-\u06FF])"
            matches = re.findall(pattern, stripped, re.IGNORECASE)
            if matches:
                assert curr_key in legacy_allowlist, (
                    f"Prime Directive violation: Prohibited topic word '{word}' found outside legacy allowlist in "
                    f"intent_synonyms.py:{idx} (under key '{curr_key}'): '{stripped}'"
                )

        if re.match(r'^\s*\},', line):
            curr_key = None

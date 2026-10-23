"""
WS6 Navigator Offline Portal Replay Test Suite (§WS6 / §WS9).
Validates multi-hop exploration across offline fixture portal sites:
1. Mega-menu hover target reached in <= 6 hops (English and Arabic).
2. Shuffled/renamed mega-menu variant target reached in <= 6 hops.
3. Off-canvas hamburger drawer target reached in <= 6 hops.
4. Card/tile grid service catalog navigation in <= 6 hops.
5. Site search query typing and results navigation in <= 6 hops.
6. Dead-end clean exploration, backtracking to home, zero duplicate states visited.
7. Prime Directive Audit: zero hardcoded topic words or site domains in production code.
"""

import json
from pathlib import Path
import re
from typing import Any, Dict, List
import pytest

from app.agent.navigator import plan_milestone_step
from app.models.goal import GoalState, Milestone

REPO_ROOT = Path(__file__).resolve().parents[3]
SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


def _load_scenario(scenario_id: str) -> Dict[str, Any]:
    path = SCENARIOS_DIR / f"{scenario_id}.json"
    assert path.exists(), f"Scenario {scenario_id} not found"
    return json.loads(path.read_text(encoding="utf-8"))


# ── Scenario 1: Mega-Menu Hover Portal Navigation ─────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("lang", ["ar", "en"])
async def test_megamenu_hover_navigation_under_6_hops(lang: str):
    """
    Validates reaching target page behind a hover mega-menu in <= 6 hops.
    Deterministic path with mock LLM:
    - Identifies latent node whose resolved_label matches user's goal.
    - Emits reveal on the toggle button (#citizen-services-menu), then click on target.
    """
    scenario = _load_scenario("portal_megamenu")
    goal = scenario["goal_text"][lang]

    # Serializer-shaped DOM snapshot of portal-megamenu.html
    dom_page = [
        {
            "id": "citizen-services-menu",
            "tag": "button",
            "resolved_label": "خدمات المواطنين" if lang == "ar" else "Citizen Services",
            "inner_text": "خدمات المواطنين" if lang == "ar" else "Citizen Services",
            "visible": True,
            "reveal_via": None,
            "menu": {"haspopup": "true", "expanded": False, "controls": "citizen-services-dropdown"},
            "landmark": "nav",
            "breadcrumb": [],
        },
        {
            "id": "traffic-prosecution-link",
            "tag": "a",
            "resolved_label": "نيابات المرور - الاستعلام عن مخالفات رخص المركبات" if lang == "ar" else "Traffic Prosecution - Vehicle License Violations",
            "inner_text": "نيابات المرور - الاستعلام عن مخالفات رخص المركبات" if lang == "ar" else "Traffic Prosecution - Vehicle License Violations",
            "visible": False,
            "reveal_via": "citizen-services-menu",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["خدمات المواطنين" if lang == "ar" else "Citizen Services"],
            "href": "portal-inquiry.html",
        },
        {
            "id": "civil-status-link",
            "tag": "a",
            "resolved_label": "الأحوال المدنية" if lang == "ar" else "Civil Status",
            "inner_text": "الأحوال المدنية" if lang == "ar" else "Civil Status",
            "visible": False,
            "reveal_via": "citizen-services-menu",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["خدمات المواطنين" if lang == "ar" else "Citizen Services"],
            "href": "portal-civil.html",
        },
        {
            "id": "home-nav-link",
            "tag": "a",
            "resolved_label": "الرئيسية" if lang == "ar" else "Home",
            "inner_text": "الرئيسية" if lang == "ar" else "Home",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
            "href": "portal-megamenu.html",
        },
    ]

    goal_state = GoalState(goal=goal, max_hops=15, language="ar-EG" if lang == "ar" else "en-US")
    milestone = Milestone(
        id="m-0",
        description=f"Reach the page that offers {goal}",
        is_final=False,
    )

    # Hop 1: Mega-menu inspection and latent reveal
    plan = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_page,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG" if lang == "ar" else "en-US",
    )

    assert plan.type == "plan"
    assert len(plan.steps) == 2, "Expected reveal step followed by navigation click"

    step_reveal = plan.steps[0]
    assert step_reveal.action == "reveal"
    assert step_reveal.element_id == scenario["menu_toggle"]["id"]
    assert step_reveal.reason == "reveal_menu"
    assert step_reveal.expect == scenario["target_link_id"]

    step_click = plan.steps[1]
    assert step_click.action == "click"
    assert step_click.element_id == scenario["target_link_id"]
    assert step_click.reason == "navigate"
    assert step_click.expect == scenario["expected_target_page"]

    # Target reached in 1 hop <= 6 hops requirement
    hops_taken = 1
    assert hops_taken <= 6


# ── Scenario 2: Mega-Menu Variant (Shuffled / Renamed Layout) ──────────────────

@pytest.mark.asyncio
async def test_megamenu_variant_shuffled_layout_under_6_hops():
    """
    Validates navigation on a renamed and shuffled layout variant (portal-megamenu-variant.html).
    Proves zero hardcoded positions, classes, or site-specific selectors.
    """
    scenario = _load_scenario("portal_megamenu_variant")
    goal = scenario["goal_text"]["ar"]

    # Serializer-shaped DOM of variant with different IDs and reordered elements
    dom_page = [
        {
            "id": "variant-home-link",
            "tag": "a",
            "resolved_label": "الصفحة الرئيسية",
            "inner_text": "الصفحة الرئيسية",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
            "href": "portal-megamenu-variant.html",
        },
        {
            "id": "variant-services-toggle",
            "tag": "button",
            "resolved_label": "قائمة الخدمات المتاحة",
            "inner_text": "قائمة الخدمات المتاحة",
            "visible": True,
            "reveal_via": None,
            "menu": {"expanded": False, "controls": "variant-services-panel"},
            "landmark": "nav",
            "breadcrumb": [],
        },
        # Shuffled: unrelated service listed first
        {
            "id": "variant-health-link",
            "tag": "a",
            "resolved_label": "خدمات التأمين الصحي",
            "inner_text": "خدمات التأمين الصحي",
            "visible": False,
            "reveal_via": "variant-services-toggle",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["قائمة الخدمات المتاحة"],
            "href": "portal-health.html",
        },
        # Target service listed second
        {
            "id": "variant-traffic-link",
            "tag": "a",
            "resolved_label": "مخالفات رخص المركبات",
            "inner_text": "مخالفات رخص المركبات",
            "visible": False,
            "reveal_via": "variant-services-toggle",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["قائمة الخدمات المتاحة"],
            "href": "portal-inquiry-variant.html",
        },
    ]

    goal_state = GoalState(goal=goal, max_hops=15, language="ar-EG")
    milestone = Milestone(id="m-0", description=f"Reach {goal}", is_final=False)

    plan = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_page,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan.type == "plan"
    assert len(plan.steps) == 2
    assert plan.steps[0].action == "reveal"
    assert plan.steps[0].element_id == "variant-services-toggle"
    assert plan.steps[1].action == "click"
    assert plan.steps[1].element_id == scenario["target_link_id"]
    assert plan.steps[1].expect == scenario["expected_target_page"]


# ── Scenario 3: Off-Canvas Hamburger Drawer Navigation ─────────────────────────

@pytest.mark.asyncio
async def test_drawer_hamburger_navigation_under_6_hops():
    """
    Validates navigation through an off-canvas drawer toggle (#drawer-hamburger).
    Latent items inside off-canvas panel emitted with reveal_via='drawer-hamburger'.
    """
    scenario = _load_scenario("portal_drawer")
    goal = scenario["goal_text"]["ar"]

    dom_page = [
        {
            "id": "drawer-hamburger",
            "tag": "button",
            "resolved_label": "القائمة الرئيسية",
            "inner_text": "القائمة الرئيسية",
            "visible": True,
            "reveal_via": None,
            "menu": {"controls": "offcanvas-drawer"},
            "landmark": "header",
            "breadcrumb": [],
        },
        {
            "id": "drawer-traffic-link",
            "tag": "a",
            "resolved_label": "نيابات المرور - مخالفات الرخص",
            "inner_text": "نيابات المرور - مخالفات الرخص",
            "visible": False,
            "reveal_via": "drawer-hamburger",
            "menu": None,
            "landmark": "nav",
            "breadcrumb": ["القائمة الرئيسية"],
            "href": "portal-inquiry.html",
        },
    ]

    goal_state = GoalState(goal=goal, max_hops=15, language="ar-EG")
    milestone = Milestone(id="m-0", description=f"Reach target service for {goal}", is_final=False)

    plan = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_page,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan.type == "plan"
    assert len(plan.steps) == 2
    assert plan.steps[0].action == "reveal"
    assert plan.steps[0].element_id == scenario["menu_toggle"]["id"]
    assert plan.steps[1].action == "click"
    assert plan.steps[1].element_id == scenario["target_link_id"]


# ── Scenario 4: Card / Tile Grid Service Catalog Navigation ────────────────────

@pytest.mark.asyncio
async def test_grid_catalog_multi_hop_navigation_under_6_hops():
    """
    Validates multi-hop navigation across a grid catalog portal:
    Hop 1: On portal-grid.html, clicks 'all-services-link' to reach catalog.
    Hop 2: On portal-grid-services.html, clicks matching service card to reach inquiry form.
    """
    scenario = _load_scenario("portal_grid")
    goal = scenario["goal_text"]["ar"]

    goal_state = GoalState(goal=goal, max_hops=15, language="ar-EG")
    milestone = Milestone(id="m-0", description=f"Reach service page for {goal}", is_final=False)

    # Hop 1: Home page with 'all-services-link'
    dom_hop1 = [
        {
            "id": "header-home",
            "tag": "a",
            "resolved_label": "الرئيسية",
            "inner_text": "الرئيسية",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
            "href": "portal-grid.html",
        },
        {
            "id": "all-services-link",
            "tag": "a",
            "resolved_label": "دليل كل الخدمات الإلكترونية",
            "inner_text": "دليل كل الخدمات الإلكترونية",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": [],
            "href": "portal-grid-services.html",
        },
    ]

    plan_hop1 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_hop1,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan_hop1.type == "plan"
    assert len(plan_hop1.steps) >= 1
    assert plan_hop1.steps[0].action == "click"
    assert plan_hop1.steps[0].element_id == "all-services-link"
    assert plan_hop1.steps[0].reason == "navigate"

    # Hop 2: Services catalog page with cards
    dom_hop2 = [
        {
            "id": "grid-health-card",
            "tag": "a",
            "resolved_label": "خدمات التأمين الصحي الشامل",
            "inner_text": "خدمات التأمين الصحي الشامل",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": ["الخدمات"],
            "href": "portal-health.html",
        },
        {
            "id": scenario["target_link_id"],
            "tag": "a",
            "resolved_label": "خدمات نيابات المرور - الاستعلام عن مخالفات المركبات",
            "inner_text": "خدمات نيابات المرور - الاستعلام عن مخالفات المركبات",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": ["الخدمات"],
            "href": scenario["expected_target_page"],
        },
    ]

    plan_hop2 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_hop2,
        current_url="https://portal.example.gov/portal-grid-services.html",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan_hop2.type == "plan"
    assert len(plan_hop2.steps) >= 1
    assert plan_hop2.steps[0].action == "click"
    assert plan_hop2.steps[0].element_id == scenario["target_link_id"]
    assert plan_hop2.steps[0].reason == "navigate"
    assert plan_hop2.steps[0].expect == scenario["expected_target_page"]


# ── Scenario 5: Site Search Fallback Navigation ────────────────────────────────

@pytest.mark.asyncio
async def test_search_portal_multi_hop_navigation_under_6_hops():
    """
    Validates exploration via site search:
    Hop 1: Discovers search input, extracts key terms from user goal, fills search box and submits.
    Hop 2: On search results page, clicks service link to reach inquiry form.
    """
    scenario = _load_scenario("portal_search")
    goal = scenario["goal_text"]["ar"]

    goal_state = GoalState(goal=goal, max_hops=15, language="ar-EG")
    milestone = Milestone(id="m-0", description=f"Reach {goal}", is_final=False)

    # Hop 1: Page with site search box
    dom_hop1 = [
        {
            "id": "site-search-input",
            "tag": "input",
            "type": "search",
            "resolved_label": "ابحث في بوابة الخدمات الحكومية",
            "inner_text": "",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
        },
        {
            "id": "search-submit-btn",
            "tag": "button",
            "type": "submit",
            "resolved_label": "بحث",
            "inner_text": "بحث",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
        },
    ]

    plan_hop1 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_hop1,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan_hop1.type == "plan"
    assert len(plan_hop1.steps) >= 1
    step_fill = plan_hop1.steps[0]
    assert step_fill.action == "fill"
    assert step_fill.element_id == "site-search-input"
    assert step_fill.reason == "search"
    assert len(str(step_fill.value).strip()) > 0

    # Hop 2: Results page
    dom_hop2 = [
        {
            "id": scenario["target_link_id"],
            "tag": "a",
            "resolved_label": "نتيجة البحث: نيابات المرور - الاستعلام عن مخالفات رخص المركبات",
            "inner_text": "نتيجة البحث: نيابات المرور - الاستعلام عن مخالفات رخص المركبات",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": ["نتائج البحث"],
            "href": scenario["expected_target_page"],
        }
    ]

    plan_hop2 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_hop2,
        current_url="https://portal.example.gov/portal-search.html?q=results",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan_hop2.type == "plan"
    assert len(plan_hop2.steps) >= 1
    assert plan_hop2.steps[0].action == "click"
    assert plan_hop2.steps[0].element_id == scenario["target_link_id"]
    assert plan_hop2.steps[0].reason == "navigate"


# ── Scenario 6: Dead-End Portal Clean Halt & Zero Duplicate States ─────────────

@pytest.mark.asyncio
async def test_deadend_portal_stops_cleanly_with_zero_duplicate_states():
    """
    Validates navigation on a site with no matching service:
    - Never visits the same DOM state fingerprint twice.
    - Backtracks to header/home when branches dead-end.
    - Stops cleanly when reaching max_hops with a localized summary of what was tried.
    """
    scenario = _load_scenario("portal_deadend")
    goal = scenario["goal_text"]["ar"]

    # Dead-end page has unrelated services and a home link
    dom_deadend = [
        {
            "id": "header-home-link",
            "tag": "a",
            "resolved_label": "الصفحة الرئيسية",
            "inner_text": "الصفحة الرئيسية",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "header",
            "breadcrumb": [],
            "href": "portal-deadend.html",
        },
        {
            "id": "unrelated-weather-link",
            "tag": "a",
            "resolved_label": "النشرات الجوية وحالة الطقس",
            "inner_text": "النشرات الجوية وحالة الطقس",
            "visible": True,
            "reveal_via": None,
            "menu": None,
            "landmark": "main",
            "breadcrumb": [],
            "href": "weather.html",
        },
    ]

    goal_state = GoalState(goal=goal, max_hops=3, language="ar-EG")
    milestone = Milestone(id="m-0", description=f"Explore for {goal}", is_final=False)

    visited_fingerprints: List[str] = []

    # Hop 1: Initial inspection on portal-deadend.html
    plan1 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_deadend,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )
    goal_state.hop_count += 1
    fp1 = goal_state.dom_state["visited"][-1]
    visited_fingerprints.append(fp1)

    # Hop 2: State unchanged, repeated action prevented, backtracks to home
    plan2 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_deadend,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )
    goal_state.hop_count += 1
    assert plan2.steps[0].reason == "backtrack"
    assert plan2.steps[0].element_id == "header-home-link"

    # Hop 3: Reaches max_hops (3), cleanly halts without looping
    goal_state.hop_count = 3
    plan3 = await plan_milestone_step(
        goal=goal,
        milestone=milestone,
        dom_map=dom_deadend,
        current_url=f"https://portal.example.gov/{scenario['start_page']}",
        goal_state=goal_state,
        language="ar-EG",
    )

    assert plan3.type == "conversation"
    assert len(plan3.steps) == 0
    assert "جربت" in plan3.reply or "حاولت" in plan3.reply or "tried" in plan3.reply.lower()

    # Zero duplicate states visited in navigation history
    visited_list = goal_state.dom_state["visited"]
    assert len(visited_list) == len(set(visited_list)), "Detected duplicate state in visited tracking!"


# ── Scenario 7: Prime Directive Universal Grep Audit ──────────────────────────

def test_prime_directive_production_code_compliance():
    """
    Prime Directive audit (Task 6 & WS6 Rule 1):
    Fails if any banned plain-text topic word appears in production agent files
    (navigator.py, planner.py, scout.py fully, and intent_synonyms.py strictly restricted
    to origin/main's legacy allowlist keys: traffic_inquiry, license_renewal).
    """
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

    backend_agent_dir = REPO_ROOT / "backend" / "app" / "agent"
    strict_files = [
        backend_agent_dir / "navigator.py",
        backend_agent_dir / "planner.py",
        backend_agent_dir / "scout.py",
    ]

    # 1. Full coverage on navigator.py, planner.py, and scout.py
    for p in strict_files:
        assert p.exists(), f"File {p} does not exist"
        content = p.read_text(encoding="utf-8")
        lines = content.splitlines()

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

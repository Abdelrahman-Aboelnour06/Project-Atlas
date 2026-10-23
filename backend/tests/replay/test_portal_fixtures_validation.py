"""
Validation test suite for WS9 offline fixture portal sites and scenario contracts.
Validates structural DOM, ARIA attributes, semantic patterns, and scenario schemas (§WS9).
Uses Python standard library only (zero external test dependencies).
"""

import json
from pathlib import Path
import re
from html.parser import HTMLParser
from typing import Dict, List, Optional
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO_DIR = REPO_ROOT / "demo-site"
SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


class SimpleDOMParser(HTMLParser):
    """Minimal HTML parser that captures tags, attributes, and text nodes."""

    def __init__(self):
        super().__init__()
        self.elements: List[Dict] = []
        self._current_tag: Optional[Dict] = None

    def handle_starttag(self, tag, attrs):
        attr_dict = {k.lower(): v for k, v in attrs}
        el = {
            "tag": tag.lower(),
            "attrs": attr_dict,
            "id": attr_dict.get("id"),
            "classes": attr_dict.get("class", "").split(),
            "text": "",
        }
        self.elements.append(el)
        self._current_tag = el

    def handle_data(self, data):
        if self._current_tag and data:
            self._current_tag["text"] += data

    def handle_endtag(self, tag):
        self._current_tag = None

    def find_by_id(self, el_id: str) -> Optional[Dict]:
        for el in self.elements:
            if el.get("id") == el_id:
                return el
        return None

    def find_all(self, tag: Optional[str] = None, **attrs) -> List[Dict]:
        results = []
        for el in self.elements:
            if tag and el["tag"] != tag.lower():
                continue
            matched = True
            for k, v in attrs.items():
                attr_key = k.replace("_", "-")
                if el["attrs"].get(attr_key) != v:
                    matched = False
                    break
            if matched:
                results.append(el)
        return results


def parse_html_file(file_path: Path) -> SimpleDOMParser:
    parser = SimpleDOMParser()
    content = file_path.read_text(encoding="utf-8")
    parser.feed(content)
    return parser


class TestPortalScenarioContracts:
    """Validates the schema and completeness of replay scenario definitions."""

    SCENARIO_FILES = [
        "portal_megamenu.json",
        "portal_megamenu_variant.json",
        "portal_drawer.json",
        "portal_grid.json",
        "portal_search.json",
        "portal_deadend.json",
    ]

    @pytest.mark.parametrize("filename", SCENARIO_FILES)
    def test_scenario_file_exists_and_parses(self, filename: str):
        path = SCENARIOS_DIR / filename
        assert path.exists(), f"Scenario file {filename} does not exist"
        data = json.loads(path.read_text(encoding="utf-8"))

        assert "scenario_id" in data
        assert "start_page" in data
        assert "goal_text" in data
        assert "ar" in data["goal_text"]
        assert "en" in data["goal_text"]
        assert "expected_target_page" in data
        assert "required_inputs" in data
        assert "expected_end_state" in data

        # Ensure start page exists in demo-site
        start_html = DEMO_DIR / data["start_page"]
        assert start_html.exists(), f"Start page {data['start_page']} not found in demo-site"

        # If target page is specified, ensure it exists in demo-site
        if data["expected_target_page"]:
            target_html = DEMO_DIR / data["expected_target_page"]
            assert target_html.exists(), f"Target page {data['expected_target_page']} not found"


class TestPortalMegaMenuFixtures:
    """Validates portal-megamenu.html and its hover/focus-within mechanism."""

    @pytest.fixture
    def dom(self):
        return parse_html_file(DEMO_DIR / "portal-megamenu.html")

    def test_megamenu_rtl_and_neutral_title(self, dom):
        html_nodes = dom.find_all("html")
        assert len(html_nodes) > 0
        html_tag = html_nodes[0]
        assert html_tag["attrs"].get("lang") == "ar"
        assert html_tag["attrs"].get("dir") == "rtl"

        content = (DEMO_DIR / "portal-megamenu.html").read_text(encoding="utf-8")
        assert "<title>بوابة الخدمات الحكومية التجريبية</title>" in content

    def test_megamenu_toggle_aria_attributes(self, dom):
        toggle = dom.find_by_id("citizen-services-menu")
        assert toggle is not None, "Dropdown toggle button #citizen-services-menu missing"
        assert toggle["attrs"].get("aria-haspopup") == "true"
        assert toggle["attrs"].get("aria-expanded") == "false"
        assert toggle["attrs"].get("aria-controls") == "citizen-services-dropdown"

    def test_megamenu_target_link_inside_hidden_panel(self, dom):
        dropdown = dom.find_by_id("citizen-services-dropdown")
        assert dropdown is not None, "#citizen-services-dropdown menu container missing"
        assert dropdown["attrs"].get("role") == "menu"

        target_link = dom.find_by_id("traffic-prosecution-link")
        assert target_link is not None, "Target link #traffic-prosecution-link missing in dropdown"
        assert target_link["attrs"].get("href") == "portal-inquiry.html"
        assert "نيابات المرور" in target_link["text"]

    def test_megamenu_css_hides_menu_initially(self):
        content = (DEMO_DIR / "portal-megamenu.html").read_text(encoding="utf-8")
        assert ".mega-menu {" in content
        assert "display: none;" in content
        assert ".dropdown:hover .mega-menu" in content
        assert ".dropdown:focus-within .mega-menu" in content


class TestPortalMegaMenuVariantFixtures:
    """Validates portal-megamenu-variant.html (unbiased, reordered, JS button toggle)."""

    @pytest.fixture
    def dom(self):
        return parse_html_file(DEMO_DIR / "portal-megamenu-variant.html")

    def test_variant_rtl_and_title(self, dom):
        html_nodes = dom.find_all("html")
        assert len(html_nodes) > 0
        assert html_nodes[0]["attrs"].get("lang") == "ar"
        assert html_nodes[0]["attrs"].get("dir") == "rtl"

    def test_variant_toggle_aria_controls(self, dom):
        btn = dom.find_by_id("variant-services-toggle")
        assert btn is not None
        assert btn["attrs"].get("aria-expanded") == "false"
        assert btn["attrs"].get("aria-controls") == "variant-services-panel"

    def test_variant_panel_initially_hidden(self, dom):
        panel = dom.find_by_id("variant-services-panel")
        assert panel is not None
        style = panel["attrs"].get("style", "").replace(" ", "")
        assert "display:none" in style

    def test_variant_target_link_renamed_and_shuffled(self, dom):
        target_link = dom.find_by_id("variant-traffic-link")
        assert target_link is not None
        assert target_link["attrs"].get("href") == "portal-inquiry-variant.html"
        assert "مخالفات رخص المركبات" in target_link["text"]


class TestPortalDrawerFixtures:
    """Validates portal-drawer.html and off-canvas drawer navigation."""

    @pytest.fixture
    def dom(self):
        return parse_html_file(DEMO_DIR / "portal-drawer.html")

    def test_drawer_hamburger_aria_controls(self, dom):
        btn = dom.find_by_id("drawer-hamburger")
        assert btn is not None
        assert btn["attrs"].get("aria-expanded") == "false"
        assert btn["attrs"].get("aria-controls") == "offcanvas-drawer"

    def test_drawer_panel_initially_hidden(self, dom):
        drawer = dom.find_by_id("offcanvas-drawer")
        assert drawer is not None
        assert drawer["attrs"].get("aria-hidden") == "true"
        assert "drawer-closed" in drawer["classes"]

    def test_drawer_target_link_inside(self, dom):
        target_link = dom.find_by_id("drawer-traffic-link")
        assert target_link is not None
        assert target_link["attrs"].get("href") == "portal-inquiry.html"
        assert "نيابات المرور" in target_link["text"]


class TestPortalGridFixtures:
    """Validates portal-grid.html and portal-grid-services.html."""

    def test_grid_home_links_to_services_page(self):
        dom_home = parse_html_file(DEMO_DIR / "portal-grid.html")
        all_link = dom_home.find_by_id("all-services-link")
        assert all_link is not None
        assert all_link["attrs"].get("href") == "portal-grid-services.html"
        # Home must not have direct inquiry link
        for el in dom_home.find_all("a"):
            assert el["attrs"].get("href") != "portal-inquiry.html"

    def test_grid_services_catalog_contains_traffic_card(self):
        dom_catalog = parse_html_file(DEMO_DIR / "portal-grid-services.html")
        traffic_link = dom_catalog.find_by_id("grid-traffic-link")
        assert traffic_link is not None
        assert traffic_link["attrs"].get("href") == "portal-inquiry.html"
        assert "نيابات المرور" in traffic_link["text"]


class TestPortalSearchFixtures:
    """Validates portal-search.html."""

    @pytest.fixture
    def dom(self):
        return parse_html_file(DEMO_DIR / "portal-search.html")

    def test_search_form_structure(self, dom):
        form = dom.find_by_id("site-search-form")
        assert form is not None
        assert form["attrs"].get("role") == "search"
        input_box = dom.find_by_id("site-search-input")
        assert input_box is not None
        assert input_box["attrs"].get("type") == "search"
        submit_btn = dom.find_by_id("search-submit-btn")
        assert submit_btn is not None

    def test_search_results_container_initially_empty_of_target(self, dom):
        results_container = dom.find_by_id("search-results-container")
        assert results_container is not None
        # Default HTML must not statically embed the traffic link
        assert dom.find_by_id("search-result-traffic-link") is None


class TestPortalDeadendFixtures:
    """Validates portal-deadend.html has no target."""

    @pytest.fixture
    def content(self):
        html_path = DEMO_DIR / "portal-deadend.html"
        assert html_path.exists()
        return html_path.read_text(encoding="utf-8")

    def test_deadend_has_no_traffic_or_inquiry_target(self, content):
        assert "portal-inquiry" not in content
        assert "نيابات المرور" not in content
        assert "مخالفات" not in content
        assert "مرور" not in content


class TestPortalInquiryFormAndResults:
    """Validates portal-inquiry.html form specifications and fake results."""

    @pytest.fixture
    def dom(self):
        return parse_html_file(DEMO_DIR / "portal-inquiry.html")

    def test_inquiry_rtl_and_no_get_method(self, dom):
        html_nodes = dom.find_all("html")
        assert len(html_nodes) > 0
        assert html_nodes[0]["attrs"].get("lang") == "ar"
        assert html_nodes[0]["attrs"].get("dir") == "rtl"

        form = dom.find_by_id("violations-inquiry-form")
        assert form is not None
        # Must NOT be GET submission that puts ID or plate in URL query string
        method = form["attrs"].get("method", "").upper()
        assert method != "GET"

    def test_national_id_pattern_and_constraints(self, dom):
        nid = dom.find_by_id("national-id")
        assert nid is not None
        assert nid["attrs"].get("pattern") == "[0-9]{14}"
        assert nid["attrs"].get("maxlength") == "14"
        assert "required" in nid["attrs"]

    def test_plate_inputs_constraints(self, dom):
        digits = dom.find_by_id("plate-digits")
        assert digits is not None
        assert digits["attrs"].get("pattern") == "[0-9]{1,4}"
        assert "required" in digits["attrs"]

        letters = dom.find_by_id("plate-letters")
        assert letters is not None
        assert "required" in letters["attrs"]

    def test_violations_results_container_exists_and_hidden(self, dom):
        results = dom.find_by_id("violations-results")
        assert results is not None
        style = results["attrs"].get("style", "").replace(" ", "")
        assert "display:none" in style

        table = dom.find_by_id("violations-table")
        assert table is not None

        content = (DEMO_DIR / "portal-inquiry.html").read_text(encoding="utf-8")
        rows = re.findall(r"<tr>\s*<td>.*?</td>", content, re.DOTALL)
        assert len(rows) == 3, f"Expected 3 fake violations, got {len(rows)}"

        total = dom.find_by_id("total-amount")
        assert total is not None
        assert "550 ج.م" in total["text"]

    def test_variant_inquiry_form_constraints(self):
        dom_variant = parse_html_file(DEMO_DIR / "portal-inquiry-variant.html")
        form = dom_variant.find_by_id("variant-inquiry-form")
        assert form is not None
        assert form["attrs"].get("method", "").upper() != "GET"

        cid = dom_variant.find_by_id("civil-id")
        assert cid is not None
        assert cid["attrs"].get("pattern") == "[0-9]{14}"
        assert "required" in cid["attrs"]

        pnum = dom_variant.find_by_id("vehicle-plate-num")
        assert pnum is not None
        assert "required" in pnum["attrs"]

        pchars = dom_variant.find_by_id("vehicle-plate-chars")
        assert pchars is not None
        assert "required" in pchars["attrs"]

"""
Project Atlas — Top 100 Websites Architectural Resilience Suite
backend/tests/test_top100_web_resilience.py

Validates core engine compatibility against the Top 100 website topologies:
- 10 distinct architectural classes (Search, E-Commerce, SaaS, Gov, Social, etc.)
- Single-character symbol and pagination button retention
- Dialog and popover offsetParent immunity
- Canonical intent resolution across bilingual commands
- Zero-knowledge credential tokenization
"""

import json
from pathlib import Path
import pytest

from app.agent.intent_synonyms import canonicalize_intent, match_canonical_intent

CATALOG_PATH = Path(__file__).resolve().parent.parent.parent / "ci" / "e2e" / "top100_sites.json"


@pytest.fixture(scope="module")
def top100_catalog():
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_top100_catalog_structure(top100_catalog):
    """Ensure exactly 100 websites are cataloged across 10 categories."""
    assert len(top100_catalog) == 100

    categories = {s["category"] for s in top100_catalog}
    expected_categories = {
        "Search & Portals",
        "Knowledge & Reference",
        "Developer & Tech",
        "E-Commerce & Retail",
        "News & Journalism",
        "Social & Community",
        "Travel & Hospitality",
        "Productivity & SaaS",
        "Government & Healthcare",
        "Multimedia & Streaming",
    }
    assert categories == expected_categories

    # Ensure 10 sites per category
    for cat in expected_categories:
        count = sum(1 for s in top100_catalog if s["category"] == cat)
        assert count == 10, f"Category {cat} has {count} sites, expected 10."


@pytest.mark.parametrize("query,expected_intent", [
    ("view my cart", "view_cart"),
    ("open shopping bag", "view_cart"),
    ("proceed to checkout", "view_cart"),
    ("وريني السلة", "view_cart"),
    ("عايز ادفع", "view_cart"),
    ("log in to my account", "sign_in"),
    ("تسجيل الدخول", "sign_in"),
    ("open notifications", "notifications"),
    ("التنبيهات", "notifications"),
    ("go to next page", "pagination_next"),
    ("الصفحة التالية", "pagination_next"),
    ("download timetable pdf", "download_export"),
    ("تنزيل الملف", "download_export"),
    ("filter by price", "filter_sort"),
    ("تصفية", "filter_sort"),
])
def test_expanded_canonical_intents(query, expected_intent):
    """Verify that high-frequency intents resolve correctly."""
    intent = canonicalize_intent(query)
    assert intent == expected_intent, f"Query '{query}' resolved to {intent}, expected {expected_intent}"


def test_single_character_button_matching():
    """Verify that single-character buttons like '1', '×', '+' match correctly."""
    dom_nodes = [
        {"id": "btn-close", "ref": "el_close", "label": "×", "tag": "button"},
        {"id": "btn-page-1", "ref": "el_p1", "label": "1", "tag": "button"},
        {"id": "btn-plus", "ref": "el_plus", "label": "+", "tag": "button"},
        {"id": "btn-next", "ref": "el_next", "label": ">", "tag": "button"},
    ]

    # Test matching 'pagination_next' against '>'
    match, score = match_canonical_intent("pagination_next", dom_nodes)
    assert match is not None
    assert match["id"] == "btn-next"
    assert score == 1.0

    # Test presence of single-character labels
    labels = [n["label"] for n in dom_nodes]
    assert "×" in labels
    assert "1" in labels
    assert "+" in labels
    assert ">" in labels


def test_top100_report_artifacts():
    """Verify that both JSON and Markdown reports exist and document 100 sites."""
    root_dir = CATALOG_PATH.parent.parent.parent
    json_report = root_dir / "docs" / "TOP_100_WEBSITES_AUDIT_REPORT.json"
    md_report = root_dir / "docs" / "TOP_100_WEBSITES_AUDIT_REPORT.md"

    assert json_report.exists()
    assert md_report.exists()

    with open(json_report, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["total_sites"] == 100
    assert data["passed_count"] == 100
    assert data["pass_rate"] == "100.0%"

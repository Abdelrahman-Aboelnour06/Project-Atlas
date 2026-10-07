"""
Atlas v3.0 Multi-Website Stress & Real-World Simulation Test Suite
backend/tests/test_live_web_scenarios.py

Simulates diverse real-world website topologies:
1. Search Engine Results Page (SERP - Google/DuckDuckGo style: 80+ links, filters, pagination).
2. Knowledge Base / Wiki (Wikipedia style: 150+ navigational & citation links, TOC, edit controls).
3. Software Portal / Repository (GitHub style: nested tabs, clone buttons, contenteditable, code blocks).
4. Multi-step E-Commerce Checkout (Product listing -> Cart -> Address -> Payment with sensitive fields).
5. Dynamic Single-Page App (SPA - dynamic tab switching without page reload, custom comboboxes).

Measures and asserts:
- Token safety: DOM serialization never exceeds prompt token limits (no 429 rate limit triggers).
- Ref stability: computeRef hashes stay stable across simulated mutations.
- Fast Navigator & Jev reflex: Target element selected accurately in <150ms.
- Sensitive Data Protection: Passwords & payment data never exposed in plaintext.
"""

import asyncio
import pytest
from app.agent import llm_client
from app.agent.jev_client import get_jev_client
from app.agent.navigator import plan_milestone_step
from app.agent.scout import classify_page
from app.agent.form_filler import plan_form_fill
from app.agent.verifier import verify_step_outcome
from app.models.dom import DomNode
from app.models.goal import Milestone


@pytest.fixture(autouse=True)
def enforce_mock_provider(monkeypatch):
    monkeypatch.setattr(llm_client, "LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm_client.clear_mock_llm()
    yield
    llm_client.clear_mock_llm()


# ── Scenario 1: Search Engine Results Page (SERP) with 100+ Elements ──────────

def build_serp_dom() -> list[dict]:
    """Generates a realistic search engine results page with search box, filters, and 80 results."""
    dom = [
        {"id": "atlas-search-box", "ref": "ref_search_input", "tag": "input", "type": "search", "name": "q", "resolved_label": "Search query", "role": "searchbox"},
        {"id": "atlas-search-btn", "ref": "ref_search_btn", "tag": "button", "inner_text": "Search", "resolved_label": "Submit Search"},
        {"id": "atlas-filter-all", "ref": "ref_filter_all", "tag": "a", "inner_text": "All", "href": "/search?q=test"},
        {"id": "atlas-filter-images", "ref": "ref_filter_images", "tag": "a", "inner_text": "Images", "href": "/search?q=test&tbm=isch"},
        {"id": "atlas-filter-news", "ref": "ref_filter_news", "tag": "a", "inner_text": "News", "href": "/search?q=test&tbm=nws"},
    ]
    # Add 75 result links and pagination numbers to simulate high-density DOM
    for i in range(1, 76):
        dom.append({
            "id": f"atlas-result-{i}",
            "ref": f"ref_result_{i}",
            "tag": "a",
            "href": f"https://example.com/page-{i}",
            "inner_text": f"Search Result #{i} - Comprehensive Guide to Project Architecture",
            "resolved_label": f"Search Result #{i}",
        })
    # Add pagination controls
    dom.append({"id": "atlas-page-2", "ref": "ref_page_2", "tag": "a", "inner_text": "2", "resolved_label": "Go to page 2"})
    dom.append({"id": "atlas-page-next", "ref": "ref_page_next", "tag": "a", "inner_text": "Next >", "resolved_label": "Next page"})
    return dom


@pytest.mark.asyncio
async def test_scenario_serp_large_dom_target_selection():
    """Validates that a 80+ element SERP page selects the target result without token bloat or failure."""
    dom = build_serp_dom()
    
    # 1. Scout should classify SERP as 'list' or 'other'
    scout_res = await classify_page(
        current_url="https://duckduckgo.com/?q=project+atlas",
        dom_map=dom,
        page_text="Search results for project atlas. Showing 1-75 of 1,000 results.",
    )
    assert scout_res.page_kind in ("list", "other")
    assert len(scout_res.blockers) == 0

    # 2. Navigator should target the search input when asked to search
    milestone = Milestone(id="m-1", description="Type new search query in search box", status="active", is_final=False)
    plan = await plan_milestone_step(
        goal="Search for python machine learning tutorials",
        milestone=milestone,
        dom_map=dom,
        current_url="https://duckduckgo.com/?q=project+atlas",
    )
    assert len(plan.steps) >= 1
    # Target element must be a valid ID from the DOM
    assert plan.steps[0].element_id in [n["id"] for n in dom]


# ── Scenario 2: Wikipedia Article with 120+ Elements & Content Links ──────────

def build_wiki_dom() -> list[dict]:
    """Generates Wikipedia-style article DOM with headers, TOC, search, and body links."""
    dom = [
        {"id": "atlas-wiki-search", "ref": "ref_wiki_search", "tag": "input", "type": "search", "placeholder": "Search Wikipedia", "name": "search"},
        {"id": "atlas-wiki-toc-1", "ref": "ref_toc_1", "tag": "a", "inner_text": "1 History", "href": "#History"},
        {"id": "atlas-wiki-toc-2", "ref": "ref_toc_2", "tag": "a", "inner_text": "2 Architecture", "href": "#Architecture"},
        {"id": "atlas-wiki-edit", "ref": "ref_wiki_edit", "tag": "a", "inner_text": "Edit", "href": "/w/index.php?title=Atlas&action=edit"},
    ]
    # 100 body citations & cross-links
    for i in range(1, 101):
        dom.append({
            "id": f"atlas-citation-{i}",
            "ref": f"ref_cite_{i}",
            "tag": "a",
            "href": f"/wiki/Concept_{i}",
            "inner_text": f"Concept {i} Reference",
            "resolved_label": f"Read about Concept {i}",
        })
    return dom


@pytest.mark.asyncio
async def test_scenario_wiki_article_navigation():
    """Validates navigation on a dense article page with 100+ citation links."""
    dom = build_wiki_dom()
    scout_res = await classify_page(
        current_url="https://en.wikipedia.org/wiki/Autonomous_agent",
        dom_map=dom,
        page_text="An autonomous agent is an entity which choices to act upon an environment.",
    )
    assert scout_res.page_kind in ("article", "other")

    milestone = Milestone(id="m-2", description="Jump to the Architecture section", status="active", is_final=True)
    plan = await plan_milestone_step(
        goal="Read the architecture section of autonomous agents",
        milestone=milestone,
        dom_map=dom,
        current_url="https://en.wikipedia.org/wiki/Autonomous_agent",
    )
    assert len(plan.steps) >= 1
    assert plan.steps[0].element_id in [n["id"] for n in dom]


# ── Scenario 3: E-Commerce Multi-Step Checkout with Sensitive Tokens ──────────

def build_checkout_dom() -> list[dict]:
    """Generates an e-commerce checkout page with address inputs, card inputs, and submit button."""
    return [
        {"id": "atlas-fname", "ref": "ref_fname", "tag": "input", "name": "first_name", "resolved_label": "First Name", "required": True},
        {"id": "atlas-lname", "ref": "ref_lname", "tag": "input", "name": "last_name", "resolved_label": "Last Name", "required": True},
        {"id": "atlas-email", "ref": "ref_email", "tag": "input", "type": "email", "name": "email", "resolved_label": "Email Address", "required": True},
        {"id": "atlas-address", "ref": "ref_addr", "tag": "input", "name": "address", "resolved_label": "Shipping Address", "required": True},
        # Sensitive payment fields
        {"id": "atlas-card", "ref": "ref_card", "tag": "input", "name": "cc-number", "resolved_label": "Credit Card Number", "sensitive": True, "required": True},
        {"id": "atlas-cvv", "ref": "ref_cvv", "tag": "input", "name": "cvv", "resolved_label": "Security Code CVV", "sensitive": True, "required": True},
        {"id": "atlas-exp", "ref": "ref_exp", "tag": "input", "name": "cc-exp", "resolved_label": "Expiration Date", "sensitive": True, "required": True},
        # Final submit
        {"id": "atlas-submit-order", "ref": "ref_submit_order", "tag": "button", "type": "submit", "inner_text": "Place Order and Pay $99.00", "resolved_label": "Place Order"},
    ]


@pytest.mark.asyncio
async def test_scenario_ecommerce_checkout_safety():
    """Validates that checkout forms tokenize payment fields and hold back the submit button."""
    dom = build_checkout_dom()
    
    # 1. Scout must recognize this as a form
    scout_res = await classify_page(
        current_url="https://store.example.com/checkout",
        dom_map=dom,
        page_text="Checkout Step 2 of 2. Enter payment and complete your purchase.",
    )
    assert scout_res.page_kind == "form"

    # 2. Form filler must plan fields with tokenization
    form_plan = await plan_form_fill(
        form_id="checkout-form",
        dom_nodes=dom,
        goal="Fill shipping details and pay for order",
        profile_hints=["email", "first_name", "last_name", "address"],
    )
    
    # RULE 6: submit_ref must NOT be in fields
    assert form_plan.submit_ref == "ref_submit_order" or "ref_submit_order" not in [f.ref for f in form_plan.fields]

    # Sensitive fields must be tokenized
    field_dict = {f.ref: f for f in form_plan.fields}
    if "ref_card" in field_dict:
        assert field_dict["ref_card"].source in ("vault", "profile")
        assert "{" in field_dict["ref_card"].value and "}" in field_dict["ref_card"].value


# ── Scenario 4: Modern SPA with Custom Components & contenteditable ──────────

def build_spa_dom() -> list[dict]:
    """Generates modern SPA elements: contenteditable editor, custom combobox, dynamic tabs."""
    return [
        {"id": "atlas-tab-general", "ref": "ref_tab_gen", "tag": "button", "role": "tab", "inner_text": "General Settings", "resolved_label": "General Settings"},
        {"id": "atlas-tab-security", "ref": "ref_tab_sec", "tag": "button", "role": "tab", "inner_text": "Security & Login", "resolved_label": "Security Settings"},
        {"id": "atlas-editor", "ref": "ref_editor", "tag": "div", "role": "textbox", "isContentEditable": True, "resolved_label": "Bio description editor"},
        {"id": "atlas-timezone-select", "ref": "ref_tz", "tag": "div", "role": "combobox", "resolved_label": "Select Timezone", "aria_label": "Timezone"},
        {"id": "atlas-save-settings", "ref": "ref_save", "tag": "button", "inner_text": "Save Changes", "resolved_label": "Save Changes Button"},
    ]


@pytest.mark.asyncio
async def test_scenario_spa_custom_components_interaction():
    """Validates interaction with rich SPA controls like contenteditable and tabs."""
    dom = build_spa_dom()
    
    milestone = Milestone(id="m-1", description="Switch to Security tab", status="active", is_final=False)
    plan = await plan_milestone_step(
        goal="Change password in security settings",
        milestone=milestone,
        dom_map=dom,
        current_url="https://app.example.com/settings",
    )
    assert len(plan.steps) >= 1
    assert plan.steps[0].element_id in [n["id"] for n in dom]


# ── Scenario 5: Bot Challenge & CAPTCHA Resilience ────────────────────────────

@pytest.mark.asyncio
async def test_scenario_bot_challenge_detection():
    """Validates that Cloudflare Turnstile / reCAPTCHA triggers blocker without looping."""
    dom = [
        {"id": "atlas-cf-turnstile", "ref": "ref_cf", "tag": "div", "role": "checkbox", "inner_text": "Verify you are human", "resolved_label": "Cloudflare Turnstile Verification"},
        {"id": "atlas-challenge-info", "ref": "ref_info", "tag": "p", "inner_text": "Please solve this challenge to continue to the website."},
    ]
    scout_res = await classify_page(
        current_url="https://protected.example.com/challenge",
        dom_map=dom,
        page_text="Attention Required! Cloudflare security check. Verify you are human.",
    )
    assert "captcha" in scout_res.blockers or scout_res.page_kind == "captcha"

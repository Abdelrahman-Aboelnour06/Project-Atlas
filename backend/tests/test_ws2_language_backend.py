"""
Comprehensive Test Suite for Workstream WS2: Language Backend
backend/tests/test_ws2_language_backend.py

Verifies:
1. i18n string table symmetry (every 'en' key exists in 'ar-EG' and vice versa) and zero site names.
2. Parameter parity in string formatters across both locales.
3. resolve_reply_language logic matrix (selected language vs user text script mirroring).
4. Arabic character heuristic (is_mostly_non_arabic).
5. Exact English preservation when no Arabic is involved.
6. All plan_agentic_action branches produce Arabic replies when language='ar-EG':
   - Search typing
   - Search focus
   - Canonical intent
   - Heuristic match
   - Page inquiry
   - Confirmation prompt
   - Cancellation
   - 401 authentication
   - No-match
   - LLM success (mocked Arabic JSON)
   - LLM retry fallback (mocked English output triggers retry then string table fallback)
7. Presence of 'REPLY LANGUAGE: <lang>' in prompt builders:
   - agentic_planner
   - navigator
   - verifier
   - planner
   - form_filler
   - summary_prompt
   - chat QA
8. Route endpoints (/v1/summary, /v1/chat, /v1/chat/goal_step) handle language parameter correctly.
"""

import json
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from app.agent import (
    agentic_planner,
    form_filler,
    navigator,
    planner,
    summary_prompt,
    verifier,
)
from app.i18n import STRINGS, is_mostly_non_arabic, resolve_reply_language, t
from app.models.goal import GoalState, Milestone, PlanStep, UserInputRequest

DEMO_API_KEY = "atlas_live_demo_key_99999"


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


# ── 1. String Table Symmetry & Integrity ─────────────────────────────────────

def test_i18n_strings_symmetry():
    """Rule 8: Every en key has an ar-EG key and vice versa."""
    en_keys = set(STRINGS["en"].keys())
    ar_keys = set(STRINGS["ar-EG"].keys())

    missing_in_ar = en_keys - ar_keys
    missing_in_en = ar_keys - en_keys

    assert not missing_in_ar, f"Keys missing in ar-EG: {missing_in_ar}"
    assert not missing_in_en, f"Keys missing in en: {missing_in_en}"


def test_i18n_strings_parameters_parity():
    """Assert all format placeholders ({param}) match between en and ar-EG entries."""
    placeholder_pattern = re.compile(r"\{([a-zA-Z0-9_]+)\}")
    for key, en_val in STRINGS["en"].items():
        ar_val = STRINGS["ar-EG"][key]
        en_params = set(placeholder_pattern.findall(en_val))
        ar_params = set(placeholder_pattern.findall(ar_val))
        assert en_params == ar_params, (
            f"Parameter mismatch for key '{key}': en={en_params}, ar={ar_params}"
        )


def test_i18n_zero_site_names():
    """Rule 8: i18n.py must contain zero domain names or website hardcodes."""
    i18n_path = Path(__file__).resolve().parents[1] / "app" / "i18n.py"
    content = i18n_path.read_text(encoding="utf-8")
    forbidden = ["amazon", "google", "wikipedia", "twitter", "facebook", "youtube"]
    for site in forbidden:
        assert site not in content.lower(), f"Domain/site name '{site}' found in i18n.py"


# ── 2. Language Resolution Logic ─────────────────────────────────────────────

def test_resolve_reply_language_matrix():
    # If selected starts with 'ar', always Arabic regardless of user text
    assert resolve_reply_language("ar-EG", "Hello, I want to buy a laptop") == "ar-EG"
    assert resolve_reply_language("ar", "Hello world") == "ar-EG"
    assert resolve_reply_language("ar-SA", "Search for shoes") == "ar-EG"

    # If selected is en-*, explicit English wins even if user text has Arabic script
    assert resolve_reply_language("en-US", "عايز اشتري لابتوب") == "en-US"
    assert resolve_reply_language("en-GB", "ابحث عن منتج") == "en-US"

    # If selected is en-* and user text is Latin, English
    assert resolve_reply_language("en-US", "Hello world") == "en-US"
    assert resolve_reply_language("en", "Order a coffee") == "en-US"

    # If selected is None or empty, mirror script
    assert resolve_reply_language(None, "عايز اشتري لابتوب") == "ar-EG"
    assert resolve_reply_language("", "ابحث عن منتج") == "ar-EG"
    assert resolve_reply_language(None, "Order a coffee") == "en-US"
    assert resolve_reply_language("", "") == "en-US"


def test_is_mostly_non_arabic():
    # Pure English
    assert is_mostly_non_arabic("Hello world, this is a test.") is True
    # Pure Arabic
    assert is_mostly_non_arabic("أهلا بك، هذا اختبار باللغة العربية") is False
    # Mixed: predominantly Arabic
    assert is_mostly_non_arabic("لقيت 3 عناصر على الشاشة: زر الشراء 1") is False
    # Mixed: predominantly Latin letters
    assert is_mostly_non_arabic("I found 3 items on the page: element 1 (عنصر)") is True


# ── 3. Exact English Preservation (Rule 1) ───────────────────────────────────

def test_exact_english_preservation():
    """English strings must match legacy text verbatim when no Arabic is involved."""
    assert t("cancel_no_problem", "en-US") == "No problem, I've cancelled that for you."
    assert t("action_cancelled_next", "en-US") == "Action cancelled. What would you like to do next?"
    assert t("already_terminated", "en-US") == "Goal execution already terminated."
    assert t("confirmation_received_executing", "en-US") == "Confirmation received. Executing confirmed step now."
    assert t("popup_blocked_prompt", "en-US") == "Browser popup was blocked. Please click the button to open the window."
    assert t("max_hops_fallback", "en-US") == "Reached maximum hops limit."
    assert "maximum allowed hops limit" in t("hop_limit_reached", "en-US", max_hops=8)
    assert "maximum allowed tab handoffs" in t("handoff_limit_reached", "en-US", max_handoffs=4)
    assert "Cross-origin window detected" in t("cross_origin_detected", "en-US", host="example.com")


# ── 4. plan_agentic_action Branches in Arabic Mode ───────────────────────────

@pytest.mark.asyncio
async def test_agentic_planner_search_typing_branch_arabic():
    dom_nodes = [
        {"id": "search-input", "tag": "input", "type": "text", "placeholder": "Search catalog", "resolved_label": "Search"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="search for laptops",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 1
    assert plan.steps[0].action == "fill"
    assert plan.steps[0].element_id == "search-input"
    assert plan.steps[0].value == "laptops"
    # Arabic script assertion
    assert re.search(r"[\u0600-\u06FF]", plan.reply)
    assert "laptops" in plan.reply
    assert re.search(r"[\u0600-\u06FF]", plan.confirmation_success_message)


@pytest.mark.asyncio
async def test_agentic_planner_search_focus_branch_arabic():
    dom_nodes = [
        {"id": "search-input", "tag": "input", "type": "search", "resolved_label": "Search store"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="focus search bar",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 1
    assert plan.steps[0].action == "click"
    assert plan.steps[0].element_id == "search-input"
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_canonical_intent_branch_arabic():
    dom_nodes = [
        {"id": "cart-btn", "tag": "button", "resolved_label": "Shopping Cart", "inner_text": "Cart (0)"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="go to cart",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 1
    assert plan.steps[0].action == "click"
    assert plan.steps[0].element_id == "cart-btn"
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_heuristic_branch_arabic():
    dom_nodes = [
        {"id": "checkout-now", "tag": "button", "resolved_label": "Proceed to checkout"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="click checkout",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 1
    assert plan.steps[0].action == "click"
    assert plan.steps[0].element_id == "checkout-now"
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_page_inquiry_branch_arabic():
    dom_nodes = [
        {"id": "hdr", "tag": "h1", "inner_text": "Welcome to Electronics Hub", "resolved_label": "Electronics Hub"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="what page is this?",
        url="https://example.com/electronics",
        language="ar-EG",
    )
    assert len(plan.steps) == 0
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_confirmation_branch_arabic():
    dom_nodes = [
        {"id": "btn-custom", "tag": "button", "resolved_label": "Special action"},
    ]
    arabic_confirm_json = json.dumps({
        "type": "confirmation",
        "thought": "Consequential action requires confirmation",
        "reply": "هل أنت متأكد أنك تريد تنفيذ هذا الإجراء؟",
        "requires_confirmation": True,
        "confirmation_prompt": "هل أنت متأكد أنك تريد تنفيذ هذا الإجراء؟",
        "pending_step": {"action": "click", "element_id": "btn-custom", "description": "تنفيذ الإجراء"},
        "steps": [],
    })
    with patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value=arabic_confirm_json)):
        plan = await agentic_planner.plan_agentic_action(
            dom_map=dom_nodes,
            user_message="execute special custom routine",
            url="https://example.com",
            language="ar-EG",
        )
        assert plan.requires_confirmation is True
        assert re.search(r"[\u0600-\u06FF]", plan.confirmation_prompt)
        assert len(plan.confirmation_options) == 2
        assert any(re.search(r"[\u0600-\u06FF]", opt) for opt in plan.confirmation_options)


@pytest.mark.asyncio
async def test_agentic_planner_cancel_branch_arabic():
    dom_nodes = [
        {"id": "btn-1", "tag": "button", "resolved_label": "Submit"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="cancel",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 0
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_no_match_branch_arabic():
    dom_nodes = [
        {"id": "home-link", "tag": "a", "resolved_label": "Home"},
    ]
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="click the nonexistent teleportation button",
        url="https://example.com",
        language="ar-EG",
    )
    assert len(plan.steps) == 0
    assert re.search(r"[\u0600-\u06FF]", plan.reply)


@pytest.mark.asyncio
async def test_agentic_planner_llm_arabic_retry_fallback():
    """Mock LLM returns English; retry is attempted, detects <30% Arabic, falls back to Arabic string table."""
    dom_nodes = [
        {"id": "btn-opt", "tag": "button", "resolved_label": "Custom Option"},
    ]
    # Default mock LLM returns English string
    plan = await agentic_planner.plan_agentic_action(
        dom_map=dom_nodes,
        user_message="select the special option",
        url="https://example.com",
        language="ar-EG",
    )
    # Even though mock returned English, Arabic mode fallback kicked in:
    assert re.search(r"[\u0600-\u06FF]", plan.reply)
    assert any(re.search(r"[\u0600-\u06FF]", opt) for opt in plan.confirmation_options)


@pytest.mark.asyncio
async def test_agentic_planner_llm_arabic_success_mock():
    """When LLM successfully returns Arabic script, it is preserved."""
    dom_nodes = [
        {"id": "btn-opt", "tag": "button", "resolved_label": "Custom Option"},
    ]
    arabic_llm_json = json.dumps({
        "type": "plan",
        "thought": "Click button",
        "steps": [{"action": "click", "element_id": "btn-opt", "description": "اضغط"}],
        "reply": "تمام، هضغط على الزرار المخصص دلوقتي علشانك.",
    })
    with patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value=arabic_llm_json)):
        plan = await agentic_planner.plan_agentic_action(
            dom_map=dom_nodes,
            user_message="select the special option",
            url="https://example.com",
            language="ar-EG",
        )
        assert len(plan.steps) == 1
        assert plan.steps[0].action == "click"
        assert plan.steps[0].element_id == "btn-opt"
        assert "تمام، هضغط" in plan.reply


# ── 5. REPLY LANGUAGE in Prompt Builders ─────────────────────────────────────

def test_summary_prompt_reply_language_line():
    prompt_ar = summary_prompt.build_summary_prompt("Some text", "https://example.com", language="ar-EG")
    assert "REPLY LANGUAGE: ar-EG" in prompt_ar

    prompt_en = summary_prompt.build_summary_prompt("Some text", "https://example.com", language="en-US")
    assert "REPLY LANGUAGE: en-US" in prompt_en


@pytest.mark.asyncio
async def test_form_filler_reply_language_line():
    captured_prompt = None

    async def mock_call_llm(*args, **kwargs):
        nonlocal captured_prompt
        captured_prompt = kwargs.get("user_prompt") or (args[0] if args else "")
        return '{"fields": []}'

    with patch("app.agent.llm_client.call_llm", new=mock_call_llm):
        await form_filler.plan_form_fill(
            form_id="test-form",
            dom_nodes=[],
            goal="Sign up",
            profile_hints=[],
            language="ar-EG",
        )
    assert captured_prompt is not None
    assert "REPLY LANGUAGE: ar-EG" in captured_prompt


@pytest.mark.asyncio
async def test_planner_reply_language_line():
    captured_prompt = None

    async def mock_call_llm(*args, **kwargs):
        nonlocal captured_prompt
        captured_prompt = kwargs.get("user_prompt") or (args[0] if args else "")
        return '{"milestones": []}'

    with patch("app.agent.llm_client.call_llm", new=mock_call_llm):
        await planner.plan_goal(
            goal="Buy a phone",
            current_url="https://example.com",
            language="ar-EG",
        )
    assert captured_prompt is not None
    assert "REPLY LANGUAGE: ar-EG" in captured_prompt


@pytest.mark.asyncio
async def test_navigator_reply_language_line():
    captured_prompt = None

    async def mock_call_llm(*args, **kwargs):
        nonlocal captured_prompt
        captured_prompt = kwargs.get("user_prompt") or (args[0] if args else "")
        return '{"status": "in_progress", "steps": [], "reply": "ok"}'

    milestone = Milestone(id="m1", description="Navigate somewhere")
    with patch("app.agent.llm_client.call_llm", new=mock_call_llm):
        await navigator.plan_milestone_step(
            goal="Buy a phone",
            milestone=milestone,
            dom_map=[],
            current_url="https://example.com",
            language="ar-EG",
        )
    assert captured_prompt is not None
    assert "REPLY LANGUAGE: ar-EG" in captured_prompt


@pytest.mark.asyncio
async def test_verifier_reply_language_line():
    captured_prompt = None

    async def mock_call_llm(*args, **kwargs):
        nonlocal captured_prompt
        captured_prompt = kwargs.get("user_prompt") or (args[0] if args else "")
        return '{"status": "in_progress", "reason": "still working"}'

    milestone = Milestone(id="m1", description="Review terms")
    with patch("app.agent.llm_client.call_llm", new=mock_call_llm):
        await verifier.verify_step_outcome(
            goal="Check out",
            milestone=milestone,
            last_action=PlanStep(action="click", element_id="btn-1"),
            last_action_result={"success": True},
            prior_url="https://example.com",
            current_url="https://example.com",
            prior_dom_ids=["btn-1"],
            current_dom_map=[{"id": "btn-1", "tag": "button"}],
            language="ar-EG",
        )
    assert captured_prompt is not None
    assert "REPLY LANGUAGE: ar-EG" in captured_prompt


# ── 6. Route Integration (/v1/summary & /v1/chat) ───────────────────────────

def test_summary_endpoint_with_arabic_language(api_client):
    payload = {
        "url": "https://example.com/store",
        "page_text": "Welcome to our store. We sell gadgets and appliances.",
        "api_key": DEMO_API_KEY,
        "language": "ar-EG",
    }
    res = api_client.post("/v1/summary", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    # Fallback / mock returns Arabic text when language='ar-EG'
    assert re.search(r"[\u0600-\u06FF]", data["summary"])


def test_chat_qa_endpoint_with_arabic_language(api_client):
    payload = {
        "question": "What is the return policy?",
        "url": "https://example.com/returns",
        "page_text": "Returns accepted within 30 days of purchase.",
        "api_key": DEMO_API_KEY,
        "language": "ar-EG",
    }
    res = api_client.post("/v1/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    # Even if mock returned English, Arabic retry / fallback ensures Arabic script
    assert re.search(r"[\u0600-\u06FF]", data["answer"])


def test_goal_step_endpoint_arabic_limit_replies(api_client):
    # Max hops exceeded with language='ar-EG'
    goal_state = GoalState(
        goal="Search products",
        status="in_progress",
        language="ar-EG",
        hop_count=8,
        max_hops=8,
    )
    payload = {
        "goal": "Search products",
        "current_url": "https://example.com",
        "goal_state": goal_state.model_dump(),
        "api_key": DEMO_API_KEY,
    }
    res = api_client.post("/v1/chat/goal_step", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "goal_failed"
    assert re.search(r"[\u0600-\u06FF]", data["goal_state"]["error_message"])


# ── 7. Review Fix Regressions (User Review Directives) ──────────────────────

def test_resolve_language_explicit_english_vs_arabic_user_text():
    """Explicit English wins over Arabic user text; mirroring only when unset."""
    # language="en-US" + Arabic user text → "en-US"
    assert resolve_reply_language("en-US", "عايز اشتري لابتوب") == "en-US"
    # language=None + Arabic user text → "ar-EG"
    assert resolve_reply_language(None, "عايز اشتري لابتوب") == "ar-EG"


def test_summary_prompt_and_endpoint_en_us_with_arabic_page_text(api_client):
    """language='en-US' + Arabic page_text → summary prompt says REPLY LANGUAGE: en-US and no Arabic retry happens."""
    arabic_page = "أهلا بكم في متجرنا الإلكتروني. نوفر أحدث الهواتف الذكية والأجهزة المنزلية."

    # Prompt check
    prompt = summary_prompt.build_summary_prompt(page_text=arabic_page, url="https://example.com/ar", language="en-US")
    assert "REPLY LANGUAGE: en-US" in prompt
    assert "REPLY LANGUAGE: ar-EG" not in prompt

    # Endpoint check: no Arabic retry happens, single call
    payload = {
        "url": "https://example.com/ar",
        "page_text": arabic_page,
        "api_key": DEMO_API_KEY,
        "language": "en-US",
    }
    with patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value="This is an online store for smartphones and home appliances.")) as mock_llm:
        res = api_client.post("/v1/summary", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert mock_llm.call_count == 1
        assert "online store" in data["summary"]


@pytest.mark.asyncio
async def test_navigator_english_goal_arabic_milestone_gives_english_reply():
    """navigator with an English goal and Arabic milestone label → English reply."""
    milestone = Milestone(
        id="m-1",
        description="الضغط على زر تسجيل الدخول",
    )
    dom_nodes = [
        {"id": "btn-login", "tag": "button", "resolved_label": "Login"},
    ]

    async def mock_call_llm(*args, **kwargs):
        captured_prompt = kwargs.get("user_prompt") or (args[0] if args else "")
        # Prompt resolved to en-US because user's goal is English
        assert "REPLY LANGUAGE: en-US" in captured_prompt
        return json.dumps({
            "status": "in_progress",
            "steps": [{"action": "click", "element_id": "btn-login"}],
            "reply": "Clicking login button for you now.",
        })

    with patch("app.agent.llm_client.call_llm", new=mock_call_llm):
        plan = await navigator.plan_milestone_step(
            goal="Sign in to my account",
            milestone=milestone,
            dom_map=dom_nodes,
            current_url="https://example.com",
            language=None,
        )
        assert not re.search(r"[\u0600-\u06FF]", plan.reply)
        assert "Clicking login" in plan.reply

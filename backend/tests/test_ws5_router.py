"""
Unit and Integration Tests for WS5 Intent Router in /v1/chat.
Verifies:
1. "اريد الاستفسار عن مخالفات المركبات" with no visible match routes to 'goal'.
2. "عايز ادفع الفاتورة" (Egyptian Arabic) routes to 'goal'.
3. "click login" with visible login button (score >= 0.85) routes to 'direct'.
4. "what is this page about" and "ما هو هذا الموقع" route to 'question'.
5. Inquire/pay/apply/register requests matching a link name still route to 'goal'.
6. Deterministic rule fallback when LLM is down or in limited mode.
7. Legacy contract_version < 3 maintains exact backwards-compatible behavior.
8. Zero domain/website hardcoding (Prime Directive).
9. Serializer-shaped nodes: resolved_label / aria_label / inner_text / placeholder / name (no "label" key).
10. Targetless scroll/navigation commands route to 'direct'.
"""

import pytest
import re
from unittest.mock import AsyncMock, patch, MagicMock
from starlette.testclient import TestClient

from app.main import app
from app.db.connection import get_db
from app.routes.chat import classify_intent_route, ChatRequest, ChatResponse
from app.models.goal import GoalState

DEMO_API_KEY = "atlas_00000000000000000000000000000000"


@pytest.fixture
def auth_client():
    async def override_get_db():
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.connection.validate_api_key", new=AsyncMock(side_effect=lambda db, k: k == DEMO_API_KEY)):
            with TestClient(app) as client:
                yield client
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_classifier_vehicle_violations_no_visible_match_routes_to_goal():
    """Arabic vehicle violations with no visible match routes to 'goal'."""
    q = "اريد الاستفسار عن مخالفات المركبات"
    dom_map = [
        {"id": "el_1", "tag": "a", "resolved_label": "الرئيسية", "inner_text": "الرئيسية", "visible": True},
        {"id": "el_2", "tag": "a", "resolved_label": "اتصل بنا", "inner_text": "اتصل بنا", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="ar-EG")
    assert route == "goal"
    assert node is None


@pytest.mark.asyncio
async def test_classifier_egyptian_arabic_bill_pay_routes_to_goal():
    """Egyptian colloquial Arabic 'عايز ادفع الفاتورة' routes to 'goal'."""
    q = "عايز ادفع الفاتورة"
    dom_map = [
        {"id": "el_10", "tag": "a", "resolved_label": "Home", "inner_text": "Home", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="ar-EG")
    assert route == "goal"


@pytest.mark.asyncio
async def test_classifier_direct_click_with_visible_match():
    """Short command with visible node matching score >= 0.85 routes to 'direct'."""
    q = "click login"
    dom_map = [
        {"id": "el_101", "tag": "button", "resolved_label": "Login", "inner_text": "Login", "visible": True},
        {"id": "el_102", "tag": "a", "resolved_label": "Register", "inner_text": "Register", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="en-US")
    assert route == "direct"
    assert node is not None
    assert node["id"] == "el_101"


@pytest.mark.asyncio
async def test_classifier_latent_node_does_not_route_direct():
    """Hidden/latent node (visible=False) cannot satisfy 'direct' routing."""
    q = "click submit"
    dom_map = [
        {"id": "el_201", "tag": "button", "resolved_label": "Submit", "inner_text": "Submit", "visible": False, "reveal_via": "el_100"},
    ]
    route, node = await classify_intent_route(q, dom_map, language="en-US")
    # Because the only matching node is latent (visible=False), it routes to goal
    assert route == "goal"
    assert node is None


@pytest.mark.asyncio
async def test_classifier_question_first_order():
    """Informational questions route to 'question' even if no visible node matches."""
    q = "what is this page about"
    dom_map = [
        {"id": "el_1", "tag": "a", "resolved_label": "Products", "inner_text": "Products", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="en-US")
    assert route == "question"
    assert node is None

    ar_q = "ما هو هذا الموقع"
    route, node = await classify_intent_route(ar_q, dom_map, language="ar-EG")
    assert route == "question"
    assert node is None


@pytest.mark.asyncio
async def test_classifier_task_phrasing_overrides_matching_link():
    """Requests to inquire/pay/apply/register are 'goal' even if a word matches a link."""
    q = "اريد الاستفسار عن مخالفات المركبات"
    # Even if there is a link named "استفسار"
    dom_map = [
        {"id": "el_50", "tag": "a", "resolved_label": "استفسار", "inner_text": "استفسار", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="ar-EG")
    assert route == "goal"


@pytest.mark.asyncio
async def test_classifier_llm_limited_mode_rule_fallback():
    """When LLM is in limited mode, rule fallback works without raising."""
    with patch("app.agent.llm_client.is_limited_mode", return_value=True):
        # 1. Goal phrasing
        r1, _ = await classify_intent_route("محتاج اقدم على طلب بطاقة", [], language="ar-EG")
        assert r1 == "goal"

        # 2. English question
        r2, _ = await classify_intent_route("where can I find the store hours?", [], language="en-US")
        assert r2 == "question"

        # 3. Direct command
        dom = [{"id": "el_42", "tag": "button", "resolved_label": "Sign In", "inner_text": "Sign In", "visible": True}]
        r3, n3 = await classify_intent_route("sign in", dom, language="en-US")
        assert r3 == "direct"
        assert n3["id"] == "el_42"


@pytest.mark.asyncio
async def test_classifier_targetless_scroll_and_nav_routes_to_direct():
    """Scroll and navigation commands without a target route directly to 'direct'."""
    dom_map = [
        {"id": "el_1", "tag": "button", "resolved_label": "Register", "inner_text": "Register", "visible": True},
    ]
    for cmd in ["scroll down", "go back", "انزل", "اطلع لفوق", "ارجع"]:
        route, node = await classify_intent_route(cmd, dom_map)
        assert route == "direct", f"Expected direct for '{cmd}', got '{route}'"
        assert node is None


def test_chat_endpoint_goal_routing_seeded_state(auth_client):
    """POST /v1/chat with contract_version=3 and goal intent returns seed GoalState with max_hops=15."""
    payload = {
        "url": "https://example.com/portal",
        "question": "اريد الاستفسار عن مخالفات المركبات",
        "language": "ar-EG",
        "contract_version": 3,
        "dom_map": [
            {"id": "el_1", "tag": "a", "resolved_label": "الرئيسية", "inner_text": "الرئيسية", "visible": True},
        ],
    }
    res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["intent_route"] == "goal"
    assert data["goal_state"] is not None
    assert data["goal_state"]["goal"] == "اريد الاستفسار عن مخالفات المركبات"
    assert data["goal_state"]["status"] == "in_progress"
    assert data["goal_state"]["max_hops"] == 15
    assert data["goal_state"]["hop_count"] == 0
    assert data["goal_state"]["language"] == "ar-EG"
    # Never return the "couldn't find an element" reply for a goal
    assert "couldn't find" not in data["answer"].lower()
    assert "لم أتمكن" not in data["answer"]


def test_chat_endpoint_direct_routing(auth_client):
    """POST /v1/chat with contract_version=3 and direct command returns intent_route='direct'."""
    payload = {
        "url": "https://example.com/demo",
        "question": "click home",
        "contract_version": 3,
        "dom_map": [
            {"id": "el_7", "tag": "a", "resolved_label": "Home", "inner_text": "Home", "visible": True},
            {"id": "el_8", "tag": "a", "resolved_label": "About", "inner_text": "About", "visible": True},
        ],
    }
    res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["intent_route"] == "direct"
    assert data["plan"] is not None
    assert len(data["plan"]["steps"]) > 0
    assert data["plan"]["steps"][0]["element_id"] == "el_7"


def test_chat_endpoint_question_routing(auth_client):
    """POST /v1/chat with contract_version=3 and question returns intent_route='question'."""
    with patch("app.agent.llm_client.call_llm", new=AsyncMock(return_value="This site provides general portal services.")):
        payload = {
            "url": "https://example.com/info",
            "question": "what is this page about",
            "contract_version": 3,
            "dom_map": [],
        }
        res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["intent_route"] == "question"
        assert "portal" in data["answer"]


def test_chat_endpoint_legacy_contract_v2_unchanged(auth_client):
    """POST /v1/chat with contract_version=2 keeps today's exact legacy behavior."""
    payload = {
        "url": "https://example.com/demo",
        "question": "click home",
        "contract_version": 2,
        "dom_map": [
            {"id": "el_7", "tag": "a", "resolved_label": "Home", "inner_text": "Home", "visible": True},
        ],
    }
    res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
    assert res.status_code == 200
    data = res.json()
    # Legacy response keeps intent_route as None
    assert data["intent_route"] is None
    assert data["goal_state"] is None


def test_router_prime_directive_zero_domain_hardcoding():
    """Verify zero domain names in chat.py router logic."""
    from pathlib import Path
    chat_path = Path(__file__).resolve().parents[1] / "app" / "routes" / "chat.py"
    content = chat_path.read_text(encoding="utf-8")
    for forbidden in ["google.com", "amazon.com", "drive.google.com", "github.com", "wikipedia.org"]:
        assert forbidden not in content, f"Prime Directive violation: {forbidden} found in chat.py"


@pytest.mark.asyncio
async def test_ws5_review_fixes_rules_only_limited_mode():
    """
    WS5 Review Fixes: Strict rule-only classification (LLM in limited mode).
    1. "click register" -> direct
    2. "اضغط تسجيل الدخول" -> direct
    3. "hello" / "thanks!" / "شكرا" / "ازيك" -> question
    4. "ما هي مواعيد التسجيل؟" -> question (interrogative start beats goal, no first-person want/need)
    5. "اريد الاستفسار عن مخالفات المركبات" -> goal
    6. "I want to renew my license" -> goal
    7. "عايز ادفع الفاتورة" -> goal
    """
    dom = [
        {"id": "el_1", "tag": "button", "resolved_label": "Register", "inner_text": "Register", "visible": True},
        {"id": "el_2", "tag": "button", "resolved_label": "تسجيل الدخول", "inner_text": "تسجيل الدخول", "visible": True},
    ]

    with patch("app.agent.llm_client.is_limited_mode", return_value=True):
        # 1. "click register" with visible Register -> direct
        r1, n1 = await classify_intent_route("click register", dom, language="en-US")
        assert r1 == "direct"
        assert n1["id"] == "el_1"

        # 2. "اضغط تسجيل الدخول" with visible تسجيل الدخول -> direct
        r2, n2 = await classify_intent_route("اضغط تسجيل الدخول", dom, language="ar-EG")
        assert r2 == "direct"
        assert n2["id"] == "el_2"

        # 3. Small talk: "hello" / "thanks!" / "شكرا" / "ازيك" -> question
        for greeting in ["hello", "thanks!", "شكرا", "ازيك"]:
            rg, _ = await classify_intent_route(greeting, dom, language="ar-EG")
            assert rg == "question", f"Expected question for {greeting}, got {rg}"

        # 4. "ما هي مواعيد التسجيل؟" -> question (interrogative start without want/need)
        r4, _ = await classify_intent_route("ما هي مواعيد التسجيل؟", dom, language="ar-EG")
        assert r4 == "question"

        # 5. "اريد الاستفسار عن مخالفات المركبات" -> goal
        r5, _ = await classify_intent_route("اريد الاستفسار عن مخالفات المركبات", dom, language="ar-EG")
        assert r5 == "goal"

        # 6. "I want to renew my license" -> goal
        r6, _ = await classify_intent_route("I want to renew my license", dom, language="en-US")
        assert r6 == "goal"

        # 7. "عايز ادفع الفاتورة" -> goal
        r7, _ = await classify_intent_route("عايز ادفع الفاتورة", dom, language="ar-EG")
        assert r7 == "goal"

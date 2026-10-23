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
        {"id": 1, "label": "الرئيسية", "role": "link", "visible": True},
        {"id": 2, "label": "اتصل بنا", "role": "link", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="ar-EG")
    assert route == "goal"
    assert node is None


@pytest.mark.asyncio
async def test_classifier_egyptian_arabic_bill_pay_routes_to_goal():
    """Egyptian colloquial Arabic 'عايز ادفع الفاتورة' routes to 'goal'."""
    q = "عايز ادفع الفاتورة"
    dom_map = [
        {"id": 10, "label": "Home", "role": "link", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="ar-EG")
    assert route == "goal"


@pytest.mark.asyncio
async def test_classifier_direct_click_with_visible_match():
    """Short command with visible node matching score >= 0.85 routes to 'direct'."""
    q = "click login"
    dom_map = [
        {"id": 101, "label": "Login", "role": "button", "visible": True},
        {"id": 102, "label": "Register", "role": "link", "visible": True},
    ]
    route, node = await classify_intent_route(q, dom_map, language="en-US")
    assert route == "direct"
    assert node is not None
    assert node["id"] == 101


@pytest.mark.asyncio
async def test_classifier_latent_node_does_not_route_direct():
    """Hidden/latent node (visible=False) cannot satisfy 'direct' routing."""
    q = "click submit"
    dom_map = [
        {"id": 201, "label": "Submit", "role": "button", "visible": False, "reveal_via": 100},
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
        {"id": 1, "label": "Products", "role": "link", "visible": True},
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
        {"id": 50, "label": "استفسار", "role": "link", "visible": True},
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
        dom = [{"id": 42, "label": "Sign In", "role": "button", "visible": True}]
        r3, n3 = await classify_intent_route("sign in", dom, language="en-US")
        assert r3 == "direct"
        assert n3["id"] == 42


def test_chat_endpoint_goal_routing_seeded_state(auth_client):
    """POST /v1/chat with contract_version=3 and goal intent returns seed GoalState with max_hops=15."""
    payload = {
        "url": "https://example.com/portal",
        "question": "اريد الاستفسار عن مخالفات المركبات",
        "language": "ar-EG",
        "contract_version": 3,
        "dom_map": [
            {"id": 1, "label": "الرئيسية", "role": "link", "visible": True},
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
            {"id": 7, "label": "Home", "role": "link", "visible": True},
            {"id": 8, "label": "About", "role": "link", "visible": True},
        ],
    }
    res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["intent_route"] == "direct"
    assert data["plan"] is not None
    assert len(data["plan"]["steps"]) > 0
    assert data["plan"]["steps"][0]["element_id"] == "7"


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
            {"id": 7, "label": "Home", "role": "link", "visible": True},
        ],
    }
    res = auth_client.post("/v1/chat", headers={"X-Atlas-Key": DEMO_API_KEY}, json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
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

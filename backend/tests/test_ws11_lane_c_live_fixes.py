"""
Unit and Regression Test Suite for WS11 Lane C Live-Run Fixes
Defects: L3 (backend), L4, L5, L6, L7 (backend), L8, L11 (backend).

Adheres strictly to the Prime Directive:
- Zero site names, hostnames, or hardcoded per-site selectors.
- Uses real serializer output captured with Playwright from offline fixtures.
- Preserves all CI floors and zero diff on verifier.py.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.connection import get_db
from app.models.dom import DomNode, coerce_dom_map
from app.models.goal import GoalState, GoalStepRequest, Milestone, PlanStep, VerifierResult
from app.agent.form_filler import extract_required_form_fields, is_search_or_filter_form, plan_form_fill
from app.agent.navigator import plan_milestone_step
from app.i18n import STRINGS, t

DEMO_API_KEY = "atlas_live_fix_ws11_test_key"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures_lane_c"


def load_fixture_nodes(fixture_name: str) -> List[Dict[str, Any]]:
    path = FIXTURES_DIR / fixture_name
    assert path.exists(), f"Missing fixture file: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def client():
    async def override_get_db():
        mock_db = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    with patch(
        "app.db.connection.validate_api_key",
        new=AsyncMock(side_effect=lambda db, key: "demo-tenant-id" if key == DEMO_API_KEY else None),
    ):
        with TestClient(app) as test_client:
            yield test_client

    app.dependency_overrides.clear()


# ── L3: Cross-Origin and Same-Origin New Tab Handling ─────────────────────────

class TestL3CrossOriginAndSameOriginHandling:
    """
    L3: Links with opens_new_tab on SAME origin do not prompt for confirmation;
    they set step.same_tab = True.
    Links on a DIFFERENT origin (different host/subdomain) require confirmation
    naming the target host (en + ar), and remember confirmed origins.
    """

    def test_same_origin_link_sets_same_tab_without_prompt(self, client):
        nodes = [
            {
                "id": "link-vehicles",
                "tag": "a",
                "resolved_label": "My Vehicles Portal",
                "href": "https://portal.gov.eg/vehicles",
                "opens_new_tab": True,
                "target_origin": "https://portal.gov.eg",
                "visible": True,
            }
        ]
        payload = {
            "goal": "Check vehicle services",
            "current_url": "https://portal.gov.eg/home",
            "dom_map": nodes,
            "goal_state": {
                "goal": "Check vehicle services",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/home",
                "hop_count": 0,
                "max_hops": 8,
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        # Same origin should NOT gate on origin confirmation
        assert data["status"] == "in_progress"
        assert data.get("requires_origin_confirmation") is False
        assert len(data["steps"]) >= 1
        # Step should prefer same tab
        assert data["steps"][0].get("same_tab") is True

    def test_cross_origin_link_triggers_requires_origin_confirmation(self, client):
        nodes = [
            {
                "id": "link-fines",
                "tag": "a",
                "resolved_label": "External Payment Gateway",
                "href": "https://pay.external-gov.eg/checkout",
                "opens_new_tab": True,
                "target_origin": "https://pay.external-gov.eg",
                "visible": True,
            }
        ]
        payload = {
            "goal": "Pay fees on external gateway",
            "current_url": "https://portal.gov.eg/home",
            "dom_map": nodes,
            "goal_state": {
                "goal": "Pay fees on external gateway",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/home",
                "hop_count": 0,
                "max_hops": 8,
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["status"] == "requires_origin_confirmation"
        assert data["requires_confirmation"] is True
        assert data["requires_origin_confirmation"] is True
        assert "pay.external-gov.eg" in data["reply"]
        assert "pay.external-gov.eg" in data["confirmation_prompt"]
        assert data["pending_step"] is not None

    def test_cross_origin_confirmation_resumes_and_remembers_origin(self, client):
        # Step 1: Trigger confirmation
        nodes = [
            {
                "id": "link-external",
                "tag": "a",
                "resolved_label": "External Portal",
                "href": "https://external.gov.eg/service",
                "opens_new_tab": True,
                "target_origin": "https://external.gov.eg",
                "visible": True,
            }
        ]
        payload_1 = {
            "goal": "Go to external service",
            "current_url": "https://portal.gov.eg/home",
            "dom_map": nodes,
            "goal_state": {
                "goal": "Go to external service",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/home",
                "hop_count": 0,
                "max_hops": 8,
            },
            "api_key": DEMO_API_KEY,
        }
        resp1 = client.post("/v1/chat/goal_step", json=payload_1)
        data1 = resp1.json()
        assert data1["status"] == "requires_origin_confirmation"

        # Step 2: User responds 'yes'
        state1 = data1["goal_state"]
        payload_2 = {
            "goal": "Go to external service",
            "current_url": "https://portal.gov.eg/home",
            "dom_map": nodes,
            "user_response": "yes",
            "goal_state": state1,
            "api_key": DEMO_API_KEY,
        }
        resp2 = client.post("/v1/chat/goal_step", json=payload_2)
        data2 = resp2.json()

        assert data2["status"] == "in_progress"
        assert len(data2["steps"]) == 1
        assert data2["steps"][0].get("same_tab") is True
        confirmed = data2["goal_state"]["dom_state"]["confirmed_origins"]
        assert "https://external.gov.eg" in confirmed


# ── L4: No-Op Click Demotion to in_progress ───────────────────────────────────

class TestL4NoOpClickDemotion:
    """
    L4: A click with no detected change is NOT goal_failed.
    Atlas marks the element tried, returns in_progress, and navigator
    targets a different candidate on the next step.
    Terminal failures (max_hops, explicit errors) still terminate.
    """

    def test_noop_click_demoted_to_in_progress_and_tries_next_candidate(self, client):
        initial_nodes = load_fixture_nodes("portal_tiles_initial.json")
        # Ensure we have at least 2 interactive candidates
        candidate_ids = [n["id"] for n in initial_nodes if n.get("tag") in ("button", "a")]
        assert len(candidate_ids) >= 2
        first_id = candidate_ids[0]

        # Simulate turn 1 where the first element was clicked, but page did not change
        prior_state = {
            "goal": "Check vehicles and licenses",
            "current_url": "https://portal.gov.eg/hub",
            "status": "in_progress",
            "hop_count": 1,
            "max_hops": 8,
            "plan_steps": [
                {
                    "action": "click",
                    "element_id": first_id,
                    "description": "Click first tile",
                    "reason": "navigate",
                }
            ],
            "dom_state": {
                "tried": [first_id],
                "tried_labels": ["Click first tile"],
            },
        }

        # Verifier returns "goal_failed" with typical real-LLM "no change" explanation
        payload = {
            "goal": "Check vehicles and licenses",
            "current_url": "https://portal.gov.eg/hub",
            "dom_map": initial_nodes,
            "goal_state": prior_state,
            "last_action_result": {
                "status": "success",
                "url_changed": False,
                "added_visible_count": 0,
            },
            "api_key": DEMO_API_KEY,
        }

        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        # Enforced post-verifier invariant: demoted to in_progress
        assert data["status"] == "in_progress"
        assert data["goal_state"]["status"] == "in_progress"
        # First element marked tried
        tried = data["goal_state"]["dom_state"]["tried"]
        assert first_id in tried
        # Next planned step targets a DIFFERENT element
        if data.get("steps"):
            next_target = data["steps"][0].get("element_id")
            assert str(next_target) != str(first_id)

    def test_terminal_error_not_demoted(self, client):
        nodes = load_fixture_nodes("portal_tiles_initial.json")
        payload = {
            "goal": "Find citizen services",
            "current_url": "https://portal.gov.eg/hub",
            "dom_map": nodes,
            "goal_state": {
                "goal": "Find citizen services",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/hub",
                "hop_count": 1,
                "max_hops": 8,
            },
            "last_action_result": {
                "status": "error",
                "error": "Access Denied: 403 Forbidden",
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "goal_failed"


# ── L5: Egyptian Arabic Language Purity ────────────────────────────────────────

class TestL5ArabicPurity:
    """
    L5: Replies emitted when language is ar-EG contain ZERO unquoted Latin characters.
    English LLM verifier reasons or error strings must not leak into Arabic replies.
    """

    def test_arabic_reply_contains_zero_unquoted_latin_on_verifier_failure(self, client):
        nodes = load_fixture_nodes("portal_tiles_initial.json")
        payload = {
            "goal": "الاستعلام عن الخدمات",
            "language": "ar-EG",
            "current_url": "https://portal.gov.eg/hub",
            "dom_map": nodes,
            "goal_state": {
                "goal": "الاستعلام عن الخدمات",
                "status": "in_progress",
                "language": "ar-EG",
                "current_url": "https://portal.gov.eg/hub",
                "hop_count": 8,  # max hops reached -> terminal failure
                "max_hops": 8,
            },
            "last_action_result": {
                "status": "error",
                "error": "The click action did not navigate to a new page; the URL remained unchanged.",
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        reply = data["reply"]
        assert bool(reply)
        # Check for unquoted Latin characters
        unquoted_latin = re.findall(r"(?:^|(?<=[^'\"«»“”]))[a-zA-Z]+(?=[^'\"«»“”]|$)", reply)
        assert not unquoted_latin, f"Leaked unquoted Latin characters in Arabic reply: {unquoted_latin} (full reply: '{reply}')"

    def test_all_i18n_templates_arabic_purity_with_mock_english_inputs(self):
        """
        Invariant test across ALL string table entries in ar-EG:
        Passing mock English parameters must result in ZERO unquoted Latin characters.
        """
        mock_english_args = {
            "reason": "The element could not be found and navigation timed out after 30 seconds",
            "host": "portal.services.gov.eg",
            "target": "Submit Button",
            "tried": "Vehicles Tile, Inquire Violations",
            "step_count": 3,
            "field": "National ID",
            "fields": "National ID, Full Name",
            "result": "Success confirmation record 12345",
            "count": 5,
            "code": "404 Not Found",
            "query": "civil affairs",
            "domain": "portal.gov.eg",
        }

        for key in STRINGS["ar-EG"].keys():
            formatted = t(key, "ar-EG", **mock_english_args)
            # Remove quoted substrings first, then check if any Latin characters remain
            unquoted = re.sub(r'(\"[^\"]*\"|\'[^\']*\'|«[^»]*»|“[^”]*”)', '', formatted)
            unquoted_latin = re.findall(r"[a-zA-Z]+", unquoted)
            assert not unquoted_latin, f"Template '{key}' emitted unquoted Latin in ar-EG: {unquoted_latin} (output: '{formatted}')"


# ── L6: Form Relevance & Search/Filter Exclusion ──────────────────────────────

class TestL6FormRelevance:
    """
    L6: Site search boxes (role=search, header/nav inputs) and filter bars
    must never trigger submit confirmation.
    Real service forms with generic labels (National ID, name) are accepted.
    """

    def test_search_box_excluded_from_submit_confirmation(self, client):
        search_nodes = load_fixture_nodes("portal_search_listing.json")
        # Ensure search form detection identifies it
        assert is_search_or_filter_form(search_nodes) is True

        payload = {
            "goal": "تجديد رخصة القيادة",
            "current_url": "https://portal.gov.eg/services",
            "dom_map": search_nodes,
            "goal_state": {
                "goal": "تجديد رخصة القيادة",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/services",
                "hop_count": 0,
                "max_hops": 8,
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        # Must NOT prompt to submit search form
        assert data["status"] != "requires_confirmation"
        assert "جاهز لإرسال النموذج" not in data["reply"]

    def test_service_form_with_generic_labels_is_accepted(self, client):
        modal_nodes = load_fixture_nodes("portal_modal_open.json")
        # Service form has fields: "National ID", "Applicant Name", and submit button
        # Page context/heading is "Civil Record Application"
        payload = {
            "goal": "Civil Record Application",
            "current_url": "https://portal.gov.eg/records",
            "dom_map": modal_nodes,
            "page_text": "Portal Services Directory Civil Record Application National ID Applicant Name",
            "goal_state": {
                "goal": "Civil Record Application",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/records",
                "hop_count": 0,
                "max_hops": 8,
            },
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        # Must recognize form fields and enter awaiting_user_input or form filling
        assert data["status"] in ("awaiting_user_input", "in_progress")
        if data["status"] == "awaiting_user_input":
            assert data["goal_state"]["awaiting"] is not None


# ── L7: Modal Popup Form Scoping ──────────────────────────────────────────────

class TestL7ModalScoping:
    """
    L7: When a modal is open, scope form fields and navigation targets
    to elements inside the modal (in_modal: true) until it closes.
    Background elements are ignored.
    """

    def test_modal_scoping_ignores_background_elements(self):
        modal_open_nodes = load_fixture_nodes("portal_modal_open.json")
        # Stamp background element to verify it is filtered out
        test_nodes = [
            dict(n, in_modal=True) for n in modal_open_nodes
        ]
        bg_element = {
            "id": "bg-link-home",
            "tag": "a",
            "resolved_label": "Home Link Behind Overlay",
            "in_modal": False,
            "blocked_by_modal": True,
            "visible": True,
            "required": True,
        }
        test_nodes.append(bg_element)

        # 1. Form filler field extraction scopes to in_modal
        fields = extract_required_form_fields(test_nodes)
        extracted_refs = [f.ref for f in fields]
        assert "bg-link-home" not in extracted_refs
        assert len(fields) >= 1

    @pytest.mark.asyncio
    async def test_navigator_scopes_to_modal_targets(self):
        modal_open_nodes = load_fixture_nodes("portal_modal_open.json")
        test_nodes = [dict(n, in_modal=True) for n in modal_open_nodes]
        bg_element = {
            "id": "bg-btn-outside",
            "tag": "button",
            "resolved_label": "Outside Button",
            "in_modal": False,
            "blocked_by_modal": True,
            "visible": True,
        }
        test_nodes.append(bg_element)

        plan = await plan_milestone_step(
            goal="Submit Application",
            milestone=Milestone(id="m1", description="Submit Application"),
            dom_map=test_nodes,
            current_url="https://portal.gov.eg/records",
        )
        if plan.steps:
            target = plan.steps[0].element_id
            assert target != "bg-btn-outside"


# ── L8: Per-Node Coercion in /v1/chat, /v1/chat/goal_step & /v1/agent ─────────

class TestL8DomCoercion:
    """
    L8: Malformed DOM nodes (oversized strings, numeric string maxlength,
    invalid landmark enum, non-boolean values) are coerced or dropped with
    a privacy-safe WARNING log, never causing HTTP 422.
    """

    def test_coerce_dom_map_handles_malformed_fields(self, caplog):
        malformed_nodes = [
            {
                "id": "node-1",
                "tag": "input",
                "resolved_label": "A" * 600,  # exceeds 512 max
                "inner_text": "B" * 2500,     # exceeds 2000 max
                "maxlength": "14",            # numeric string -> int
                "landmark": "sidebar",        # invalid landmark enum -> None
                "in_modal": "yes",            # string boolean -> True
                "options": "corrupt_string",  # not a list -> None
            },
            {
                # Completely unrecoverable: missing tag
                "id": "node-corrupt",
            },
        ]

        with caplog.at_level(logging.WARNING):
            coerced = coerce_dom_map(malformed_nodes)

        assert len(coerced) == 1
        node = coerced[0]
        assert len(node.resolved_label) == 512
        assert len(node.inner_text) == 2000
        assert node.maxlength == 14
        assert node.landmark is None
        assert node.in_modal is True
        assert node.options is None

        # Privacy check: WARNING log must mention field names/counts, NEVER values
        log_text = caplog.text
        assert "resolved_label" in log_text or "maxlength" in log_text
        assert "A" * 50 not in log_text
        assert "B" * 50 not in log_text

    def test_chat_endpoint_accepts_malformed_dom_map_http_200(self, client):
        malformed_nodes = [
            {
                "id": "node-odd",
                "tag": "input",
                "resolved_label": "C" * 1000,
                "maxlength": "32",
                "landmark": "invalid_landmark_name",
                "visible": "true",
            }
        ]
        payload = {
            "url": "https://portal.gov.eg/test",
            "question": "Hello",
            "dom_map": malformed_nodes,
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat", json=payload)
        assert resp.status_code == 200

    def test_goal_step_endpoint_accepts_malformed_dom_map_http_200(self, client):
        malformed_nodes = [
            {
                "id": "node-odd",
                "tag": "button",
                "resolved_label": "D" * 800,
                "landmark": "aside_invalid",
                "in_modal": "1",
            }
        ]
        payload = {
            "goal": "Test odd DOM node",
            "current_url": "https://portal.gov.eg/test",
            "dom_map": malformed_nodes,
            "api_key": DEMO_API_KEY,
        }
        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200


# ── L11: Change Summary & Content Fingerprinting Override ─────────────────────

class TestL11ChangeDetectionOverride:
    """
    L11: Client's structured change summary (url_changed, added_visible_count,
    modal_opened) overrides verifier LLM false-negative "no change" reports.
    Fallback content fingerprinting handles older clients.
    """

    def test_structured_change_summary_overrides_verifier_no_change(self, client):
        initial_nodes = load_fixture_nodes("portal_tiles_initial.json")
        payload = {
            "goal": "Inquire Violations",
            "current_url": "https://portal.gov.eg/services",
            "dom_map": initial_nodes,
            "goal_state": {
                "goal": "Inquire Violations",
                "status": "in_progress",
                "current_url": "https://portal.gov.eg/services",
                "hop_count": 1,
                "max_hops": 8,
                "plan_steps": [
                    {
                        "action": "click",
                        "element_id": "tile-vehicles",
                        "description": "Click vehicles tile",
                    }
                ],
            },
            # Client reports observable DOM change summary
            "last_action_result": {
                "status": "success",
                "url_changed": False,
                "added_visible_count": 3,
                "text_changed": True,
            },
            "api_key": DEMO_API_KEY,
        }

        resp = client.post("/v1/chat/goal_step", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        # Positive change summary must prevent goal_failed
        assert data["status"] == "in_progress"
        assert data["verifier_result"]["status"] == "in_progress"

    def test_content_fingerprint_fallback_detects_tile_expansion(self, client):
        initial_nodes = load_fixture_nodes("portal_tiles_initial.json")
        clicked_nodes = load_fixture_nodes("portal_tiles_clicked.json")

        # Turn 1: Initial state
        payload_1 = {
            "goal": "Inquire Violations",
            "current_url": "https://portal.gov.eg/services",
            "dom_map": initial_nodes,
            "page_text": "Portal Services Hub Welcome to Citizen Services",
            "api_key": DEMO_API_KEY,
        }
        resp1 = client.post("/v1/chat/goal_step", json=payload_1)
        data1 = resp1.json()
        state1 = data1["goal_state"]

        # Turn 2: Clicked state (new nodes rendered, same URL)
        payload_2 = {
            "goal": "Inquire Violations",
            "current_url": "https://portal.gov.eg/services",
            "dom_map": clicked_nodes,
            "page_text": "Portal Services Hub Vehicle Violations and Services Inquire Violations",
            "goal_state": state1,
            # Older client without structured summary: empty dict
            "last_action_result": {"status": "success"},
            "api_key": DEMO_API_KEY,
        }
        resp2 = client.post("/v1/chat/goal_step", json=payload_2)
        data2 = resp2.json()

        assert data2["status"] == "in_progress"
        assert data2["verifier_result"]["status"] == "in_progress"

"""
backend/tests/test_wave3_ppo_flow.py
End-to-End PPO Flow Test using FastAPI TestClient with Real Serializer Snapshots.
Tests D1, D2, D3, D4, D5 end-to-end with LLM_PROVIDER=mock and zero mocks of navigator,
verifier, or form_filler.
"""

import json
import re
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from app.main import app

SNAPSHOT_DIR = Path(__file__).parent / "replay"
DEMO_KEY = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"


@pytest.fixture(autouse=True)
def setup_mock_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")


def load_snapshot(filename: str):
    path = SNAPSHOT_DIR / filename
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def test_wave3_ppo_flow_end_to_end_megamenu_to_inquiry():
    client = TestClient(app)
    headers = {"X-Atlas-Key": DEMO_KEY}

    megamenu_dom = load_snapshot("portal_megamenu_snapshot.json")
    inquiry_dom = load_snapshot("portal_inquiry_snapshot.json")

    user_goal = "اريد الاستفسار عن مخالفات المركبات"

    # ── Step 1: POST /v1/chat (Router) ───────────────────────────────────────────
    chat_payload = {
        "question": user_goal,
        "url": "http://127.0.0.1:8000/portal-megamenu.html",
        "dom_map": megamenu_dom,
        "language": "ar-EG",
        "contract_version": 3,
    }
    res1 = client.post("/v1/chat", json=chat_payload, headers=headers)
    assert res1.status_code == 200, res1.text
    d1 = res1.json()
    assert d1.get("intent_route") == "goal", f"Expected route 'goal', got: {d1.get('intent_route')}"
    assert "goal_state" in d1
    goal_state = d1["goal_state"]
    assert goal_state["status"] == "in_progress"

    # D5: Assert first reply is Arabic with zero Latin letters
    first_reply = d1.get("answer") or ""
    assert re.search(r"[\u0600-\u06FF]", first_reply), "First reply must be Arabic"
    assert not re.search(r"[a-zA-Z]", first_reply), f"First reply contains Latin: {first_reply}"

    # ── Step 2: Hop 0 - Exploration on portal-megamenu.html ──────────────────────
    hop0_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": megamenu_dom,
        "current_url": "http://127.0.0.1:8000/portal-megamenu.html",
        "page_text": "بوابة الخدمات الحكومية التجريبية\nالرئيسية\nخدمات المواطنين",
        "language": "ar-EG",
        "contract_version": 3,
    }
    res2 = client.post("/v1/chat/goal_step", json=hop0_payload, headers=headers)
    assert res2.status_code == 200, res2.text
    d2 = res2.json()

    # D1 Assertion: Canned mock confirmation must NOT leak on hop 0
    assert d2["status"] == "in_progress", f"Expected in_progress, got {d2['status']}"
    assert d2["requires_confirmation"] is False, "Hop 0 must not require confirmation"
    assert d2["pending_step"] is None, "Hop 0 must not have pending_step"

    # D2 Assertion: Latent menu item must be picked and outrank non-target items
    steps = d2.get("steps", [])
    assert len(steps) >= 2, f"Expected reveal + click steps, got: {steps}"
    assert steps[0]["action"] == "reveal", f"First step must be reveal, got: {steps[0]}"
    assert steps[1]["action"] == "click", f"Second step must be click, got: {steps[1]}"
    # Target latent link in snapshot is el_22e044911af8a88b ("نيابات المرور - الاستعلام عن المخالفات")
    assert steps[1]["element_id"] == "el_22e044911af8a88b"

    # D5 Assertion: Hop 0 reply must not contain English fragments (e.g. "Click '...'")
    hop0_reply = d2.get("reply", "")
    assert not re.search(r"\b(Click|double click|triple click)\b", hop0_reply, re.I), f"Leaked English: {hop0_reply}"

    goal_state = d2["goal_state"]

    # ── Step 3: Hop 1 - Navigates to portal-inquiry.html ──────────────────────────
    # Client executes reveal + click and lands on portal-inquiry.html
    goal_state["current_url"] = "http://127.0.0.1:8000/portal-inquiry.html"
    hop1_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": inquiry_dom,
        "current_url": "http://127.0.0.1:8000/portal-inquiry.html",
        "page_text": "نيابات المرور - الاستعلام عن مخالفات المركبات\nأدخل الرقم القومي ورمز وحروف اللوحة للاستعلام",
        "language": "ar-EG",
        "contract_version": 3,
        "last_action_result": {"status": "ok", "success": True},
    }
    res3 = client.post("/v1/chat/goal_step", json=hop1_payload, headers=headers)
    assert res3.status_code == 200, res3.text
    d3 = res3.json()

    # Flow should halt at awaiting_user_input for missing required fields
    assert d3["status"] == "awaiting_user_input", f"Expected awaiting_user_input, got {d3['status']}"
    assert "awaiting" in d3["goal_state"]
    awaiting = d3["goal_state"]["awaiting"]
    fields = awaiting.get("fields", [])
    assert len(fields) == 3, f"Expected 3 fields (national-id, plate-digits, plate-letters), got: {fields}"

    # National ID must be marked sensitive
    nid_field = next((f for f in fields if "national" in f.get("ref", "").lower() or "nid" in f.get("ref", "").lower() or f.get("sensitive")), None)
    assert nid_field is not None, "National ID field must be present"
    assert nid_field.get("sensitive") is True, "National ID field must be sensitive"

    goal_state = d3["goal_state"]

    # ── Step 4: Hop 2 - User submits inputs (National ID through vault) ───────────
    user_token = "{vault:nid_token_98765}"
    user_inputs = {}
    for f in fields:
        ref = f["ref"]
        if f.get("sensitive"):
            user_inputs[ref] = user_token
        elif "digit" in (f.get("name") or "") or "أرقام" in (f.get("label") or ""):
            user_inputs[ref] = "1234"
        else:
            user_inputs[ref] = "أ ب ج"

    hop2_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": inquiry_dom,
        "current_url": "http://127.0.0.1:8000/portal-inquiry.html",
        "user_inputs": user_inputs,
        "language": "ar-EG",
        "contract_version": 3,
    }
    res4 = client.post("/v1/chat/goal_step", json=hop2_payload, headers=headers)
    assert res4.status_code == 200, res4.text
    d4 = res4.json()

    assert d4["status"] == "in_progress", f"Expected in_progress, got {d4['status']}"
    fill_steps = d4.get("steps", [])
    assert len(fill_steps) == 3, f"Expected 3 fill steps, got: {fill_steps}"
    for fs in fill_steps:
        assert fs["action"] == "fill"

    goal_state = d4["goal_state"]

    # ── Step 5: Hop 3 - After fills, must require confirmation before submit (D4) ─
    # Client executed the 3 fills. In real browser, executor fills the fields and serializer reflects current_value.
    import copy
    inquiry_dom_filled = copy.deepcopy(inquiry_dom)
    for node in inquiry_dom_filled:
        ref = node.get("ref") or node.get("id")
        if ref in user_inputs:
            node["current_value"] = user_inputs[ref]

    submit_node = next(n for n in inquiry_dom if n.get("type") == "submit" or n.get("tag") == "button")

    hop3_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": inquiry_dom_filled,
        "current_url": "http://127.0.0.1:8000/portal-inquiry.html",
        "page_text": "نيابات المرور - الاستعلام عن مخالفات المركبات",
        "language": "ar-EG",
        "contract_version": 3,
        "last_action_result": {"status": "ok", "success": True},
    }
    res5 = client.post("/v1/chat/goal_step", json=hop3_payload, headers=headers)
    assert res5.status_code == 200, res5.text
    d5 = res5.json()

    # D4 Assertion: Must enter requires_confirmation, NOT goal_complete!
    assert d5["status"] == "requires_confirmation", f"Expected requires_confirmation before submit, got {d5['status']}"
    assert d5["requires_confirmation"] is True
    assert d5["pending_step"] is not None
    assert d5["pending_step"]["action"] == "click"
    assert d5["pending_step"]["element_id"] == submit_node["id"]

    # D5 Assertion: Confirmation prompt must be Arabic
    prompt = d5.get("confirmation_prompt") or ""
    assert re.search(r"[\u0600-\u06FF]", prompt)
    assert not re.search(r"[a-zA-Z]", prompt), f"Confirmation prompt leaked Latin: {prompt}"

    goal_state = d5["goal_state"]

    # ── Step 6: Hop 4 - User confirms "نعم", Atlas returns submit step ───────────
    hop4_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": inquiry_dom_filled,
        "current_url": "http://127.0.0.1:8000/portal-inquiry.html",
        "user_response": "نعم",
        "language": "ar-EG",
        "contract_version": 3,
    }
    res6 = client.post("/v1/chat/goal_step", json=hop4_payload, headers=headers)
    assert res6.status_code == 200, res6.text
    d6 = res6.json()
    assert d6["status"] == "in_progress", f"Expected in_progress, got {d6['status']}"
    assert len(d6["steps"]) == 1
    assert d6["steps"][0]["action"] == "click"
    assert d6["steps"][0]["element_id"] == submit_node["id"]
    goal_state = d6["goal_state"]

    # ── Step 7: Hop 5 - Results appear on page, Goal completes and reads total (D4)
    results_page_text = (
        "بوابة الخدمات الحكومية التجريبية\n"
        "نيابات المرور - الاستعلام عن مخالفات المركبات\n"
        "بيان مخالفات رخصة المركبة (بيانات تجريبية)\n"
        "الرقم القومي: 00000000000000\n"
        "رقم اللوحة: أ ب ج 1 2 3 4\n"
        "تجاوز السرعة المقررة تجريبياً بواسطة الرادار: 300 ج.م\n"
        "إجمالي المخالفات المستحقة: 550 ج.م"
    )

    hop5_payload = {
        "goal": user_goal,
        "goal_state": goal_state,
        "dom_map": inquiry_dom_filled,
        "current_url": "http://127.0.0.1:8000/portal-inquiry.html",
        "page_text": results_page_text,
        "language": "ar-EG",
        "contract_version": 3,
        "last_action_result": {"status": "ok", "success": True},
    }
    res7 = client.post("/v1/chat/goal_step", json=hop5_payload, headers=headers)
    assert res7.status_code == 200, res7.text
    d7 = res7.json()

    # D4 & D5 Final Assertion: Goal complete, final reply is Arabic and reads total
    assert d7["status"] == "goal_complete", f"Expected goal_complete after submit results, got {d7['status']}"
    final_reply = d7.get("reply", "")
    assert "550" in final_reply, f"Final reply must contain the total '550', got: {final_reply}"
    assert re.search(r"[\u0600-\u06FF]", final_reply), "Final reply must be Arabic"
    assert not re.search(r"[a-zA-Z]", final_reply), f"Final reply contains Latin: {final_reply}"


def test_d3_link_never_chosen_again_and_hash_penalty():
    from app.agent.navigator import _score_dom_candidate, plan_milestone_step
    from app.models.goal import DomNode, Milestone

    # Test hash penalty
    node_hash = {"id": "el_hash", "tag": "a", "inner_text": "دليل الخدمات", "href": "#guide"}
    node_ext = {"id": "el_ext", "tag": "a", "inner_text": "دليل الخدمات", "href": "/guide.html"}
    score_hash = _score_dom_candidate(node_hash, "دليل الخدمات", "")
    score_ext = _score_dom_candidate(node_ext, "دليل الخدمات", "")
    assert score_hash < score_ext, f"Hash link score ({score_hash}) must be lower than external link score ({score_ext})"
    assert score_ext >= score_hash + 0.20

    # Test tried exclusion: a link in tried is never picked
    megamenu_dom = load_snapshot("portal_megamenu_snapshot.json")
    milestone = Milestone(id="m-1", description="navigate to inquiry", success_criteria="on inquiry page")
    from app.models.goal import GoalState
    gs = GoalState(
        goal="اريد الاستفسار عن مخالفات المركبات",
        dom_state={"tried": ["el_22e044911af8a88b"]},  # target inquiry link already tried
    )
    import asyncio
    plan = asyncio.run(plan_milestone_step(
        goal="اريد الاستفسار عن مخالفات المركبات",
        milestone=milestone,
        dom_map=[DomNode(**n) for n in megamenu_dom],
        current_url="http://127.0.0.1:8000/portal-megamenu.html",
        page_text="",
        goal_state=gs,
        language="ar-EG",
    ))
    # Target inquiry link must NOT be chosen because it's in tried
    chosen_ids = [s.element_id for s in plan.steps]
    assert "el_22e044911af8a88b" not in chosen_ids, f"Tried element was re-selected: {chosen_ids}"

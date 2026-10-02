"""
Atlas v2 Replay Harness Runner
backend/tests/replay/runner.py
Drives multi-hop scenarios through the real /v1/chat/goal_step endpoint (§13.2).
"""

from typing import Any, Dict, List, Optional, Union
from unittest.mock import AsyncMock, patch
import httpx
from pydantic import BaseModel, Field

from app.agent import llm_client
from app.main import app
from app.db.connection import get_db


class HopExpectation(BaseModel):
    """Assertions to verify against the endpoint response after a hop."""
    status: Optional[str] = None
    page_kind: Optional[str] = None
    action_on_label: Optional[str] = None
    form_fields_planned: Optional[int] = None
    submit_not_in_batch: Optional[bool] = None
    awaiting_kind: Optional[str] = None


class Hop(BaseModel):
    """Single page interaction / snapshot within a replay scenario."""
    url: str
    dom_map: List[Dict[str, Any]] = Field(default_factory=list)
    page_text: Optional[str] = None
    last_action_result: Optional[Dict[str, Any]] = None
    canned_llm_responses: List[str] = Field(default_factory=list)
    expect: Optional[HopExpectation] = None


class Scenario(BaseModel):
    """Named multi-hop replay scenario."""
    name: str
    goal: str
    hops: List[Hop]


class ReplayResult(BaseModel):
    """Outcome of running a replay scenario."""
    final: Dict[str, Any]
    trace: List[Dict[str, Any]]


def assert_hop_expectations(hop: Hop, body: Dict[str, Any]) -> None:
    """Verifies all declared expectations on a hop response."""
    if not hop.expect:
        return

    exp = hop.expect

    if exp.status is not None:
        actual_status = body.get("status")
        assert actual_status == exp.status, (
            f"Hop at {hop.url} expected status '{exp.status}', got '{actual_status}'"
        )

    goal_state = body.get("goal_state") or {}

    if exp.page_kind is not None:
        actual_kind = goal_state.get("page_kind")
        assert actual_kind == exp.page_kind, (
            f"Hop at {hop.url} expected page_kind '{exp.page_kind}', got '{actual_kind}'"
        )

    if exp.action_on_label is not None:
        steps = body.get("steps") or []
        labels = [
            s.get("description", "") for s in steps
        ]
        assert any(exp.action_on_label.lower() in lbl.lower() for lbl in labels), (
            f"Hop expected action on '{exp.action_on_label}', planned steps: {labels}"
        )

    form_plan = goal_state.get("form_plan") or {}
    fields = form_plan.get("fields") or []

    if exp.form_fields_planned is not None:
        assert len(fields) == exp.form_fields_planned, (
            f"Expected {exp.form_fields_planned} form fields planned, got {len(fields)}"
        )

    if exp.submit_not_in_batch is True:
        submit_ref = form_plan.get("submit_ref")
        field_refs = [f.get("ref") for f in fields]
        assert submit_ref not in field_refs, (
            f"Safety violation: submit_ref '{submit_ref}' found inside fields batch {field_refs}"
        )

    if exp.awaiting_kind is not None:
        awaiting = goal_state.get("awaiting") or {}
        actual_awaiting_kind = awaiting.get("kind")
        assert actual_awaiting_kind == exp.awaiting_kind, (
            f"Expected awaiting kind '{exp.awaiting_kind}', got '{actual_awaiting_kind}'"
        )


async def replay(scenario: Scenario, test_key: str = "atlas_test_demo_key_123456789") -> ReplayResult:
    """
    Executes a Scenario hop-by-hop against /v1/chat/goal_step using ASGI AsyncClient.
    """
    state: Optional[Dict[str, Any]] = None
    trace: List[Dict[str, Any]] = []

    async def override_get_db():
        mock_db = AsyncMock()
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            with patch("app.db.connection.validate_api_key", new=AsyncMock(return_value="demo-tenant-id")):
                for hop in scenario.hops:
                    if hop.canned_llm_responses:
                        llm_client.set_mock_llm_queue(hop.canned_llm_responses)

                    payload = {
                        "goal": scenario.goal,
                        "current_url": hop.url,
                        "dom_map": hop.dom_map,
                        "page_text": hop.page_text,
                        "goal_state": state,
                        "last_action_result": hop.last_action_result,
                        "api_key": test_key,
                    }

                    resp = await client.post("/v1/chat/goal_step", json=payload)
                    assert resp.status_code == 200, f"goal_step failed with {resp.status_code}: {resp.text}"

                    body = resp.json()
                    state = body.get("goal_state", {})
                    trace.append(body)

                    assert_hop_expectations(hop, body)

                    if body.get("status") in ("goal_complete", "goal_failed"):
                        break
    finally:
        app.dependency_overrides.clear()

    return ReplayResult(final=state or {}, trace=trace)

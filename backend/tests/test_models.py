"""
test_models.py — Pydantic model validation.

Covers: DomNode, AgentMessage (incl. new `type` field from Contract v1.1),
        ActionResponse (incl. .error() factory).
"""
import pytest
from pydantic import ValidationError

from app.models.dom import DomNode
from app.models.request import AgentMessage
from app.models.action import ActionResponse


# ── DomNode ───────────────────────────────────────────────────────────────────

class TestDomNode:
    def test_valid_button_node(self):
        node = DomNode(
            id="atlas-001", tag="button", type=None,
            inner_text="Checkout", placeholder=None,
            aria_label="Checkout", href=None, name=None, role=None,
        )
        assert node.id == "atlas-001"
        assert node.tag == "button"

    def test_valid_input_node(self):
        node = DomNode(
            id="atlas-002", tag="input", type="email",
            inner_text=None, placeholder="Enter your email",
            aria_label="Email", href=None, name="email", role=None,
        )
        assert node.type == "email"
        assert node.name == "email"

    def test_all_optional_fields_none(self):
        """Only tag is strictly required — all others can be None."""
        node = DomNode(
            id=None, tag="a", type=None,
            inner_text=None, placeholder=None,
            aria_label=None, href="https://example.com",
            name=None, role=None,
        )
        assert node.tag == "a"
        assert node.id is None

    def test_synthetic_id_not_native(self):
        """id field must accept atlas-NNN format (Contract 3 v1.1)."""
        node = DomNode(
            id="atlas-042", tag="button", type=None,
            inner_text="Submit", placeholder=None,
            aria_label=None, href=None, name=None, role=None,
        )
        assert node.id == "atlas-042"

    def test_missing_tag_raises(self):
        with pytest.raises(ValidationError):
            DomNode(
                id="atlas-001", type=None,
                inner_text=None, placeholder=None,
                aria_label=None, href=None, name=None, role=None,
            )


# ── AgentMessage ──────────────────────────────────────────────────────────────

class TestAgentMessage:
    def test_valid_command_message(self, sample_dom_map):
        msg = AgentMessage(
            session_id="sess-001",
            api_key="atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
            url="https://demo.atlas.com",
            dom_map=sample_dom_map,
            command="click checkout button",
            type="command",
        )
        assert msg.type == "command"
        assert len(msg.dom_map) == 2

    def test_valid_simplify_message(self, sample_dom_map):
        msg = AgentMessage(
            session_id="sess-002",
            api_key="atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
            url="https://demo.atlas.com",
            dom_map=sample_dom_map,
            command="",
            type="simplify",
        )
        assert msg.type == "simplify"

    def test_type_field_exists(self, sample_dom_map):
        """Contract v1.1 added `type` — must be present on the model."""
        msg = AgentMessage(
            session_id="s", api_key="k", url="u",
            dom_map=sample_dom_map, command="go", type="command",
        )
        assert hasattr(msg, "type"), (
            "AgentMessage is missing the `type` field — update request.py "
            "per Contract 1 v1.1"
        )

    def test_invalid_type_raises(self, sample_dom_map):
        """type must be 'command' or 'simplify', nothing else."""
        with pytest.raises(ValidationError):
            AgentMessage(
                session_id="s", api_key="k", url="u",
                dom_map=sample_dom_map, command="go",
                type="unknown_type",
            )

    def test_empty_dom_map_accepted(self):
        """Empty dom_map is technically valid — parser/LLM handles it."""
        msg = AgentMessage(
            session_id="s", api_key="k", url="u",
            dom_map=[], command="do something", type="command",
        )
        assert msg.dom_map == []

    def test_missing_session_id_raises(self, sample_dom_map):
        with pytest.raises(ValidationError):
            AgentMessage(
                api_key="k", url="u",
                dom_map=sample_dom_map, command="go", type="command",
            )


# ── ActionResponse ────────────────────────────────────────────────────────────

class TestActionResponse:
    def test_valid_success_response(self):
        r = ActionResponse(
            status="success", action="click",
            element_id="atlas-001", value=None,
            message="Clicked Checkout button",
        )
        assert r.status == "success"
        assert r.action == "click"

    def test_valid_fill_response(self):
        r = ActionResponse(
            status="success", action="fill",
            element_id="atlas-002", value="john@example.com",
            message="Filled email field",
        )
        assert r.value == "john@example.com"

    def test_all_action_types_valid(self):
        for action in ("click", "fill", "scroll", "focus"):
            r = ActionResponse(
                status="success", action=action,
                element_id="atlas-001", value=None,
                message=f"Did {action}",
            )
            assert r.action == action

    def test_error_factory(self):
        r = ActionResponse.error("Element not found")
        assert r.status == "error"
        assert r.action is None
        assert r.element_id is None
        assert r.value is None
        assert "Element not found" in r.message

    def test_invalid_action_type_raises(self):
        with pytest.raises(ValidationError):
            ActionResponse(
                status="success", action="hover",   # not in the allowed set
                element_id="atlas-001", value=None, message="",
            )

    def test_invalid_status_raises(self):
        with pytest.raises(ValidationError):
            ActionResponse(
                status="pending",   # must be success | error
                action="click", element_id="atlas-001",
                value=None, message="",
            )

    def test_serializes_to_json(self):
        r = ActionResponse(
            status="success", action="click",
            element_id="atlas-001", value=None,
            message="Done",
        )
        j = r.model_dump_json()
        assert '"status":"success"' in j
        assert '"element_id":"atlas-001"' in j

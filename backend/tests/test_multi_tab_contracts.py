"""
Unit & Contract Test Suite: Multi-Tab Pydantic Contracts, Schemas & URL Redaction
File: backend/tests/test_multi_tab_contracts.py

Milestone 2 / Track R2 Verification:
- Pydantic v2 TabInfo & TabContext models
- ActionType "switch_tab" and PlanStep tab_id
- GoalStepRequest & GoalStepResponse contract_version=2 and capabilities
- JSON Schema contracts on disk (contracts/goal_step.*.schema.json)
- URL & secret token redaction in backend/app/agent/sanitize.py
- Verifier Rules 4, 5, 6 strict zero diff invariant
- Universal Web Directive (zero domain hardcoding)
"""

import json
from pathlib import Path
import pytest
from pydantic import ValidationError

from app.models.action import ActionType, ActionResponse
from app.models.goal import (
    TabInfo,
    TabContext,
    PlanStep,
    Budget,
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
)
from app.agent.sanitize import (
    redact_url,
    sanitize_tokens,
    sanitize_url_tokens,
    cap_title,
)


class TestMultiTabModels:
    """Test suite for new multi-tab Pydantic v2 models and extensions."""

    def test_tab_info_serialization_roundtrip(self):
        tab = TabInfo(
            tab_id=42,
            url="https://example.com/checkout",
            title="Checkout Page",
            is_active=True,
            is_opener=False,
            is_child=True,
            status="complete",
            window_id=1,
            created_at=1700000000.0,
        )
        data = tab.model_dump()
        assert data["tab_id"] == 42
        assert data["url"] == "https://example.com/checkout"
        assert data["title"] == "Checkout Page"
        assert data["is_active"] is True
        assert data["is_child"] is True
        assert data["window_id"] == 1

        restored = TabInfo.model_validate(data)
        assert restored == tab

    def test_tab_info_defaults(self):
        tab = TabInfo(tab_id=1, url="https://example.com")
        assert tab.is_active is False
        assert tab.is_opener is False
        assert tab.is_child is False
        assert tab.title is None
        assert tab.status is None
        assert tab.window_id is None
        assert tab.created_at is None

    def test_tab_info_title_max_length(self):
        with pytest.raises(ValidationError):
            TabInfo(tab_id=1, url="https://example.com", title="A" * 81)

    def test_tab_context_serialization_roundtrip(self):
        ctx = TabContext(
            self_tab_id=10,
            opener_tab_id=5,
            tabs=[
                TabInfo(tab_id=5, url="https://example.com/login", is_opener=True),
                TabInfo(tab_id=10, url="https://auth.example.com/oauth", is_child=True, is_active=True),
            ],
            resume_reason="child_ready",
            close_hint=False,
            origin_confirmed=True,
        )
        dumped = ctx.model_dump()
        assert dumped["self_tab_id"] == 10
        assert dumped["opener_tab_id"] == 5
        assert len(dumped["tabs"]) == 2
        assert dumped["resume_reason"] == "child_ready"
        assert dumped["origin_confirmed"] is True

        reloaded = TabContext.model_validate(dumped)
        assert reloaded == ctx

    def test_tab_context_defaults(self):
        ctx = TabContext(self_tab_id=1)
        assert ctx.opener_tab_id is None
        assert ctx.tabs == []
        assert ctx.resume_reason is None
        assert ctx.close_hint is False
        assert ctx.origin_confirmed is False

    def test_plan_step_tab_id_and_switch_tab(self):
        step = PlanStep(
            action="switch_tab",
            tab_id=102,
            description="Switch focus to child OAuth window",
        )
        dumped = step.model_dump()
        assert dumped["action"] == "switch_tab"
        assert dumped["tab_id"] == 102

        parsed = PlanStep.model_validate(dumped)
        assert parsed.action == "switch_tab"
        assert parsed.tab_id == 102

    def test_action_type_supports_switch_tab(self):
        resp = ActionResponse(
            status="success",
            action="switch_tab",
            element_id=None,
            value=None,
            message="Switched tab successfully",
        )
        assert resp.action == "switch_tab"

    def test_budget_handoff_fields(self):
        budget = Budget()
        assert budget.max_handoffs == 4
        assert budget.handoff_count == 0

        budget.handoff_count += 1
        assert budget.handoff_count == 1


class TestGoalStepContractsV2:
    """Test suite for GoalStepRequest & GoalStepResponse v2 contracts."""

    def test_goal_step_request_v2_defaults(self):
        req = GoalStepRequest(
            goal="Book a table",
            current_url="https://example.com/restaurants",
        )
        assert req.contract_version == 2
        assert req.capabilities == ["switch_tab", "tab_context", "assisted_click"]
        assert req.tab_context is None

    def test_goal_step_request_with_tab_context(self):
        tab_ctx = TabContext(
            self_tab_id=99,
            tabs=[TabInfo(tab_id=99, url="https://example.com")],
        )
        req = GoalStepRequest(
            goal="Test multi-tab",
            current_url="https://example.com",
            contract_version=2,
            capabilities=["switch_tab", "tab_context"],
            tab_context=tab_ctx,
        )
        data = req.model_dump()
        assert data["contract_version"] == 2
        assert data["tab_context"]["self_tab_id"] == 99

        restored = GoalStepRequest.model_validate(data)
        assert restored.tab_context.self_tab_id == 99

    def test_goal_step_response_v2_fields(self):
        state = GoalState(goal="Test goal")
        resp = GoalStepResponse(
            status="in_progress",
            goal_state=state,
            reply="Switching tab to complete auth",
            steps=[PlanStep(action="switch_tab", tab_id=77)],
            contract_version=2,
            close_tab=False,
            switch_tab_id=77,
            requires_origin_confirmation=False,
            assisted_click=None,
        )
        dumped = resp.model_dump()
        assert dumped["contract_version"] == 2
        assert dumped["switch_tab_id"] == 77
        assert dumped["close_tab"] is False
        assert len(dumped["steps"]) == 1
        assert dumped["steps"][0]["action"] == "switch_tab"

    def test_backward_compatibility_v1_payload(self):
        # Legacy v1 payload without v2 fields
        legacy_data = {
            "goal": "Legacy goal",
            "current_url": "https://example.com",
            "dom_map": [],
        }
        parsed = GoalStepRequest.model_validate(legacy_data)
        assert parsed.goal == "Legacy goal"
        assert parsed.contract_version == 2  # default updated
        assert parsed.tab_context is None


class TestSchemaConformity:
    """Test suite ensuring JSON schemas in contracts/ match Pydantic models."""

    @pytest.fixture(autouse=True)
    def setup_paths(self):
        self.repo_root = Path(__file__).resolve().parents[2]
        self.contracts_dir = self.repo_root / "contracts"

    def test_schema_files_exist_on_disk(self):
        req_schema_path = self.contracts_dir / "goal_step.request.schema.json"
        resp_schema_path = self.contracts_dir / "goal_step.response.schema.json"

        assert req_schema_path.exists(), f"Missing schema file: {req_schema_path}"
        assert resp_schema_path.exists(), f"Missing schema file: {resp_schema_path}"

    def test_request_schema_matches_pydantic_model(self):
        req_schema_path = self.contracts_dir / "goal_step.request.schema.json"
        disk_schema = json.loads(req_schema_path.read_text(encoding="utf-8"))
        model_schema = GoalStepRequest.model_json_schema()

        assert disk_schema == model_schema

    def test_response_schema_matches_pydantic_model(self):
        resp_schema_path = self.contracts_dir / "goal_step.response.schema.json"
        disk_schema = json.loads(resp_schema_path.read_text(encoding="utf-8"))
        model_schema = GoalStepResponse.model_json_schema()

        assert disk_schema == model_schema

    def test_schema_properties_conformity(self):
        req_schema_path = self.contracts_dir / "goal_step.request.schema.json"
        schema = json.loads(req_schema_path.read_text(encoding="utf-8"))

        props = schema["properties"]
        assert "contract_version" in props
        assert "capabilities" in props
        assert "tab_context" in props
        assert "TabInfo" in schema["$defs"]
        assert "TabContext" in schema["$defs"]


class TestUrlAndSecretRedaction:
    """Test suite for URL query/hash stripping and token redaction."""

    def test_redact_url_oauth_query_and_hash(self):
        raw = "https://auth.example.com/oauth/authorize?code=spl_xyz123&state=abc#step"
        clean = redact_url(raw)
        assert clean == "https://auth.example.com/oauth/authorize"

    def test_redact_url_strips_basic_auth_credentials(self):
        raw = "https://admin:supersecret@auth.example.com:8443/oauth/authorize?code=xyz#step"
        clean = redact_url(raw)
        assert clean == "https://auth.example.com:8443/oauth/authorize"
        assert "admin" not in clean
        assert "supersecret" not in clean

    def test_redact_url_multiple_query_params(self):
        raw = "https://sub.domain.org/path/to/page?user=1&session=secret#target"
        clean = redact_url(raw)
        assert clean == "https://sub.domain.org/path/to/page"

    def test_redact_url_preserves_clean_url(self):
        raw = "https://example.com/clean/path"
        clean = redact_url(raw)
        assert clean == "https://example.com/clean/path"

    def test_redact_url_handles_ports_and_paths(self):
        raw = "http://localhost:8000/api/v1?token=123#frag"
        clean = redact_url(raw)
        assert clean == "http://localhost:8000/api/v1"

    def test_redact_url_empty_and_none(self):
        assert redact_url("") == ""
        assert redact_url(None) == ""

    def test_sanitize_tokens_replaces_code_parameter(self):
        text = "https://example.com/callback?code=abc123xyz&state=ok"
        sanitized = sanitize_tokens(text)
        assert sanitized == "https://example.com/callback?[REDACTED]&state=ok"
        assert "abc123xyz" not in sanitized

    def test_sanitize_tokens_replaces_access_token_in_fragment(self):
        text = "https://example.com/#access_token=bearer_tok_999&token_type=bearer"
        sanitized = sanitize_tokens(text)
        assert sanitized == "https://example.com/#[REDACTED]&token_type=bearer"
        assert "bearer_tok_999" not in sanitized

    def test_sanitize_tokens_replaces_token_in_freeform_text(self):
        text = "Auth header: token=ghp_secret_key_888 for session"
        sanitized = sanitize_tokens(text)
        assert sanitized == "Auth header: [REDACTED] for session"
        assert "ghp_secret_key_888" not in sanitized

    def test_sanitize_tokens_preserves_non_sensitive_text(self):
        text = "Regular string with no credentials: key=public_item"
        sanitized = sanitize_tokens(text)
        assert sanitized == text

    def test_sanitize_url_tokens_alias(self):
        assert sanitize_url_tokens == sanitize_tokens

    def test_cap_title_truncates_to_80_chars(self):
        long_title = "T" * 120
        assert len(cap_title(long_title)) == 80
        assert cap_title(long_title) == "T" * 80

    def test_cap_title_trims_whitespace(self):
        assert cap_title("  Trimmed Title  ") == "Trimmed Title"

    def test_cap_title_handles_none_and_empty(self):
        assert cap_title(None) == ""
        assert cap_title("") == ""

    def test_cap_title_custom_max(self):
        assert cap_title("Short string", max_chars=5) == "Short"


class TestSacredRailsAndUniversalDirectives:
    """Test suite ensuring inviolable rails and Prime Directive compliance."""

    def test_verifier_rules_4_5_6_unmodified(self):
        repo_root = Path(__file__).resolve().parents[2]
        verifier_path = repo_root / "backend" / "app" / "agent" / "verifier.py"

        content = verifier_path.read_text(encoding="utf-8")
        assert "Rule 4: URL Transitions" in content
        assert "Rule 5: Element Disappearance" in content
        assert "Rule 6: Fallback to LLM Evaluation" in content

        # Verify key sacred lines exist verbatim
        assert 'signals = [f"url_transition:{prior_url}->{current_url}"]' in content
        assert 'if milestone.target_url and _url_matches(current_url, milestone.target_url):' in content
        assert 'status = "milestone_complete" if getattr(milestone, "satisfied_by_navigation", False) else "in_progress"' in content
        assert 'target_eid = str(last_action.element_id)' in content
        assert 'if any(disp_kw in goal_lower for disp_kw in ("close", "dismiss", "delete", "remove", "hide")):' in content

    def test_zero_domain_hardcoding_in_models_and_sanitizer(self):
        repo_root = Path(__file__).resolve().parents[2]
        files_to_check = [
            repo_root / "backend" / "app" / "models" / "goal.py",
            repo_root / "backend" / "app" / "models" / "action.py",
            repo_root / "backend" / "app" / "agent" / "sanitize.py",
        ]
        forbidden_domains = [
            "amazon.com",
            "google.com",
            "drive.google.com",
            "github.com",
            "wikipedia.org",
        ]
        for f in files_to_check:
            text = f.read_text(encoding="utf-8").lower()
            for d in forbidden_domains:
                assert d not in text, f"Forbidden domain {d} found in {f}"

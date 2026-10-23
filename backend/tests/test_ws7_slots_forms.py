"""
Tests for WS7: Slots and Forms
backend/tests/test_ws7_slots_forms.py

Tests form discovery, missing required fields extraction, tokenized goal extraction,
single awaiting_user_input prompt via i18n, client-side token validation,
consequential submit confirmation gate, and zero-logging invariants.
"""

import logging
import pytest
from unittest.mock import AsyncMock, patch

from app.agent.form_filler import (
    plan_form_fill,
    extract_required_form_fields,
    extract_tokens_from_goal,
    format_missing_fields_prompt,
    _is_sensitive_field,
    TOKEN_REGEX,
)
from app.models.dom import DomNode
from app.models.goal import (
    GoalState,
    GoalStepRequest,
    GoalStepResponse,
    Milestone,
    PlanStep,
    UserInputRequest,
)
from app.routes.chat import goal_step_endpoint


def make_serializer_node(
    node_id: str,
    tag: str = "input",
    node_type: str = "text",
    name: str = "",
    resolved_label: str = "",
    inner_text: str = "",
    pattern: str = None,
    maxlength: int = None,
    required: bool = False,
    sensitive: bool = False,
    value: str = None,
) -> DomNode:
    """Helper to create DOM nodes shaped exactly like the client serializer output."""
    return DomNode(
        id=node_id,
        tag=tag,
        type=node_type,
        name=name,
        resolved_label=resolved_label,
        inner_text=inner_text,
        pattern=pattern,
        maxlength=maxlength,
        required=required,
        sensitive=sensitive,
        current_value=value,
        visible=True,
    )


class TestFormFillerDiscovery:
    """Tests for universal required fields and sensitivity detection."""

    def test_plan_form_fill_extracts_required_fields_and_sensitive_flags(self):
        nodes = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID Number",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
            make_serializer_node(
                node_id="el_code",
                name="code",
                resolved_label="Verification Code",
                pattern=r"[0-9]{1,4}",
                maxlength=4,
                required=True,
            ),
            make_serializer_node(
                node_id="el_optional",
                name="notes",
                resolved_label="Additional Notes",
                required=False,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="Submit Form",
            ),
        ]

        required = extract_required_form_fields(nodes)
        assert len(required) == 2

        nid_field = next(f for f in required if f.ref == "el_nid")
        assert nid_field.sensitive is True
        assert nid_field.pattern == r"[0-9]{14}"
        assert nid_field.maxlength == 14
        assert nid_field.label == "National ID Number"

        code_field = next(f for f in required if f.ref == "el_code")
        assert code_field.sensitive is False
        assert code_field.pattern == r"[0-9]{1,4}"
        assert code_field.maxlength == 4

    def test_arabic_identity_keywords_sensitive_detection(self):
        ar_node = make_serializer_node(
            node_id="el_ar_id",
            name="nid",
            resolved_label="الرقم القومي (14 رقماً)",
            pattern=r"[0-9]{14}",
            maxlength=14,
            required=True,
        )
        assert _is_sensitive_field(ar_node.model_dump()) is True

        passport_node = make_serializer_node(
            node_id="el_pass",
            name="doc",
            resolved_label="جواز السفر",
            required=True,
        )
        assert _is_sensitive_field(passport_node.model_dump()) is True


class TestGoalTokenExtractionAndSafety:
    """Adjustment 1: Backend never extracts raw digits; only tokens already in goal."""

    def test_raw_digits_in_goal_are_never_extracted(self):
        nodes = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
        ]
        required = extract_required_form_fields(nodes)
        # Goal containing raw 14-digit run
        raw_goal = "I want to submit request for 00000000000000"
        extracted = extract_tokens_from_goal(raw_goal, required)

        # Invariant: Raw digits MUST NOT be extracted
        assert extracted == {}

    def test_token_in_goal_is_extracted(self):
        nodes = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
        ]
        required = extract_required_form_fields(nodes)
        # Goal containing valid token
        token_goal = "I want to submit request for {secret}"
        extracted = extract_tokens_from_goal(token_goal, required)

        assert extracted == {"el_nid": "{secret}"}


class TestAwaitingUserInputPromptFormatting:
    """Tests for single multi-field prompt in English and Egyptian Arabic."""

    def test_format_missing_fields_prompt_english(self):
        nodes = [
            make_serializer_node(node_id="el_id", resolved_label="National ID", required=True),
            make_serializer_node(node_id="el_code", resolved_label="Access Code", required=True),
        ]
        fields = extract_required_form_fields(nodes)
        prompt = format_missing_fields_prompt(fields, language="en-US")
        assert prompt == "Please provide National ID and Access Code to proceed."

    def test_format_missing_fields_prompt_arabic(self):
        nodes = [
            make_serializer_node(node_id="el_id", resolved_label="الرقم القومي", required=True),
            make_serializer_node(node_id="el_code", resolved_label="رقم اللوحة", required=True),
        ]
        fields = extract_required_form_fields(nodes)
        prompt = format_missing_fields_prompt(fields, language="ar-EG")
        assert prompt == "محتاج الرقم القومي ورقم اللوحة للمتابعة."


@pytest.mark.asyncio
class TestGoalStepSlotsAndFormsIntegration:
    """End-to-end integration tests for goal_step form handling."""

    @pytest.fixture
    def mock_db(self):
        session = AsyncMock()
        return session

    async def test_form_landing_returns_awaiting_user_input_with_contract_v3_fields(self, mock_db):
        dom_map = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="الرقم القومي",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
            make_serializer_node(
                node_id="el_code",
                name="code",
                resolved_label="رمز الدخول",
                pattern=r"[0-9]{1,4}",
                maxlength=4,
                required=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="إرسال",
            ),
        ]

        state = GoalState(
            goal="اريد الاستعلام عن السجل",
            status="in_progress",
            page_kind="form",
            language="ar-EG",
            milestones=[Milestone(id="m1", description="fill details", status="active")],
            active_milestone_id="m1",
        )

        req = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp = await goal_step_endpoint(payload=req, db=mock_db)

            assert resp.status == "awaiting_user_input"
            assert resp.goal_state.status == "awaiting_user_input"
            assert resp.goal_state.awaiting is not None
            assert len(resp.goal_state.awaiting.fields) == 2
            assert resp.reply == "محتاج الرقم القومي ورمز الدخول للمتابعة."

    async def test_raw_sensitive_value_sent_to_backend_is_rejected_and_reasked(self, mock_db):
        """Rule 5: Sensitive values must be tokens; raw values re-asked."""
        dom_map = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="الرقم القومي",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
        ]

        state = GoalState(
            goal="استعلام",
            status="awaiting_user_input",
            page_kind="form",
            language="ar-EG",
            milestones=[Milestone(id="m1", description="fill details", status="active")],
            active_milestone_id="m1",
        )

        # Client mistakenly sends raw 14 digits instead of vault token
        req = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            user_inputs={"el_nid": "00000000000000"},
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp = await goal_step_endpoint(payload=req, db=mock_db)

            # Re-asks because raw sensitive value is not a token
            assert resp.status == "awaiting_user_input"
            assert "الرقم القومي" in resp.reply

    async def test_non_sensitive_pattern_mismatch_is_reasked(self, mock_db):
        """Rule 5: Non-sensitive value violating pattern or maxlength is re-asked."""
        dom_map = [
            make_serializer_node(
                node_id="el_code",
                name="code",
                resolved_label="Code",
                pattern=r"^[0-9]{1,4}$",
                maxlength=4,
                required=True,
            ),
        ]

        state = GoalState(
            goal="Inquire",
            status="awaiting_user_input",
            page_kind="form",
            language="en-US",
            milestones=[Milestone(id="m1", description="fill details", status="active")],
            active_milestone_id="m1",
        )

        # Value violates maxlength (5 digits > 4)
        req = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            user_inputs={"el_code": "12345"},
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp = await goal_step_endpoint(payload=req, db=mock_db)

            assert resp.status == "awaiting_user_input"
            assert "Code" in resp.reply

    async def test_resuming_with_tokens_generates_tokenized_fill_steps(self, mock_db):
        """Rule 4: Fill steps use tokens verbatim; submit requires confirmation next."""
        dom_map = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                pattern=r"[0-9]{14}",
                maxlength=14,
                required=True,
            ),
            make_serializer_node(
                node_id="el_code",
                name="code",
                resolved_label="Access Code",
                pattern=r"[0-9]{1,4}",
                maxlength=4,
                required=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="Submit Form",
            ),
        ]

        state = GoalState(
            goal="Inquire",
            status="awaiting_user_input",
            page_kind="form",
            language="en-US",
            milestones=[Milestone(id="m1", description="fill details", status="active")],
            active_milestone_id="m1",
        )

        req = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            user_inputs={"el_nid": "{secret}", "el_code": "1234"},
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp = await goal_step_endpoint(payload=req, db=mock_db)

            assert resp.status == "in_progress"
            assert len(resp.steps) >= 2
            fill_nid = next(s for s in resp.steps if s.element_id == "el_nid")
            assert fill_nid.value == "{secret}"

            fill_code = next(s for s in resp.steps if s.element_id == "el_code")
            assert fill_code.value == "1234"

    async def test_filled_form_submit_requires_confirmation_and_arabic_confirmation(self, mock_db):
        """Rule 7: Final submit click is gated by confirmation; supports Arabic 'أيوة'."""
        dom_map = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="الرقم القومي",
                value="{vault:el_nid}",
                required=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="إرسال الطلب",
            ),
        ]

        state = GoalState(
            goal="اريد ارسال الطلب",
            status="in_progress",
            page_kind="form",
            language="ar-EG",
            milestones=[Milestone(id="m1", description="submit form", status="active")],
            active_milestone_id="m1",
        )

        # 1. Turn when form is filled: Atlas pauses for confirmation before submit
        req1 = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp1 = await goal_step_endpoint(payload=req1, db=mock_db)
            assert resp1.status == "requires_confirmation"
            assert resp1.requires_confirmation is True
            assert resp1.pending_step is not None
            assert resp1.pending_step.element_id == "el_submit"

            # 2. User confirms with Egyptian Arabic "أيوة"
            req2 = GoalStepRequest(
                goal=state.goal,
                current_url="https://portal.example.org/form.html",
                dom_map=dom_map,
                goal_state=resp1.goal_state,
                user_response="أيوة",
                api_key="valid_test_key",
                contract_version=3,
            )
            resp2 = await goal_step_endpoint(payload=req2, db=mock_db)

            assert resp2.status == "in_progress"
            assert len(resp2.steps) == 1
            assert resp2.steps[0].action == "click"
            assert resp2.steps[0].element_id == "el_submit"

    async def test_sensitive_field_current_value_token_versus_null_missing_check(self, mock_db):
        """Item 3: current_value matching TOKEN_REGEX counts as filled; null or non-token counts as missing."""
        # Case A: Sensitive field has null current_value -> counts as missing, returns awaiting_user_input
        dom_map_missing = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                value=None,
                required=True,
                sensitive=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="Submit",
            ),
        ]
        state = GoalState(
            goal="submit request",
            status="in_progress",
            page_kind="form",
            language="en-US",
            milestones=[Milestone(id="m1", description="submit form", status="active")],
            active_milestone_id="m1",
        )
        req_missing = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map_missing,
            goal_state=state,
            api_key="valid_test_key",
            contract_version=3,
        )
        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp_missing = await goal_step_endpoint(payload=req_missing, db=mock_db)
            assert resp_missing.status == "awaiting_user_input"
            assert resp_missing.goal_state.awaiting is not None
            assert len(resp_missing.goal_state.awaiting.fields) == 1
            assert resp_missing.goal_state.awaiting.fields[0].ref == "el_nid"

        # Case B: Sensitive field has valid TOKEN_REGEX current_value -> counts as filled, proceeds to confirmation
        dom_map_filled = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                value="{vault:el_nid}",
                required=True,
                sensitive=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="Submit",
            ),
        ]
        req_filled = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map_filled,
            goal_state=state,
            api_key="valid_test_key",
            contract_version=3,
        )
        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            resp_filled = await goal_step_endpoint(payload=req_filled, db=mock_db)
            assert resp_filled.status == "requires_confirmation"
            assert resp_filled.requires_confirmation is True
            assert resp_filled.pending_step is not None
            assert resp_filled.pending_step.element_id == "el_submit"


@pytest.mark.asyncio
class TestLoggingLeakPrevention:
    """Rule 8: Invariant that raw user inputs are never logged."""

    async def test_never_log_user_inputs_caplog(self, caplog):
        caplog.set_level(logging.DEBUG)
        mock_db = AsyncMock()

        dom_map = [
            make_serializer_node(
                node_id="el_nid",
                name="national_id",
                resolved_label="National ID",
                required=True,
            ),
            make_serializer_node(
                node_id="el_submit",
                tag="button",
                node_type="submit",
                resolved_label="Submit",
            ),
        ]

        state = GoalState(
            goal="Inquire with private details",
            status="awaiting_user_input",
            page_kind="form",
            language="en-US",
            milestones=[Milestone(id="m1", description="fill details", status="active")],
            active_milestone_id="m1",
        )

        sensitive_canary = "SUPER_SECRET_CANARY_VALUE_9999"
        req = GoalStepRequest(
            goal=state.goal,
            current_url="https://portal.example.org/form.html",
            dom_map=dom_map,
            goal_state=state,
            user_inputs={"el_nid": "{secret}"},
            user_response=sensitive_canary,
            api_key="valid_test_key",
            contract_version=3,
        )

        with patch("app.db.connection.validate_api_key", new_callable=AsyncMock) as mock_auth, \
             patch("app.routes.chat.rate_limiter.check", return_value=True):
            mock_auth.return_value = "tenant-1"
            await goal_step_endpoint(payload=req, db=mock_db)

            # Assert canary value NEVER appeared in logger records
            assert sensitive_canary not in caplog.text


def test_zero_site_names_or_domain_hardcoding():
    """Rule 4 / Prime Directive: Zero hardcoded hostnames or website names."""
    import pathlib
    form_filler_path = pathlib.Path(__file__).resolve().parents[1] / "app" / "agent" / "form_filler.py"
    content = form_filler_path.read_text(encoding="utf-8").lower()
    for site in ["amazon", "google", "wikipedia", "twitter", "facebook", "youtube", "github"]:
        assert site not in content, f"Forbidden domain '{site}' found in form_filler.py"

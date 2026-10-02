"""
Tests for Form Filler Agent
backend/tests/test_form_filler.py
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.agent.form_filler import plan_form_fill, FormPlan
from app.models.dom import DomNode, SelectOption


@pytest.mark.asyncio
async def test_form_filler_signup_form_safety():
    """
    Form Filler on signup form:
    - Sensitive fields are vault/profile tokens, never literals.
    - Terms checkbox is NOT auto-checked (placed in missing_required).
    - submit_ref is set and strictly excluded from fields[].
    """
    signup_nodes = [
        DomNode(id="el-name", ref="el_name_ref", tag="input", type="text", name="full_name", resolved_label="Full Name", required=True),
        DomNode(id="el-email", ref="el_email_ref", tag="input", type="email", name="email", resolved_label="Email Address", required=True, sensitive=True),
        DomNode(id="el-phone", ref="el_phone_ref", tag="input", type="tel", name="phone", resolved_label="Phone Number", required=True),
        DomNode(
            id="el-country",
            ref="el_country_ref",
            tag="select",
            name="country",
            resolved_label="Country",
            required=True,
            options=[SelectOption(value="US", label="United States"), SelectOption(value="CA", label="Canada")],
        ),
        DomNode(id="el-pass", ref="el_pass_ref", tag="input", type="password", name="password", resolved_label="Password", required=True, sensitive=True),
        DomNode(id="el-confirm", ref="el_confirm_ref", tag="input", type="password", name="confirm_password", resolved_label="Confirm Password", required=True, sensitive=True),
        DomNode(id="el-terms", ref="el_terms_ref", tag="input", type="checkbox", name="terms", resolved_label="I agree to terms", required=True),
        DomNode(id="el-submit", ref="el_submit_ref", tag="button", type="submit", resolved_label="Complete Registration", disabled=True),
    ]

    mock_llm_reply = """{
        "form_id": "signup-form",
        "fields": [
            {"ref": "el_name_ref", "action": "fill", "value": "{profile.full_name}", "source": "profile"},
            {"ref": "el_email_ref", "action": "fill", "value": "{profile.email}", "source": "profile"},
            {"ref": "el_phone_ref", "action": "fill", "value": "{profile.phone}", "source": "profile"},
            {"ref": "el_country_ref", "action": "select_option", "value": "US", "source": "profile"},
            {"ref": "el_pass_ref", "action": "fill", "value": "{password}", "source": "vault"},
            {"ref": "el_confirm_ref", "action": "fill", "value": "{password}", "source": "vault"}
        ],
        "submit_ref": "el_submit_ref",
        "missing_required": ["el_terms_ref"],
        "blockers": []
    }"""

    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_llm_reply
        form_plan = await plan_form_fill(
            form_id="signup-form",
            dom_nodes=signup_nodes,
            goal="Sign up for a new account",
            profile_hints=["full_name", "email", "phone", "country"],
        )

        assert isinstance(form_plan, FormPlan)
        # 1. submit_ref is set and never inside fields
        assert form_plan.submit_ref == "el_submit_ref"
        assert all(f.ref != "el_submit_ref" for f in form_plan.fields)

        # 2. Sensitive fields have tokens, not literals
        pass_field = next(f for f in form_plan.fields if f.ref == "el_pass_ref")
        assert pass_field.value.startswith("{") and pass_field.value.endswith("}")
        assert "hunter2" not in pass_field.value

        email_field = next(f for f in form_plan.fields if f.ref == "el_email_ref")
        assert email_field.value == "{profile.email}"

        # 3. Terms checkbox is never auto-checked; surfaced in missing_required
        assert all(f.ref != "el_terms_ref" for f in form_plan.fields)
        assert "el_terms_ref" in form_plan.missing_required


@pytest.mark.asyncio
async def test_form_filler_missing_required_personal_data():
    """If a required field (e.g. birth_date) cannot be sourced, add to missing_required rather than inventing data."""
    dob_nodes = [
        DomNode(id="el-dob", ref="el_dob_ref", tag="input", type="text", name="birth_date", resolved_label="Date of Birth", required=True),
        DomNode(id="el-sub", ref="el_sub_ref", tag="button", type="submit", resolved_label="Submit"),
    ]

    mock_llm_reply = """{
        "form_id": "intake-form",
        "fields": [],
        "submit_ref": "el_sub_ref",
        "missing_required": ["el_dob_ref"],
        "blockers": []
    }"""

    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_llm_reply
        form_plan = await plan_form_fill(
            form_id="intake-form",
            dom_nodes=dob_nodes,
            goal="Complete intake",
            profile_hints=[],
        )

        assert "el_dob_ref" in form_plan.missing_required
        assert not any(f.ref == "el_dob_ref" for f in form_plan.fields)

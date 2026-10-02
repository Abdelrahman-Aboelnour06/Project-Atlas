"""
Tests for Scout Agent
backend/tests/test_scout.py
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.agent.scout import classify_page, ScoutResult
from app.models.dom import DomNode


@pytest.mark.asyncio
async def test_scout_classifies_form_page():
    """Scout correctly classifies a page with interactive form inputs as 'form'."""
    signup_dom = [
        DomNode(id="el-1", tag="input", type="text", name="full_name", resolved_label="Full Name", form_id="signup-form"),
        DomNode(id="el-2", tag="input", type="email", name="email", resolved_label="Email Address", form_id="signup-form"),
        DomNode(id="el-3", tag="input", type="password", name="password", resolved_label="Password", form_id="signup-form"),
        DomNode(id="el-4", tag="select", name="country", resolved_label="Country", form_id="signup-form"),
        DomNode(id="el-5", tag="input", type="checkbox", name="terms", resolved_label="Terms of Service", form_id="signup-form"),
        DomNode(id="el-6", tag="button", type="submit", resolved_label="Complete Registration", form_id="signup-form"),
    ]
    mock_llm_reply = """{
        "page_kind": "form",
        "blockers": [],
        "form_inventory": ["signup-form"],
        "primary_cta": "el-6",
        "summary": "Registration form with name, email, password, and country fields"
    }"""
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_llm_reply
        result = await classify_page(
            current_url="http://localhost:8080/signup.html",
            dom_map=signup_dom,
            page_text="Create Patient Account. Complete your details.",
        )
        assert isinstance(result, ScoutResult)
        assert result.page_kind == "form"
        assert "signup-form" in result.form_inventory
        assert len(result.blockers) == 0


@pytest.mark.asyncio
async def test_scout_detects_captcha_blocker():
    """Scout detects CAPTCHA / bot challenge elements and fires blocker detection."""
    captcha_dom = [
        DomNode(
            id="el-recaptcha",
            tag="div",
            role="checkbox",
            aria_label="I'm not a robot reCAPTCHA",
            inner_text="reCAPTCHA challenge",
        ),
        DomNode(id="el-submit", tag="button", resolved_label="Verify"),
    ]
    # Test heuristic / LLM blocker detection
    mock_llm_reply = """{
        "page_kind": "captcha",
        "blockers": ["captcha"],
        "form_inventory": [],
        "primary_cta": null,
        "summary": "Page is blocked by a reCAPTCHA challenge"
    }"""
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_llm_reply
        result = await classify_page(
            current_url="https://example.com/challenge",
            dom_map=captcha_dom,
            page_text="Please confirm you are human to proceed.",
        )
        assert isinstance(result, ScoutResult)
        assert "captcha" in result.blockers or result.page_kind == "captcha"


@pytest.mark.asyncio
async def test_scout_malformed_json_fallback_form():
    """Scout falls back gracefully on LLM failure using local DOM heuristics."""
    form_dom = [
        DomNode(id="f1", tag="input", type="text", name="username", form_id="login-form"),
        DomNode(id="f2", tag="input", type="password", name="password", form_id="login-form"),
        DomNode(id="f3", tag="button", type="submit", inner_text="Log In", form_id="login-form"),
    ]
    with patch("app.agent.llm_client.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = "Non-json error response"
        result = await classify_page(
            current_url="http://localhost:8080/login.html",
            dom_map=form_dom,
            page_text="Please log in to your account.",
        )
        assert isinstance(result, ScoutResult)
        assert result.page_kind == "form"
        assert "login-form" in result.form_inventory

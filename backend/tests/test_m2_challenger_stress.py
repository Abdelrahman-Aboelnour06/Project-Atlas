"""
Project Atlas — Milestone 2 Adversarial Empirical Stress Test Suite (Backend)
File: backend/tests/test_m2_challenger_stress.py

Adversarial Challenger M2.1 empirical test harness:
1. TabInfo & TabContext schema boundary and validation limits
2. GoalStepRequest & GoalStepResponse payload stress & injection tests
3. Roundtrip serialization of edge-case, empty, and massive tab collections
4. URL redaction bypass attacks (nested queries, fragments, unicode, userinfo)
5. Token sanitization attack patterns (OIDC, mixed casing, multiline)
6. Title capping Unicode codepoint vs UTF-16 code unit analysis
7. Sacred Rails Verifier Rules 4, 5, 6 zero-diff invariant
8. Prime Directive universal compliance (zero domain hardcoding)
"""

import subprocess
from pathlib import Path
import pytest
from pydantic import ValidationError

from app.models.action import ActionType
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


class TestTabInfoBoundaryViolations:
    """Stress tests attacking boundary conditions of TabInfo model."""

    def test_negative_tab_id_for_tab_id_none(self):
        """Chromium chrome.tabs.TAB_ID_NONE is -1. Model must accept negative integers."""
        tab = TabInfo(tab_id=-1, url="https://example.com")
        assert tab.tab_id == -1

    def test_zero_tab_id(self):
        tab = TabInfo(tab_id=0, url="https://example.com")
        assert tab.tab_id == 0

    def test_large_integer_tab_id(self):
        tab = TabInfo(tab_id=999999999999, url="https://example.com")
        assert tab.tab_id == 999999999999

    def test_missing_tab_id_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabInfo(url="https://example.com")

    def test_missing_url_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabInfo(tab_id=1)

    def test_none_url_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabInfo(tab_id=1, url=None)

    def test_title_exact_80_boundary(self):
        tab = TabInfo(tab_id=1, url="https://example.com", title="A" * 80)
        assert len(tab.title) == 80

    def test_title_81_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabInfo(tab_id=1, url="https://example.com", title="A" * 81)

    def test_title_with_multibyte_unicode(self):
        arabic_title = "منصة أطلس للملاحة الذكية"
        tab = TabInfo(tab_id=1, url="https://example.com", title=arabic_title)
        assert tab.title == arabic_title

    def test_created_at_int_coerces_to_float(self):
        tab = TabInfo(tab_id=1, url="https://example.com", created_at=1700000000)
        assert isinstance(tab.created_at, float)
        assert tab.created_at == 1700000000.0

    def test_created_at_microsecond_float_precision(self):
        ts = 1729000000.123456
        tab = TabInfo(tab_id=1, url="https://example.com", created_at=ts)
        assert tab.created_at == ts

    def test_invalid_created_at_string_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabInfo(tab_id=1, url="https://example.com", created_at="not_a_timestamp")


class TestTabContextBoundaryViolations:
    """Stress tests attacking boundary conditions of TabContext model."""

    def test_missing_self_tab_id_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabContext()

    def test_negative_self_tab_id(self):
        ctx = TabContext(self_tab_id=-1)
        assert ctx.self_tab_id == -1

    def test_tabs_none_raises_validation_error(self):
        with pytest.raises(ValidationError):
            TabContext(self_tab_id=1, tabs=None)

    def test_massive_tab_collection_serialization_roundtrip(self):
        """Stress test roundtrip serialization across 100 tabs."""
        tabs = [
            TabInfo(
                tab_id=i,
                url=f"https://sub{i}.example.com/page",
                title=f"Tab {i}",
                is_active=(i == 50),
                is_opener=(i == 0),
                is_child=(i > 0),
                window_id=(i // 10),
                created_at=1700000000.0 + i,
            )
            for i in range(100)
        ]
        ctx = TabContext(
            self_tab_id=50,
            opener_tab_id=0,
            tabs=tabs,
            resume_reason="stress_test",
            close_hint=False,
            origin_confirmed=True,
        )
        data = ctx.model_dump()
        assert len(data["tabs"]) == 100
        restored = TabContext.model_validate(data)
        assert restored == ctx
        assert len(restored.tabs) == 100
        assert restored.tabs[50].is_active is True


class TestGoalStepRequestAndResponseBoundaries:
    """Stress tests attacking boundary conditions of GoalStepRequest and Response."""

    def test_missing_goal_raises_validation_error(self):
        with pytest.raises(ValidationError):
            GoalStepRequest(current_url="https://example.com")

    def test_oversized_goal_over_2000_chars_raises_validation_error(self):
        with pytest.raises(ValidationError):
            GoalStepRequest(goal="A" * 2001, current_url="https://example.com")

    def test_goal_at_exact_2000_chars(self):
        req = GoalStepRequest(goal="A" * 2000, current_url="https://example.com")
        assert len(req.goal) == 2000

    def test_oversized_current_url_over_2048_chars_raises_validation_error(self):
        with pytest.raises(ValidationError):
            GoalStepRequest(goal="test", current_url="https://example.com/" + "x" * 2040)

    def test_oversized_page_text_over_50000_chars_raises_validation_error(self):
        with pytest.raises(ValidationError):
            GoalStepRequest(goal="test", current_url="https://example.com", page_text="X" * 50001)

    def test_page_text_at_exact_50000_chars(self):
        req = GoalStepRequest(goal="test", current_url="https://example.com", page_text="X" * 50000)
        assert len(req.page_text) == 50000

    def test_extra_fields_in_payload_ignored_safely(self):
        payload = {
            "goal": "test goal",
            "current_url": "https://example.com",
            "malicious_extra_field": "injected_payload_data",
            "unexpected_nested": {"foo": "bar"},
        }
        req = GoalStepRequest.model_validate(payload)
        assert not hasattr(req, "malicious_extra_field")

    def test_response_full_roundtrip_with_multi_tab_directives(self):
        resp = GoalStepResponse(
            status="in_progress",
            goal_state=GoalState(goal="Multi-tab goal"),
            reply="Switching active tab to opener",
            steps=[PlanStep(action="switch_tab", tab_id=1, description="Switch to opener")],
            close_tab=True,
            switch_tab_id=1,
            requires_origin_confirmation=False,
            contract_version=2,
            assisted_click={"element_id": "atlas-001", "prompt": "Click to allow popup"},
        )
        json_data = resp.model_dump_json()
        reloaded = GoalStepResponse.model_validate_json(json_data)
        assert reloaded == resp
        assert reloaded.switch_tab_id == 1
        assert reloaded.close_tab is True
        assert reloaded.steps[0].action == "switch_tab"
        assert reloaded.steps[0].tab_id == 1


class TestAdversarialUrlAndTokenRedaction:
    """Stress tests attacking URL redaction and token sanitization logic."""

    @pytest.mark.parametrize(
        "raw_url,expected_clean",
        [
            ("https://auth.example.com/oauth/authorize?code=xyz#step", "https://auth.example.com/oauth/authorize"),
            ("https://auth.example.com/oauth/authorize?CODE=xyz", "https://auth.example.com/oauth/authorize"),
            ("https://auth.example.com/oauth/authorize?access_token=abc&state=1#id_token=jwt", "https://auth.example.com/oauth/authorize"),
            ("https://example.com/path?redirect=https%3A%2F%2Fother.com%3Ftoken%3Dsecret&code=123#frag", "https://example.com/path"),
            ("https://example.com?token=secret#frag", "https://example.com"),
            ("//example.com/login?token=secret#frag", "//example.com/login"),
            ("https://example.com/path#access_token=secret", "https://example.com/path"),
            ("https://example.com/path#step?token=secret", "https://example.com/path"),
            ("https://example.com/path?a=1?b=2#frag1#frag2", "https://example.com/path"),
            ("  https://example.com/path?code=123#frag  ", "https://example.com/path"),
            ("/relative/path?token=secret#frag", "/relative/path"),
            ("https://مثال.إختبار/مسار?token=secret#علامة", "https://مثال.إختبار/مسار"),
        ],
    )
    def test_redact_url_strips_queries_and_fragments(self, raw_url, expected_clean):
        assert redact_url(raw_url) == expected_clean

    def test_redact_url_falsy_inputs(self):
        assert redact_url("") == ""
        assert redact_url(None) == ""
        assert redact_url(12345) == ""

    @pytest.mark.parametrize(
        "raw_text,expected_clean",
        [
            ("?code=xyz", "?[REDACTED]"),
            ("?CODE=xyz", "?[REDACTED]"),
            ("?access_token=abc123secret", "?[REDACTED]"),
            ("?Access_Token=abc123secret", "?[REDACTED]"),
            ("token=secret_val", "[REDACTED]"),
            ("TOKEN=secret_val", "[REDACTED]"),
            ('token="quoted_val"', "[REDACTED]"),
            ("code=1&access_token=2&token=3", "[REDACTED]&[REDACTED]&[REDACTED]"),
            ("Bearer token=jwt_secret", "Bearer [REDACTED]"),
            ("line1\ncode=xyz\nline2", "line1\n[REDACTED]\nline2"),
        ],
    )
    def test_sanitize_tokens_replaces_sensitive_params(self, raw_text, expected_clean):
        assert sanitize_tokens(raw_text) == expected_clean

    def test_sanitize_tokens_preserves_non_sensitive_token_words(self):
        assert sanitize_tokens("Tokenizer tokenized") == "Tokenizer tokenized"

    def test_cap_title_codepoint_accuracy(self):
        # Python string slicing operates on Unicode codepoints
        title_80 = "A" * 79 + "🚀"
        capped = cap_title(title_80, 80)
        assert len(capped) == 80
        assert capped.endswith("🚀")

        title_81 = "A" * 80 + "🚀"
        capped_81 = cap_title(title_81, 80)
        assert len(capped_81) == 80
        assert capped_81 == "A" * 80


class TestSacredRailsAndUniversalCompliance:
    """Enforces strict invariant verification on sacred rails and universal directive."""

    def test_verifier_rules_4_5_6_zero_diff_lines(self):
        """Rules 4, 5, 6 in verifier.py must have strictly 0 diff lines."""
        repo_root = Path(__file__).resolve().parents[2]
        res = subprocess.run(
            ["git", "diff", "--", "backend/app/agent/verifier.py"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        assert res.stdout.strip() == "", f"Sacred rails violated in verifier.py:\n{res.stdout}"

    def test_prime_directive_zero_domain_hardcoding(self):
        """Zero hardcoded domains in Milestone 2 production files."""
        repo_root = Path(__file__).resolve().parents[2]
        res = subprocess.run(
            [
                "git", "grep", "-i", "-E",
                "(amazon\\.com|google\\.com|wikipedia\\.org|drive\\.google\\.com)",
                "--",
                "backend/app/models/goal.py",
                "backend/app/models/action.py",
                "backend/app/agent/sanitize.py",
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
        )
        assert res.returncode == 1, f"Found prohibited hardcoded domains:\n{res.stdout}"
        assert res.stdout.strip() == ""

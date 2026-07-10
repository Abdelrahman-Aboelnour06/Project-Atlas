"""
conftest.py — shared fixtures and blocker patches.

Patches the 3 known blockers from ATLAS_PROGRESS_2.md before any app import:
  1. app.agent.simplify_prompt  — file doesn't exist yet
  2. app.agent.simplify_parser  — file doesn't exist yet
  3. _log_usage                 — missing from app.db.connection
"""
import sys
from unittest.mock import AsyncMock, MagicMock
import pytest

# ── Patch missing modules BEFORE any app import ───────────────────────────────

# Blocker 1 & 2: simplify pipeline files used to not exist yet, so this
# patched fake modules into sys.modules unconditionally. Now that the real
# app/agent/simplify_prompt.py and app/agent/simplify_parser.py exist, try
# the real import first and only fall back to a mock if it's still missing
# (e.g. someone running an older checkout of the tree). Using
# `sys.modules.setdefault` unconditionally would have permanently shadowed
# the real files with these mocks even after they were built.
try:
    import app.agent.simplify_prompt  # noqa: F401
except ImportError:
    _simplify_prompt_mock = MagicMock()
    _simplify_prompt_mock.build_simplify_prompt = MagicMock(
        return_value="MOCK SIMPLIFY PROMPT"
    )
    sys.modules["app.agent.simplify_prompt"] = _simplify_prompt_mock

try:
    import app.agent.simplify_parser  # noqa: F401
except ImportError:
    _simplify_parser_mock = MagicMock()
    _simplify_parser_mock.parse_simplify_response = MagicMock(return_value=[
        {"element_id": "atlas-001", "label": "Checkout button", "category": "button"},
        {"element_id": "atlas-002", "label": "Email field",     "category": "input"},
    ])
    sys.modules["app.agent.simplify_parser"] = _simplify_parser_mock

# Blocker 3: _log_usage missing from connection.py
try:
    import app.db.connection as _conn
    if not hasattr(_conn, "_log_usage"):
        _conn._log_usage = AsyncMock(return_value=None)
except ImportError:
    pass

# ── Constants ─────────────────────────────────────────────────────────────────
DEMO_API_KEY  = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
WRONG_API_KEY = "atlas_thisiswrongdonotuse000000000000"


# ── Shared DOM fixtures ───────────────────────────────────────────────────────
@pytest.fixture
def demo_api_key():
    return DEMO_API_KEY


@pytest.fixture
def sample_dom_map():
    """Two nodes using synthetic data-atlas-id (Contract 3 v1.1)."""
    return [
        {
            "id":          "atlas-001",     # synthetic data-atlas-id, NOT native HTML id
            "tag":         "button",
            "type":        None,
            "inner_text":  "Proceed to Checkout",
            "placeholder": None,
            "aria_label":  "Proceed to Checkout",
            "href":        None,
            "name":        None,
            "role":        None,
        },
        {
            "id":          "atlas-002",
            "tag":         "input",
            "type":        "email",
            "inner_text":  None,
            "placeholder": "Enter your email",
            "aria_label":  "Email address",
            "href":        None,
            "name":        "email",
            "role":        None,
        },
    ]


@pytest.fixture
def command_ws_payload(sample_dom_map):
    """Valid type:command WS message — Contract 1 v1.1."""
    return {
        "session_id": "test-session-001",
        "api_key":    DEMO_API_KEY,
        "url":        "https://demo.atlas.com/checkout",
        "dom_map":    sample_dom_map,
        "command":    "click checkout button",
        "type":       "command",
    }


@pytest.fixture
def simplify_ws_payload(sample_dom_map):
    """Valid type:simplify WS message — Contract 1 v1.1."""
    return {
        "session_id": "test-session-002",
        "api_key":    DEMO_API_KEY,
        "url":        "https://demo.atlas.com/products",
        "dom_map":    sample_dom_map,
        "command":    "",
        "type":       "simplify",
    }

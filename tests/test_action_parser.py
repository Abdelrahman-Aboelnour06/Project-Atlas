"""
test_action_parser.py — parse_action() edge cases.

Progress doc (section 15) explicitly requires testing:
  - malformed JSON
  - missing fields
  - hallucinated element_id (not in dom_map)
  - markdown-fenced output (```json ... ```)

Both the command parser and simplify parser are covered.
The simplify parser is mocked since the file doesn't exist yet —
these tests act as a spec for what it must do when built.
"""
import json
import pytest


# ── Command parser (parse_action) ─────────────────────────────────────────────

class TestParseAction:
    """Tests for app.agent.parser.parse_action()"""

    def _parse(self, raw: str, dom_map: list | None = None):
        from app.agent.parser import parse_action
        if dom_map is None:
            dom_map = [{"id": "atlas-001"}, {"id": "atlas-002"}]
        return parse_action(raw, dom_map)

    def test_valid_click_action(self):
        raw = json.dumps({
            "action":     "click",
            "element_id": "atlas-001",
            "value":      None,
            "message":    "Clicked Checkout button",
        })
        result = self._parse(raw)
        assert result.status == "success"
        assert result.action == "click"
        assert result.element_id == "atlas-001"

    def test_valid_fill_action(self):
        raw = json.dumps({
            "action":     "fill",
            "element_id": "atlas-002",
            "value":      "john@example.com",
            "message":    "Filled email field",
        })
        result = self._parse(raw)
        assert result.status == "success"
        assert result.action == "fill"
        assert result.value == "john@example.com"

    def test_all_valid_action_types(self):
        for action in ("click", "fill", "scroll", "focus"):
            raw = json.dumps({
                "action": action, "element_id": "atlas-001",
                "value": None, "message": f"did {action}",
            })
            result = self._parse(raw)
            assert result.status == "success", f"Action '{action}' should succeed"
            assert result.action == action

    # ── Malformed JSON ────────────────────────────────────────────────────────

    def test_malformed_json_returns_error(self):
        result = self._parse("this is not json at all")
        assert result.status == "error"
        assert result.action is None

    def test_empty_string_returns_error(self):
        result = self._parse("")
        assert result.status == "error"

    def test_partial_json_returns_error(self):
        result = self._parse('{"action": "click"')   # unclosed brace
        assert result.status == "error"

    # ── Markdown-fenced output ────────────────────────────────────────────────

    def test_markdown_fenced_json_handled(self):
        """LLM often wraps output in ```json ... ``` — parser must strip this."""
        raw = '```json\n{"action":"click","element_id":"atlas-001","value":null,"message":"Done"}\n```'
        result = self._parse(raw)
        assert result.status == "success", (
            "Parser must strip ```json fences before parsing — LLMs do this often"
        )
        assert result.action == "click"

    def test_markdown_fence_no_language_tag(self):
        raw = '```\n{"action":"click","element_id":"atlas-001","value":null,"message":"Done"}\n```'
        result = self._parse(raw)
        assert result.status == "success"

    def test_leading_trailing_whitespace_handled(self):
        raw = '  \n  {"action":"click","element_id":"atlas-001","value":null,"message":"Done"}  \n  '
        result = self._parse(raw)
        assert result.status == "success"

    # ── Missing fields ────────────────────────────────────────────────────────

    def test_missing_action_field_returns_error(self):
        raw = json.dumps({"element_id": "atlas-001", "value": None, "message": "?"})
        result = self._parse(raw)
        assert result.status == "error"

    def test_missing_element_id_returns_error(self):
        raw = json.dumps({"action": "click", "value": None, "message": "?"})
        result = self._parse(raw)
        assert result.status == "error"

    def test_empty_element_id_returns_error(self):
        raw = json.dumps({"action": "click", "element_id": "", "value": None, "message": "?"})
        result = self._parse(raw)
        assert result.status == "error"

    def test_null_element_id_returns_error(self):
        raw = json.dumps({"action": "click", "element_id": None, "value": None, "message": "?"})
        result = self._parse(raw)
        assert result.status == "error"

    def test_invalid_action_value_returns_error(self):
        raw = json.dumps({"action": "hover", "element_id": "atlas-001", "value": None, "message": "?"})
        result = self._parse(raw)
        assert result.status == "error"

    # ── Hallucinated element_id ───────────────────────────────────────────────

    def test_hallucinated_element_id_returns_error(self):
        """
        LLM returns an element_id that doesn't exist in the dom_map sent.
        Parser must validate against the actual dom_map and reject.
        """
        raw = json.dumps({
            "action":     "click",
            "element_id": "atlas-999",   # not in dom_map
            "value":      None,
            "message":    "Clicked nonexistent button",
        })
        dom_map = [{"id": "atlas-001"}, {"id": "atlas-002"}]
        result = self._parse(raw, dom_map)
        assert result.status == "error", (
            "Parser must reject hallucinated element_ids not present in dom_map"
        )

    def test_valid_element_id_from_dom_map_accepted(self):
        raw = json.dumps({
            "action":     "click",
            "element_id": "atlas-002",
            "value":      None,
            "message":    "Clicked",
        })
        dom_map = [{"id": "atlas-001"}, {"id": "atlas-002"}]
        result = self._parse(raw, dom_map)
        assert result.status == "success"

    def test_hallucinated_id_with_empty_dom_map(self):
        """Empty dom_map means no valid IDs — any element_id is hallucinated."""
        raw = json.dumps({
            "action": "click", "element_id": "atlas-001",
            "value": None, "message": "?",
        })
        result = self._parse(raw, dom_map=[])
        assert result.status == "error"


# ── Simplify parser (spec tests — mocked since file doesn't exist yet) ─────────

class TestParseSimplifyResponse:
    """
    Spec tests for app.agent.simplify_parser.parse_simplify_response().
    These run against the mock from conftest.py right now.
    When the real file is built, these define the required behavior.
    """

    def test_returns_list(self, sample_dom_map):
        from app.agent.simplify_parser import parse_simplify_response
        result = parse_simplify_response("MOCK_RAW", sample_dom_map)
        assert isinstance(result, list)

    def test_each_entry_has_required_fields(self, sample_dom_map):
        """Contract 5: each entry must have element_id, label, category."""
        from app.agent.simplify_parser import parse_simplify_response
        result = parse_simplify_response("MOCK_RAW", sample_dom_map)
        for entry in result:
            assert "element_id" in entry, "Missing element_id"
            assert "label"      in entry, "Missing label"
            assert "category"   in entry, "Missing category"

    def test_hallucinated_ids_dropped(self, sample_dom_map):
        """
        REAL parser must drop any element_id not in the dom_map.
        This is the hallucination-check the progress doc requires.
        (Will only be meaningful once the real parser exists.)
        """
        from app.agent.simplify_parser import parse_simplify_response
        result = parse_simplify_response("MOCK_RAW", sample_dom_map)
        valid_ids = {node["id"] for node in sample_dom_map}
        for entry in result:
            assert entry["element_id"] in valid_ids, (
                f"element_id '{entry['element_id']}' is not in dom_map — "
                "hallucinated IDs must be dropped"
            )

    def test_malformed_json_returns_empty_list(self, sample_dom_map):
        """
        REAL parser must return [] on malformed LLM output, never raise.
        (Mocked version passes trivially — test becomes real when file exists.)
        """
        from app.agent.simplify_parser import parse_simplify_response
        # The mock ignores the raw string — real implementation must handle bad input
        # This is a documentation test until the real file exists
        try:
            result = parse_simplify_response("not json {{{{", sample_dom_map)
            assert isinstance(result, list)
        except Exception as e:
            pytest.fail(
                f"parse_simplify_response must never raise — got {type(e).__name__}: {e}"
            )

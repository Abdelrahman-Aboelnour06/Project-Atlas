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


# ── Simplify parser (app.agent.simplify_parser.parse_simplify_response) ────────

class TestParseSimplifyResponse:
    """
    Real tests against the real parser (Day 3 PM task).

    The class used to run against the conftest.py mock from before this
    file existed — those were placeholder/"documentation" tests that
    passed trivially (mock ignored its input, or the loop bodies never
    ran on an empty list). Now that app/agent/simplify_parser.py is
    built, these exercise the actual success path plus the 4 cases the
    progress doc calls out: malformed JSON, missing fields, hallucinated
    element_id, and markdown-fenced output — plus two extra edge cases
    found while building it (duplicate ids, unknown category).
    """

    def _parse(self, raw: str, dom_map=None):
        from app.agent.simplify_parser import parse_simplify_response
        return parse_simplify_response(raw, dom_map)

    # ── Happy path ──────────────────────────────────────────────────────────

    def test_valid_response_returns_expected_entries(self, sample_dom_map):
        raw = json.dumps([
            {"element_id": "atlas-001", "label": "Go to checkout", "category": "button"},
            {"element_id": "atlas-002", "label": "Enter your email", "category": "input"},
        ])
        result = self._parse(raw, sample_dom_map)
        assert result == [
            {"element_id": "atlas-001", "label": "Go to checkout", "category": "button"},
            {"element_id": "atlas-002", "label": "Enter your email", "category": "input"},
        ]

    def test_returns_list(self, sample_dom_map):
        result = self._parse("not json {{{{", sample_dom_map)
        assert isinstance(result, list)

    def test_each_entry_has_required_fields(self, sample_dom_map):
        """Contract 5: each entry must have element_id, label, category."""
        raw = json.dumps([{"element_id": "atlas-001", "label": "Go to checkout", "category": "button"}])
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1
        for entry in result:
            assert "element_id" in entry, "Missing element_id"
            assert "label"      in entry, "Missing label"
            assert "category"   in entry, "Missing category"

    # ── 1. Malformed JSON ───────────────────────────────────────────────────

    def test_malformed_json_returns_empty_list(self, sample_dom_map):
        """Non-JSON LLM output must return [] and never raise."""
        try:
            result = self._parse("not json {{{{", sample_dom_map)
        except Exception as e:
            pytest.fail(f"parse_simplify_response must never raise — got {type(e).__name__}: {e}")
        assert result == []

    def test_json_object_instead_of_array_returns_empty_list(self, sample_dom_map):
        """LLM returning a single object instead of an array is still handled gracefully."""
        raw = json.dumps({"element_id": "atlas-001", "label": "Go to checkout", "category": "button"})
        assert self._parse(raw, sample_dom_map) == []

    def test_empty_string_returns_empty_list(self, sample_dom_map):
        assert self._parse("", sample_dom_map) == []

    # ── 2. Missing fields ───────────────────────────────────────────────────

    def test_entry_missing_element_id_dropped(self, sample_dom_map):
        raw = json.dumps([
            {"label": "Go to checkout", "category": "button"},          # no element_id — dropped
            {"element_id": "atlas-002", "label": "Enter your email", "category": "input"},
        ])
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1
        assert result[0]["element_id"] == "atlas-002"

    def test_entry_missing_label_dropped(self, sample_dom_map):
        raw = json.dumps([
            {"element_id": "atlas-001", "category": "button"},           # no label — dropped
            {"element_id": "atlas-002", "label": "Enter your email", "category": "input"},
        ])
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1
        assert result[0]["element_id"] == "atlas-002"

    def test_non_dict_entries_skipped(self, sample_dom_map):
        """A stray string/number in the array shouldn't crash the whole response."""
        raw = json.dumps([
            "atlas-001",
            {"element_id": "atlas-002", "label": "Enter your email", "category": "input"},
        ])
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1
        assert result[0]["element_id"] == "atlas-002"

    # ── 3. Hallucinated element_id ──────────────────────────────────────────

    def test_hallucinated_id_dropped(self, sample_dom_map):
        raw = json.dumps([
            {"element_id": "atlas-001", "label": "Go to checkout", "category": "button"},
            {"element_id": "atlas-999", "label": "Invented button", "category": "button"},  # not in dom_map
        ])
        result = self._parse(raw, sample_dom_map)
        ids = {entry["element_id"] for entry in result}
        assert ids == {"atlas-001"}, "Hallucinated id must be dropped, real one kept"

    def test_all_hallucinated_with_empty_dom_map_returns_empty_list(self):
        raw = json.dumps([{"element_id": "atlas-001", "label": "Go to checkout", "category": "button"}])
        assert self._parse(raw, dom_map=[]) == []

    # ── 4. Markdown-fenced output ────────────────────────────────────────────

    def test_json_fenced_output_parsed(self, sample_dom_map):
        raw = (
            "```json\n"
            + json.dumps([{"element_id": "atlas-001", "label": "Go to checkout", "category": "button"}])
            + "\n```"
        )
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1 and result[0]["element_id"] == "atlas-001"

    def test_plain_fenced_output_parsed(self, sample_dom_map):
        raw = (
            "```\n"
            + json.dumps([{"element_id": "atlas-002", "label": "Enter your email", "category": "input"}])
            + "\n```"
        )
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1 and result[0]["element_id"] == "atlas-002"

    # ── Extra edge cases found while building the parser ────────────────────

    def test_duplicate_element_ids_deduped(self, sample_dom_map):
        """Only the first entry per real element is kept."""
        raw = json.dumps([
            {"element_id": "atlas-001", "label": "Go to checkout", "category": "button"},
            {"element_id": "atlas-001", "label": "Duplicate entry", "category": "button"},
        ])
        result = self._parse(raw, sample_dom_map)
        assert len(result) == 1
        assert result[0]["label"] == "Go to checkout"

    def test_unknown_category_defaults_to_other(self, sample_dom_map):
        raw = json.dumps([{"element_id": "atlas-001", "label": "Go to checkout", "category": "dropdown-thingy"}])
        result = self._parse(raw, sample_dom_map)
        assert result[0]["category"] == "other"


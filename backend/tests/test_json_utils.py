"""
Unit tests for app.agent.json_utils.

Covers:
- extract_json with closed <think>...</think> blocks
- extract_json with unclosed <think> blocks before JSON
- extract_json with trailing prose containing stray braces '{'
- extract_json with nested objects and arrays
- extract_json with braces and escaped quotes inside string literals
- extract_json with markdown code fences and conversational prose (English and Arabic)
- extract_json with top-level JSON arrays
- repair_json passthrough on already-valid JSON
- repair_json retry once on malformed/broken JSON
- repair_json failure handling
"""

import json
import pytest
from unittest.mock import AsyncMock, patch

from app.agent.json_utils import extract_json, repair_json
from app.agent.llm_client import LLMError, set_mock_llm_queue, clear_mock_llm


class TestExtractJson:
    def test_extract_json_with_closed_think_block(self):
        raw = """<think>
User wants to click the search button.
Element atlas-001 is the best candidate.
</think>
{
  "action": "click",
  "element_id": "atlas-001"
}"""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["action"] == "click"
        assert data["element_id"] == "atlas-001"

    def test_extract_json_with_unclosed_think_block(self):
        raw = """<think>
Analyzing page elements for navigation...
{"action": "click", "element_id": "atlas-002"}"""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["action"] == "click"
        assert data["element_id"] == "atlas-002"

    def test_extract_json_with_trailing_prose_containing_braces(self):
        # A greedy regex \{[\s\S]*\} would grab from the first '{' to the last '{not json}' and fail.
        raw = '{"type": "plan", "reply": "ok"} and then some notes: {not json}'
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["type"] == "plan"
        assert data["reply"] == "ok"

    def test_extract_json_with_nested_objects_and_arrays(self):
        raw = """Note before JSON.
{
  "type": "plan",
  "meta": {
    "step_id": 1,
    "flags": {"verified": true, "sub": {"depth": 3}}
  },
  "steps": [
    {"action": "click", "element_id": "btn-1"},
    {"action": "type", "element_id": "input-2", "value": "text"}
  ]
}
Note after JSON with stray { brace."""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["type"] == "plan"
        assert data["meta"]["flags"]["sub"]["depth"] == 3
        assert len(data["steps"]) == 2

    def test_extract_json_with_braces_and_escaped_quotes_inside_strings(self):
        raw = r'{"message": "this is a brace { inside string and \" { still inside", "count": 10}'
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert "{" in data["message"]
        assert data["count"] == 10

    def test_extract_json_with_markdown_fences(self):
        raw = """```json
{
  "action": "click",
  "element_id": "btn-search"
}
```"""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["element_id"] == "btn-search"

    def test_extract_json_with_surrounding_conversational_arabic(self):
        raw = """أهلاً بك! إليك الرد المطلوب:
{
  "type": "plan",
  "thought": "الضغط على زر الاشتراك",
  "reply": "هندوس على زر الاشتراك دلوقتي",
  "steps": [
    {
      "action": "click",
      "element_id": "btn-sub",
      "description": "دوس على اشتراك"
    }
  ]
}
أتمنى أن أكون قد أفدتك! {ملاحظة: تأكد من الصفحة}"""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert data["type"] == "plan"
        assert data["steps"][0]["element_id"] == "btn-sub"
        assert "اشتراك" in data["thought"]

    def test_extract_json_with_top_level_array(self):
        raw = """Here are the discovered elements:
[
  {"element_id": "atlas-001", "label": "Search", "category": "button"},
  {"element_id": "atlas-002", "label": "Login", "category": "link"}
]
Done."""
        extracted = extract_json(raw)
        data = json.loads(extracted)
        assert isinstance(data, list)
        assert len(data) == 2
        assert data[0]["element_id"] == "atlas-001"

    def test_extract_json_empty_or_none(self):
        assert extract_json(None) == ""
        assert extract_json("") == ""


class TestRepairJson:
    def teardown_method(self):
        clear_mock_llm()

    @pytest.mark.asyncio
    async def test_repair_json_passthrough_on_valid_json(self):
        # Valid JSON should not invoke the LLM
        valid_raw = '{"status": "ok", "value": 123}'
        with patch("app.agent.llm_client.call_llm") as mock_call:
            res = await repair_json(valid_raw)
            assert mock_call.call_count == 0
            assert json.loads(res) == {"status": "ok", "value": 123}

    @pytest.mark.asyncio
    async def test_repair_json_retries_once_on_malformed_json(self):
        # Trailing comma and single quotes (invalid JSON)
        malformed = "{'action': 'click', 'element_id': 'atlas-001',}"

        set_mock_llm_queue(['{"action": "click", "element_id": "atlas-001"}'])
        res = await repair_json(malformed, schema_hint="action, element_id")
        data = json.loads(res)
        assert data["action"] == "click"
        assert data["element_id"] == "atlas-001"

    @pytest.mark.asyncio
    async def test_repair_json_deterministic_mock_repair(self):
        malformed = "{'status': 'repaired', 'count': 5,}"
        # Without setting queue, deterministic mock repair handles single quotes and trailing commas
        res = await repair_json(malformed)
        data = json.loads(res)
        assert data["count"] == 5

    @pytest.mark.asyncio
    async def test_repair_json_failure_raises_llmerror(self):
        # If repair model returns non-JSON, repair_json raises LLMError
        set_mock_llm_queue(["This is not JSON at all."])
        with pytest.raises(LLMError, match="Failed to repair malformed JSON"):
            await repair_json("unparseable junk")

    @pytest.mark.asyncio
    async def test_repair_json_propagates_timeout_without_second_retry(self):
        # If the LLM call times out, repair_json should propagate LLMError directly and not retry again
        with patch("app.agent.llm_client.call_llm", side_effect=LLMError("LLM request timed out")):
            with pytest.raises(LLMError, match="timed out"):
                await repair_json("broken json")

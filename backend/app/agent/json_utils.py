"""
backend/app/agent/json_utils.py — Universal JSON Extraction and Repair Helper

Part of Project Atlas (WS8 LLM Reliability).
Extracts valid JSON objects and arrays from raw LLM responses by:
1. Stripping closed and unclosed <think> reasoning blocks.
2. Unwrapping markdown code fences.
3. Conducting a brace-depth and bracket-depth scan that respects strings and escapes,
   returning the first balanced candidate that json.loads accepts.
"""

import json
import re
from typing import Any, Optional, Tuple


def extract_json(raw: Optional[str]) -> str:
    """
    Extracts the first valid JSON object or array from raw LLM output string.

    Uses a robust brace-depth and bracket-depth scanner respecting string boundaries
    and escape characters, ensuring trailing prose with braces or nested structures
    do not break parsing.

    Args:
        raw: Raw model completion string.

    Returns:
        Clean JSON substring parseable by json.loads, or stripped text if none matches.
    """
    if not raw:
        return ""

    text = str(raw).strip()

    # 1. Strip closed <think>...</think> reasoning blocks from open reasoning models
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()

    # 2. Strip unclosed <think> blocks (e.g. truncated completions or missing </think>)
    if "<think>" in text.lower():
        match_think = re.search(r"<think>", text, flags=re.IGNORECASE)
        if match_think:
            after_think = text[match_think.start():]
            m_brace = re.search(r"[{\[]", after_think)
            if m_brace:
                # Keep text before <think> and resume from the first JSON token after <think>
                text = (text[:match_think.start()] + after_think[m_brace.start():]).strip()
            else:
                text = text[:match_think.start()].strip()

    # 3. Unwrap markdown code fences if wrapping the content
    if "```" in text:
        match_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
        if match_block:
            fence_content = match_block.group(1).strip()
            if "{" in fence_content or "[" in fence_content:
                text = fence_content

    # 4. Quick check: if the entire text already loads cleanly, return it directly
    try:
        json.loads(text)
        return text
    except Exception:
        pass

    # 5. Scan for balanced {...} object and [...] array
    res_obj = _find_first_balanced_json(text, open_char="{", close_char="}")
    res_arr = _find_first_balanced_json(text, open_char="[", close_char="]")

    if res_obj and res_arr:
        # If the array encloses the object (e.g. [{"id": 1}]), return the outer array
        if res_arr[1] <= res_obj[1] and res_arr[2] >= res_obj[2]:
            return res_arr[0]
        # Otherwise, prefer the object
        return res_obj[0]

    if res_obj:
        return res_obj[0]
    if res_arr:
        return res_arr[0]

    # Fallback to stripped text
    return text.strip()


def _find_first_balanced_json(text: str, open_char: str, close_char: str) -> Optional[Tuple[str, int, int]]:
    """
    Scans text for the first balanced pair of open_char and close_char that
    parses as valid JSON via json.loads, respecting string literals and escape characters.
    Returns (candidate_str, start_pos, end_pos) if found, else None.
    """
    length = len(text)
    start_idx = 0

    while start_idx < length:
        # Find next opening character
        pos = text.find(open_char, start_idx)
        if pos == -1:
            break

        depth = 0
        in_string = False
        escape = False
        end_idx = -1

        for i in range(pos, length):
            ch = text[i]

            if escape:
                escape = False
                continue

            if ch == "\\" and in_string:
                escape = True
                continue

            if ch == '"':
                in_string = not in_string
                continue

            if not in_string:
                if ch == open_char:
                    depth += 1
                elif ch == close_char:
                    depth -= 1
                    if depth == 0:
                        end_idx = i
                        break

        if end_idx != -1:
            candidate = text[pos : end_idx + 1].strip()
            try:
                json.loads(candidate)
                return candidate, pos, end_idx
            except Exception:
                # If this balanced chunk isn't valid JSON, continue search from pos + 1
                pass

        start_idx = pos + 1

    return None


async def repair_json(
    raw: str,
    schema_hint: Optional[str] = None,
    role: Optional[str] = "repair",
    model: Optional[str] = None,
    **kwargs: Any,
) -> str:
    """
    Re-exports repair_json from app.agent.llm_client for shared convenience.
    """
    from app.agent.llm_client import repair_json as _repair_json
    return await _repair_json(raw=raw, schema_hint=schema_hint, role=role, model=model, **kwargs)

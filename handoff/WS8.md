# WS8 LLM Reliability
Branch: feat/llm-repair   Last commit: 8a768b8   Model used: Gemini 3.8 Flash
Status: done

Done:
- backend/app/agent/json_utils.py:1: created `extract_json(raw)` with brace-depth and bracket-depth scanner respecting string boundaries and escape characters, stripping closed & unclosed `<think>` reasoning tags, markdown code blocks, and prose.
- backend/app/agent/json_utils.py:145: created `repair_json(raw, schema_hint)` retrying once asking the model for valid JSON on parse failure.
- backend/app/agent/llm_client.py:85: added structured failure diagnostics (`record_llm_failure`, `record_llm_success`, `get_llm_health_info`, `is_limited_mode`, `reset_llm_health`) logging provider, model, error_class, and status_code with zero secret or prompt leakage.
- backend/app/agent/llm_client.py:610: added opt-in `json_mode: bool = False` flag to `call_llm` for Ollama (`format="json"`), Groq/NIM/OpenAI (`response_format={"type": "json_object"}`), with automatic HTTP 400 fallback that retries once without `response_format` and remembers for the process.
- backend/app/agent/llm_client.py:787: added final `record_llm_failure` and `raise LLMError("LLM call exhausted retries")` after the attempt loop in `call_llm` to ensure exhausted attempts never return None.
- backend/app/agent/llm_client.py:476: added deterministic mock repair in `_generate_deterministic_mock_response` for `role="repair"`.
- backend/app/agent/llm_client.py:765: implemented `repair_json` that runs only on parse failure (never on timeouts or 4xx/5xx HTTP errors) and at most once.
- backend/app/routes/health.py:15: extended `HealthResponse` with `provider`, `model`, `last_error_class`, `last_error_time`, and `limited_mode: bool`.
- backend/app/routes/health.py:38: updated `health_check` to report provider metadata and set `limited_mode` to True on failure, resetting to False on subsequent success.
- backend/tests/conftest.py:60: added `llm_client.reset_llm_health()` to the autouse fixture `isolate_mock_state_and_rate_limits` for guaranteed test isolation.
- backend/tests/test_json_utils.py:1: added 14 comprehensive tests covering `<think>` tags, unclosed `<think>`, trailing prose containing '{', nested objects, string braces, code fences, Arabic prose, arrays, and repair retries.
- backend/tests/test_llm_client.py:277: added tests for timeout raising `LLMError` with cause, zero-leak logging, `json_mode` payloads, HTTP 400 fallback memory, timeout+timeout+400 exhausted retry raising `LLMError`, and `limited_mode` state transitions.
- backend/tests/test_routes_rest.py:92: added tests for `/health` reporting `provider`, `model`, `limited_mode`, and ensuring error messages or URLs are never leaked.

Tests run:
- Isolated WS8 suite: `cd backend && LLM_PROVIDER=mock pytest tests/test_json_utils.py tests/test_llm_client.py tests/test_routes_rest.py -v`: 62 passed, 0 failed in 3.25s
- Full backend suite from `./backend`: `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 982 passed, 0 failed, 3 warnings in 8.31s
- Full backend suite from repo root: `LLM_PROVIDER=mock pytest backend/tests -q`: 982 passed, 0 failed, 3 warnings in 6.48s
- JS test suite: `npm run test:js`: 1,136 passed, 0 failed across all 27 JS/fixture suites in 17.5s

Next steps:
1. Integrator merges `feat/llm-repair` into Wave 1 integration branch.
2. WS2 imports `is_limited_mode` in `backend/app/agent/agentic_planner.py` to render the localized limited mode message.
3. Other agent owners adopt `extract_json` from `backend/app/agent/json_utils.py`.

Requests for other workstreams:
- WS2 (`agentic_planner.py` / `i18n`):
  Import `is_limited_mode`:
  `from app.agent.llm_client import is_limited_mode`
  When planner fallback occurs and `is_limited_mode()` returns True, return the localized reply:
  `t("error_limited_mode", language)` (or Egyptian Arabic string: "أطلس شغال دلوقتي في الوضع المحدود عشان خدمة الذكاء الاصطناعي مش متوفرة حالياً") instead of "I reviewed the page, but couldn't find an element matching...".
- WS2, WS6, WS7 (`agentic_planner.py`, `navigator.py`, `form_filler.py`, `planner.py`, `scout.py`, `verifier.py`):
  Replace local `_clean_json_str(raw)` duplicates with:
  `from app.agent.json_utils import extract_json`
  `cleaned = extract_json(raw_llm)`
  This universally strips `<think>` blocks, unclosed thinking tags, markdown fences, and prose across all models without regex breakage.

Open questions for Raafat:
- None.

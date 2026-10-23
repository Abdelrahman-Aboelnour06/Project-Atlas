"""
Unit tests for app.agent.llm_client.
Tests:
- _reasoning_tokens lookup across model families
- call_llm NIM branch with reasoning=True vs reasoning=False
- call_llm Ollama branch prompt concatenation
- Retry and error handling
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from app.agent import llm_client
from app.agent.llm_client import _reasoning_tokens, call_llm, LLMError


# ── _reasoning_tokens lookup ──────────────────────────────────────────────────

class TestReasoningTokens:
    def test_nemotron_v1_5_returns_slash_think(self):
        assert _reasoning_tokens("nvidia/llama-3.3-nemotron-super-49b-v1.5") == ("/think", "/no_think")
        assert _reasoning_tokens("nvidia/nemotron-v1_5") == ("/think", "/no_think")
        assert _reasoning_tokens("NVIDIA/LLAMA-3.3-NEMOTRON-SUPER-49B-V1.5") == ("/think", "/no_think")

    def test_nemotron_super_without_v1_5_returns_detailed_thinking(self):
        assert _reasoning_tokens("nvidia/llama-nemotron-super-49b") == (
            "detailed thinking on",
            "detailed thinking off",
        )
        assert _reasoning_tokens("nemotron-super") == (
            "detailed thinking on",
            "detailed thinking off",
        )

    def test_non_nemotron_returns_none(self):
        assert _reasoning_tokens("meta/llama-3.2-11b-vision-instruct") is None
        assert _reasoning_tokens("meta/llama-3.1-70b-instruct") is None
        assert _reasoning_tokens("mistralai/mistral-7b-instruct") is None
        assert _reasoning_tokens("llama3") is None


# ── call_llm NIM branch ───────────────────────────────────────────────────────

class TestCallLlmNIM:
    @pytest.mark.asyncio
    async def test_nim_reasoning_on_nemotron(self):
        fake_response = {
            "choices": [
                {"message": {"content": "{\"action\": \"click\", \"element_id\": \"btn-1\"}"}}
            ]
        }
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "nvidia_nim"), \
             patch("app.agent.llm_client.LLM_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1.5"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(
                user_prompt="DOM MAP:\n[]\n\nUSER COMMAND: click btn",
                system_prompt="You are an accessibility assistant.",
                reasoning=True,
            )

            assert res == "{\"action\": \"click\", \"element_id\": \"btn-1\"}"
            assert mock_post.called
            call_kwargs = mock_post.call_args.kwargs
            payload = call_kwargs.get("json", {})

            # Must set max_tokens=32768, temp=0.6, top_p=0.95
            assert payload.get("max_tokens") == 32768
            assert payload.get("temperature") == 0.6
            assert payload.get("top_p") == 0.95

            # System message must start with reasoning toggle /think prepended
            messages = payload.get("messages", [])
            assert len(messages) == 2
            assert messages[0]["role"] == "system"
            assert messages[0]["content"].startswith("/think\n")
            assert "You are an accessibility assistant." in messages[0]["content"]
            assert messages[1]["role"] == "user"

    @pytest.mark.asyncio
    async def test_nim_reasoning_off_nemotron(self):
        fake_response = {
            "choices": [
                {"message": {"content": "{\"action\": \"click\", \"element_id\": \"btn-2\"}"}}
            ]
        }
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "nvidia_nim"), \
             patch("app.agent.llm_client.LLM_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1.5"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(
                user_prompt="DOM MAP:\n[]\n\nUSER COMMAND: click btn",
                system_prompt="You are an accessibility assistant.",
                reasoning=False,
            )

            assert res == "{\"action\": \"click\", \"element_id\": \"btn-2\"}"
            assert mock_post.called
            call_kwargs = mock_post.call_args.kwargs
            payload = call_kwargs.get("json", {})

            # Must set max_tokens=1024, temp=0.0
            assert payload.get("max_tokens") == 1024
            assert payload.get("temperature") == 0.0

            # System message must start with reasoning toggle /no_think
            messages = payload.get("messages", [])
            assert len(messages) == 2
            assert messages[0]["role"] == "system"
            assert messages[0]["content"].startswith("/no_think\n")

    @pytest.mark.asyncio
    async def test_nim_non_nemotron_reasoning_noop(self):
        fake_response = {
            "choices": [{"message": {"content": "ok"}}]
        }
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "nvidia_nim"), \
             patch("app.agent.llm_client.LLM_MODEL", "meta/llama-3.1-8b-instruct"), \
             patch("httpx.AsyncClient.post", mock_post):

            await call_llm(
                user_prompt="User query",
                system_prompt="System instructions",
                reasoning=True,
            )

            payload = mock_post.call_args.kwargs.get("json", {})
            messages = payload.get("messages", [])
            assert len(messages) == 2
            # No toggle token added
            assert messages[0]["content"] == "System instructions"


# ── call_llm Ollama branch ────────────────────────────────────────────────────

class TestCallLlmOllama:
    @pytest.mark.asyncio
    async def test_ollama_branch_concatenates_single_prompt(self):
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "ollama reply"}
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "ollama"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama3"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(
                user_prompt="User input",
                system_prompt="System instructions",
                reasoning=False,
            )

            assert res == "ollama reply"
            payload = mock_post.call_args.kwargs.get("json", {})
            assert "prompt" in payload
            assert payload["prompt"] == "System instructions\n\nUser input"


# ── call_llm Groq branch ──────────────────────────────────────────────────────

class TestCallLlmGroq:
    @pytest.mark.asyncio
    async def test_groq_command_pipeline_call(self):
        fake_response = {
            "choices": [
                {"message": {"content": "{\"action\": \"click\", \"element_id\": \"atlas-001\"}"}}
            ]
        }
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_BASE_URL", "https://api.groq.com/openai/v1"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "gsk_test_mock_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(
                user_prompt="DOM MAP:\n[]\n\nUSER COMMAND: click checkout",
                system_prompt="You are an accessibility assistant.",
                reasoning=False,
            )

            assert res == "{\"action\": \"click\", \"element_id\": \"atlas-001\"}"
            call_url = mock_post.call_args.args[0]
            assert call_url == "https://api.groq.com/openai/v1/chat/completions"
            call_headers = mock_post.call_args.kwargs.get("headers", {})
            assert call_headers.get("Authorization") == "Bearer gsk_test_mock_key"
            payload = mock_post.call_args.kwargs.get("json", {})
            assert payload.get("model") == "llama-3.3-70b-versatile"
            assert payload.get("temperature") == 0.0
            assert payload.get("max_tokens") == 1024

    @pytest.mark.asyncio
    async def test_groq_simplify_pipeline_call(self):
        fake_response = {
            "choices": [
                {"message": {"content": "[{\"element_id\": \"atlas-001\", \"label\": \"Checkout\", \"category\": \"button\"}]"}}
            ]
        }
        mock_post = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_BASE_URL", "https://api.groq.com/openai/v1"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "gsk_test_mock_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(
                user_prompt="INTERACTIVE ELEMENTS:\n[]\n\nJSON response:",
                system_prompt="You are an accessibility assistant.",
                reasoning=True,
            )

            assert "atlas-001" in res
            payload = mock_post.call_args.kwargs.get("json", {})
            assert payload.get("model") == "llama-3.3-70b-versatile"
            assert payload.get("temperature") == 0.6
            assert payload.get("max_tokens") == 4096

    @pytest.mark.asyncio
    async def test_groq_ping_llm(self):
        from app.agent.llm_client import ping_llm
        mock_get = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_BASE_URL", "https://api.groq.com/openai/v1"), \
             patch("app.agent.llm_client.LLM_API_KEY", "gsk_test_mock_key"), \
             patch("httpx.AsyncClient.get", mock_get):

            ok = await ping_llm()
            assert ok is True
            call_url = mock_get.call_args.args[0]
            assert call_url == "https://api.groq.com/openai/v1/models"
            call_headers = mock_get.call_args.kwargs.get("headers", {})
            assert call_headers.get("Authorization") == "Bearer gsk_test_mock_key"


# ── Failure Logging & Diagnostics ─────────────────────────────────────────────

class TestCallLlmFailureAndLogging:
    def teardown_method(self):
        llm_client.reset_llm_health()

    @pytest.mark.asyncio
    async def test_timeout_raises_llmerror_with_logged_cause(self, caplog):
        import logging
        mock_post = AsyncMock(side_effect=httpx.TimeoutException("connection timed out"))

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "gsk_super_secret_key_12345"), \
             patch("httpx.AsyncClient.post", mock_post), \
             caplog.at_level(logging.ERROR, logger="atlas.agent.llm"):

            user_prompt = "SECRET_USER_PROMPT_DO_NOT_LEAK"
            with pytest.raises(LLMError) as exc_info:
                await call_llm(
                    user_prompt=user_prompt,
                    system_prompt="system",
                )

            # Assert error message and cause
            assert "timed out after" in str(exc_info.value)
            assert "TimeoutException" in str(exc_info.value)
            assert isinstance(exc_info.value.__cause__, httpx.TimeoutException)

            # Assert safe logging: provider, model, error_class, status_code present
            error_logs = [r.message for r in caplog.records if r.levelno == logging.ERROR]
            assert len(error_logs) > 0
            assert "provider=groq" in error_logs[0]
            assert "model=llama-3.3-70b-versatile" in error_logs[0]
            assert "error_class=TimeoutException" in error_logs[0]
            assert "status_code=None" in error_logs[0]

            # Zero secret / prompt leakage
            for log_msg in error_logs:
                assert "SECRET_USER_PROMPT_DO_NOT_LEAK" not in log_msg
                assert "gsk_super_secret_key_12345" not in log_msg

            # Assert limited_mode turned True
            assert llm_client.is_limited_mode() is True

    @pytest.mark.asyncio
    async def test_http_status_error_logged_without_secrets(self, caplog):
        import logging
        fake_req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        fake_resp = httpx.Response(500, request=fake_req, text='{"error": "internal_error"}')
        mock_post = AsyncMock(side_effect=httpx.HTTPStatusError("Server error", request=fake_req, response=fake_resp))

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "gsk_super_secret_key_99999"), \
             patch("httpx.AsyncClient.post", mock_post), \
             caplog.at_level(logging.ERROR, logger="atlas.agent.llm"):

            with pytest.raises(LLMError) as exc_info:
                await call_llm(
                    user_prompt="MY_CONFIDENTIAL_INPUT",
                    system_prompt="system",
                )

            assert "500" in str(exc_info.value)
            error_logs = [r.message for r in caplog.records if r.levelno == logging.ERROR]
            assert len(error_logs) > 0
            assert "provider=groq" in error_logs[0]
            assert "error_class=HTTPStatusError" in error_logs[0]
            assert "status_code=500" in error_logs[0]
            for log_msg in error_logs:
                assert "MY_CONFIDENTIAL_INPUT" not in log_msg
                assert "gsk_super_secret_key_99999" not in log_msg


# ── json_mode & Provider Structured Output ────────────────────────────────────

class TestJsonMode:
    def teardown_method(self):
        llm_client.reset_llm_health()

    @pytest.mark.asyncio
    async def test_json_mode_openai_payload(self):
        fake_response = {"choices": [{"message": {"content": "{\"status\": \"ok\"}"}}]}
        mock_post = AsyncMock()
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "test_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            await call_llm(user_prompt="return json", json_mode=True)
            payload = mock_post.call_args.kwargs.get("json", {})
            assert payload.get("response_format") == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_json_mode_off_by_default(self):
        fake_response = {"choices": [{"message": {"content": "{\"status\": \"ok\"}"}}]}
        mock_post = AsyncMock()
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama-3.3-70b-versatile"), \
             patch("app.agent.llm_client.LLM_API_KEY", "test_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            await call_llm(user_prompt="return json")
            payload = mock_post.call_args.kwargs.get("json", {})
            assert "response_format" not in payload

    @pytest.mark.asyncio
    async def test_json_mode_ollama_payload(self):
        fake_response = {"response": "{\"status\": \"ok\"}"}
        mock_post = AsyncMock()
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        with patch("app.agent.llm_client.LLM_PROVIDER", "ollama"), \
             patch("app.agent.llm_client.LLM_MODEL", "llama3"), \
             patch("httpx.AsyncClient.post", mock_post):

            await call_llm(user_prompt="return json", json_mode=True)
            payload = mock_post.call_args.kwargs.get("json", {})
            assert payload.get("format") == "json"

    @pytest.mark.asyncio
    async def test_json_mode_400_fallback_and_remembers_for_process(self):
        fake_req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        fake_resp_400 = httpx.Response(400, request=fake_req, text="response_format not supported")
        fake_resp_200 = MagicMock(status_code=200)
        fake_resp_200.json.return_value = {"choices": [{"message": {"content": "{\"result\": 1}"}}]}
        fake_resp_200.raise_for_status.return_value = None

        mock_post = AsyncMock(side_effect=[
            httpx.HTTPStatusError("400 Bad Request", request=fake_req, response=fake_resp_400),
            fake_resp_200,
        ])

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_MODEL", "unsupported-model"), \
             patch("app.agent.llm_client.LLM_API_KEY", "test_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            res = await call_llm(user_prompt="get json", json_mode=True)
            assert "{\"result\": 1}" in res
            assert mock_post.call_count == 2
            # 1st call had response_format
            first_call_payload = mock_post.call_args_list[0].kwargs.get("json", {})
            assert "response_format" in first_call_payload
            # 2nd call (retry) dropped response_format
            second_call_payload = mock_post.call_args_list[1].kwargs.get("json", {})
            assert "response_format" not in second_call_payload

            # Subsequent call in the same process must remember not to send response_format
            mock_post.reset_mock()
            mock_post.side_effect = [fake_resp_200]
            await call_llm(user_prompt="second call", json_mode=True)
            assert mock_post.call_count == 1
            third_call_payload = mock_post.call_args.kwargs.get("json", {})
            assert "response_format" not in third_call_payload


# ── Limited Mode & Health State Transitions ───────────────────────────────────

class TestLimitedModeTransitions:
    def teardown_method(self):
        llm_client.reset_llm_health()

    def test_limited_mode_initial_state(self):
        assert llm_client.is_limited_mode() is False
        info = llm_client.get_llm_health_info()
        assert info["limited_mode"] is False
        assert info["last_error_class"] is None

    @pytest.mark.asyncio
    async def test_limited_mode_turns_true_on_failure_and_false_on_success(self):
        fake_req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        fake_resp_500 = httpx.Response(500, request=fake_req, text="Internal error")

        mock_post = AsyncMock(side_effect=httpx.HTTPStatusError("500", request=fake_req, response=fake_resp_500))

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_API_KEY", "test_key"), \
             patch("httpx.AsyncClient.post", mock_post):

            with pytest.raises(LLMError):
                await call_llm("test prompt")

            # Must now be in limited mode
            assert llm_client.is_limited_mode() is True
            info = llm_client.get_llm_health_info()
            assert info["limited_mode"] is True
            assert info["last_error_class"] == "HTTPStatusError"
            assert info["last_error_time"] is not None

        # Next successful call resets limited_mode back to False
        fake_resp_200 = MagicMock(status_code=200)
        fake_resp_200.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
        fake_resp_200.raise_for_status.return_value = None
        mock_post_ok = AsyncMock(return_value=fake_resp_200)

        with patch("app.agent.llm_client.LLM_PROVIDER", "groq"), \
             patch("app.agent.llm_client.LLM_API_KEY", "test_key"), \
             patch("httpx.AsyncClient.post", mock_post_ok):

            await call_llm("successful prompt")
            assert llm_client.is_limited_mode() is False
            info = llm_client.get_llm_health_info()
            assert info["limited_mode"] is False


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

"""
Task 4 — LLM Client
Wraps the LLM API with retry logic and error handling.
Supports Ollama (local) and any OpenAI-compatible provider.
"""
import asyncio
import os

import httpx

# ── Config from .env ──────────────────────────────────────────────────────────
LLM_BASE_URL     = os.getenv("LLM_BASE_URL", "http://localhost:11434")
LLM_MODEL        = os.getenv("LLM_MODEL", "llama3")
LLM_API_KEY      = os.getenv("LLM_API_KEY", "")
MAX_RETRIES      = 2
TIMEOUT_SECONDS  = 30


class LLMError(Exception):
    """Raised when the LLM fails after all retries."""
    pass


async def call_llm(prompt: str) -> str:
    """
    Sends a prompt to the LLM and returns the raw string response.
    Retries up to 2 times on timeout. Raises LLMError on total failure.

    Uses Ollama's /api/generate endpoint by default.
    Set LLM_BASE_URL in .env to point to any OpenAI-compatible provider.
    """
    headers = {}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    payload = {
        "model":  LLM_MODEL,
        "prompt": prompt,
        "stream": False,
    }

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{LLM_BASE_URL}/api/generate",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
                return data.get("response", "").strip()

        except httpx.TimeoutException as e:
            last_error = e
            if attempt < MAX_RETRIES:
                await asyncio.sleep(1)
                continue

        except httpx.HTTPStatusError as e:
            raise LLMError(f"LLM returned HTTP {e.response.status_code}: {e.response.text[:200]}")

        except Exception as e:
            raise LLMError(f"Unexpected LLM error: {e}")

    raise LLMError(f"LLM timed out after {MAX_RETRIES} retries: {last_error}")

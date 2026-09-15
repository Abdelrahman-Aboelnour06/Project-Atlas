import os
from pathlib import Path
import httpx
import asyncio
from dotenv import load_dotenv

# Ensure .env is loaded regardless of working directory
_env_candidates = [
    Path.cwd() / ".env",
    Path.cwd() / "backend" / ".env",
    Path(__file__).resolve().parent.parent.parent / ".env",
    Path(__file__).resolve().parent.parent / ".env",
]
for _p in _env_candidates:
    if _p.is_file():
        load_dotenv(dotenv_path=_p)
        break

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "nvidia_nim").lower()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1.5")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

if LLM_PROVIDER != "ollama" and not LLM_API_KEY:
    raise RuntimeError(
        f"LLM_PROVIDER is '{LLM_PROVIDER}' but LLM_API_KEY is not set. "
        "Set LLM_API_KEY in .env, or set LLM_PROVIDER=ollama to use a local model."
    )

class LLMError(Exception):
    pass


def _reasoning_tokens(model: str) -> tuple[str, str] | None:
    """Returns (on_prompt, off_prompt) for this model family, or None if
    the model doesn't support a reasoning toggle."""
    m = model.lower()
    if "nemotron" not in m:
        return None
    if "v1.5" in m or "v1_5" in m:
        return ("/think", "/no_think")
    return ("detailed thinking on", "detailed thinking off")


async def ping_llm(timeout: float = 5.0) -> bool:
    """
    Lightweight LLM connectivity check for GET /health (Task 3/4 in the
    original stub). Lists available models instead of running a real
    generation, so polling /health doesn't burn LLM tokens or wait on a
    full completion every time something checks liveness.

    Never raises — any failure (network error, timeout, non-200, bad
    provider config) just means "unavailable".
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if LLM_PROVIDER == "ollama":
                response = await client.get(f"{LLM_BASE_URL}/api/tags")
            else:
                response = await client.get(
                    f"{LLM_BASE_URL}/models",
                    headers={"Authorization": f"Bearer {LLM_API_KEY}"},
                )
            return response.status_code == 200
    except Exception:
        return False

async def call_llm(
    user_prompt: str,
    system_prompt: str | None = None,
    reasoning: bool = False,
) -> str:
    """
    Invokes the configured AI provider (NVIDIA NIM or local Ollama) with retry logic.

    Args:
        user_prompt (str): User prompt text to send to the LLM.
        system_prompt (str | None): Optional system prompt text.
        reasoning (bool): Whether to enable reasoning/chain-of-thought for supported models.

    Returns:
        str: Raw completion or response text from the model.

    Raises:
        LLMError: If connection times out, returns HTTP errors, or unexpected failures occur.
    """
    max_retries = 2

    # Determine toggle token for supported models
    tokens = _reasoning_tokens(LLM_MODEL)
    toggle_token = (tokens[0] if reasoning else tokens[1]) if tokens else None

    # Construct system message content if toggle or system_prompt is present
    system_content: str | None = None
    if toggle_token and system_prompt:
        system_content = f"{toggle_token}\n{system_prompt}"
    elif toggle_token:
        system_content = toggle_token
    elif system_prompt:
        system_content = system_prompt

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient() as client:

                # BRANCH 1: Local Ollama
                if LLM_PROVIDER == "ollama":
                    if system_content:
                        full_prompt = f"{system_content}\n\n{user_prompt}"
                    else:
                        full_prompt = user_prompt

                    response = await client.post(
                        f"{LLM_BASE_URL}/api/generate",
                        json={"model": LLM_MODEL, "prompt": full_prompt, "stream": False},
                        timeout=30.0
                    )
                    response.raise_for_status()
                    return response.json().get("response", "")

                # BRANCH 2: NVIDIA NIM (OpenAI-Compatible)
                else:
                    headers = {
                        "Authorization": f"Bearer {LLM_API_KEY}",
                        "Accept": "application/json"
                    }

                    messages = []
                    if system_content is not None:
                        messages.append({"role": "system", "content": system_content})
                    messages.append({"role": "user", "content": user_prompt})

                    payload = {
                        "model": LLM_MODEL,
                        "messages": messages,
                        "temperature": 0.6 if reasoning else 0.0,
                        "max_tokens": 32768 if reasoning else 1024,
                    }
                    if reasoning:
                        payload["top_p"] = 0.95

                    response = await client.post(
                        f"{LLM_BASE_URL}/chat/completions",
                        headers=headers,
                        json=payload,
                        timeout=30.0
                    )
                    response.raise_for_status()
                    return response.json()["choices"][0]["message"]["content"]

        except httpx.TimeoutException:
            if attempt == max_retries:
                raise LLMError(f"LLM request timed out after {max_retries} retries.")
            await asyncio.sleep(1)

        except httpx.HTTPStatusError as e:
            raise LLMError(f"LLM HTTP error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMError(f"Unexpected LLM error: {str(e)}")
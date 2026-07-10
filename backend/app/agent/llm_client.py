import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "nvidia_nim").lower()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "meta/llama-3.1-70b-instruct")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

if LLM_PROVIDER != "ollama" and not LLM_API_KEY:
    raise RuntimeError(
        f"LLM_PROVIDER is '{LLM_PROVIDER}' but LLM_API_KEY is not set. "
        "Set LLM_API_KEY in .env, or set LLM_PROVIDER=ollama to use a local model."
    )

class LLMError(Exception):
    pass

async def call_llm(prompt: str) -> str:
    max_retries = 2
    
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient() as client:
                
                # BRANCH 1: Local Ollama
                if LLM_PROVIDER == "ollama":
                    response = await client.post(
                        f"{LLM_BASE_URL}/api/generate",
                        json={"model": LLM_MODEL, "prompt": prompt, "stream": False},
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
                    response = await client.post(
                        f"{LLM_BASE_URL}/chat/completions",
                        headers=headers,
                        json={
                            "model": LLM_MODEL,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.0,
                            "max_tokens": 1024
                        },
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
import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

# Read the env vars, defaulting to ollama if not set
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "llama3")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

class LLMError(Exception):
    pass

async def call_llm(prompt: str) -> str:
    max_retries = 2
    
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient() as client:
                
                # BRANCH 1: Ollama Native
                if LLM_PROVIDER == "ollama":
                    response = await client.post(
                        f"{LLM_BASE_URL}/api/generate",
                        json={
                            "model": LLM_MODEL, 
                            "prompt": prompt, 
                            "stream": False
                        },
                        timeout=30.0
                    )
                    response.raise_for_status()
                    return response.json().get("response", "")
                
                # BRANCH 2: OpenAI-Compatible (Groq, Together, etc.)
                else: 
                    headers = {"Authorization": f"Bearer {LLM_API_KEY}"}
                    response = await client.post(
                        f"{LLM_BASE_URL}/chat/completions",
                        headers=headers,
                        json={
                            "model": LLM_MODEL,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.0 # Keep it deterministic
                        },
                        timeout=30.0
                    )
                    response.raise_for_status()
                    return response.json()["choices"][0]["message"]["content"]
                    
        except httpx.TimeoutException:
            if attempt == max_retries:
                raise LLMError(f"LLM request timed out after {max_retries} retries.")
            await asyncio.sleep(1) # Delay before retry
            
        except httpx.HTTPStatusError as e:
            # Don't retry on 4xx/5xx errors
            raise LLMError(f"LLM HTTP error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMError(f"Unexpected LLM error: {str(e)}")
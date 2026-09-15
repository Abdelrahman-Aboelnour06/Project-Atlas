import os
from pathlib import Path
from typing import Any, Dict, List, Optional
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

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()

if LLM_PROVIDER == "groq":
    _default_base_url = "https://api.groq.com/openai/v1"
    _default_model = "llama-3.3-70b-versatile"
elif LLM_PROVIDER == "ollama":
    _default_base_url = "http://localhost:11434"
    _default_model = "llama3"
elif LLM_PROVIDER == "mock":
    _default_base_url = "mock://localhost"
    _default_model = "mock-model"
else:  # nvidia_nim or generic OpenAI-compatible
    _default_base_url = "https://integrate.api.nvidia.com/v1"
    _default_model = "nvidia/llama-3.3-nemotron-super-49b-v1.5"

LLM_BASE_URL = os.getenv("LLM_BASE_URL", _default_base_url)
LLM_MODEL = os.getenv("LLM_MODEL", _default_model)
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

# Per-Role Model Configuration (falling back to LLM_MODEL)
PLANNER_LLM_MODEL = os.getenv("PLANNER_LLM_MODEL") or LLM_MODEL
NAVIGATOR_LLM_MODEL = os.getenv("NAVIGATOR_LLM_MODEL") or LLM_MODEL
VERIFIER_LLM_MODEL = os.getenv("VERIFIER_LLM_MODEL") or LLM_MODEL

_INITIAL_LLM_PROVIDER = LLM_PROVIDER
_INITIAL_LLM_MODEL = LLM_MODEL
_INITIAL_PLANNER_MODEL = PLANNER_LLM_MODEL
_INITIAL_NAVIGATOR_MODEL = NAVIGATOR_LLM_MODEL
_INITIAL_VERIFIER_MODEL = VERIFIER_LLM_MODEL

if LLM_PROVIDER not in ("ollama", "mock") and not LLM_API_KEY:
    raise RuntimeError(
        f"LLM_PROVIDER is '{LLM_PROVIDER}' but LLM_API_KEY is not set. "
        "Set LLM_API_KEY in .env (e.g. from https://console.groq.com or https://build.nvidia.com), "
        "or set LLM_PROVIDER=ollama to use a local model, or LLM_PROVIDER=mock for deterministic testing."
    )


class LLMError(Exception):
    pass


# ── Mock LLM Provider State & Utilities ───────────────────────────────────────

_mock_canned_queue: List[str] = []
_mock_call_history: List[Dict[str, Any]] = []


def set_mock_llm_queue(responses: List[str]) -> None:
    """Queues explicit canned string responses to be returned in FIFO order by mock LLM."""
    global _mock_canned_queue
    _mock_canned_queue = list(responses)


def set_mock_llm_response(response: str) -> None:
    """Sets a single canned response (resets queue to just this response)."""
    global _mock_canned_queue
    _mock_canned_queue = [response]


def get_mock_llm_history() -> List[Dict[str, Any]]:
    """Returns the recorded history of calls handled by the mock provider."""
    return list(_mock_call_history)


def clear_mock_llm() -> None:
    """Clears both canned response queue and call history."""
    global _mock_canned_queue, _mock_call_history
    _mock_canned_queue.clear()
    _mock_call_history.clear()


def _get_current_provider() -> str:
    """Determines active provider, respecting runtime patches and environment variables."""
    global_p = globals().get("LLM_PROVIDER")
    env_p = os.getenv("LLM_PROVIDER")
    if global_p is not None and global_p != _INITIAL_LLM_PROVIDER:
        return str(global_p).lower().strip()
    if env_p is not None:
        return env_p.lower().strip()
    if global_p is not None:
        return str(global_p).lower().strip()
    return "groq"


def get_model_for_role(
    role: Optional[str] = None,
    model_override: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """
    Resolves the effective model name:
    1. Direct override parameter `model_override` or `model`
    2. Role-specific configuration (PLANNER_LLM_MODEL, NAVIGATOR_LLM_MODEL, VERIFIER_LLM_MODEL)
       from module globals (if patched) or os.environ
    3. Fallback to LLM_MODEL (module globals if patched, then os.environ, then default)
    """
    chosen = model_override if model_override is not None else model
    if chosen:
        return chosen

    if role:
        role_clean = role.upper().strip()
        role_key = f"{role_clean}_LLM_MODEL"
        env_val = os.getenv(role_key)
        global_val = globals().get(role_key)
        initial_map = {
            "PLANNER_LLM_MODEL": _INITIAL_PLANNER_MODEL,
            "NAVIGATOR_LLM_MODEL": _INITIAL_NAVIGATOR_MODEL,
            "VERIFIER_LLM_MODEL": _INITIAL_VERIFIER_MODEL,
        }
        # 1. Explicit patch in module globals (e.g. unittest.mock.patch in tests)
        if global_val is not None and global_val != initial_map.get(role_key):
            return str(global_val)
        # 2. Environment variable specifically for this role
        if env_val:
            return env_val

    # 3. Fallback to base LLM_MODEL (globals if patched, else os.environ, else default)
    base_global = globals().get("LLM_MODEL")
    if base_global is not None and base_global != _INITIAL_LLM_MODEL:
        return str(base_global)
    base_env = os.getenv("LLM_MODEL")
    if base_env:
        return base_env
    if base_global:
        return str(base_global)
    return _default_model


def _generate_deterministic_mock_response(
    user_prompt: str,
    system_prompt: Optional[str] = None,
    role: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """
    Generates deterministic, schema-accurate JSON or text responses based on prompt
    analysis and agent role without external API calls.
    """
    import json
    import re

    full_prompt = f"{system_prompt or ''}\n{user_prompt}"
    norm_role = role.lower().strip() if role else None

    def _mock_verifier() -> str:
        lower_user = user_prompt.lower()
        if any(w in lower_user for w in ("fail", "error", "timeout", "unexpected", "mismatch", "not found")):
            return json.dumps({
                "status": "goal_failed",
                "reason": "Observed state does not match expected criteria.",
                "confidence": 0.95,
                "signals_detected": ["state_mismatch"],
                "verification_method": "rules"
            })
        if any(w in lower_user for w in ("goal complete", "finish", "checkout complete", "order placed", "all steps complete")):
            return json.dumps({
                "status": "goal_complete",
                "reason": "Target goal successfully verified.",
                "confidence": 1.0,
                "signals_detected": ["url_match", "target_element_found"],
                "verification_method": "rules"
            })
        if any(w in lower_user for w in ("in progress", "continue", "not yet")):
            return json.dumps({
                "status": "in_progress",
                "reason": "Step in progress, further action required.",
                "confidence": 0.90,
                "signals_detected": ["action_acknowledged"],
                "verification_method": "rules"
            })
        return json.dumps({
            "status": "milestone_complete",
            "reason": "Observed state confirms milestone completed.",
            "confidence": 0.95,
            "signals_detected": ["dom_mutation_verified"],
            "verification_method": "rules"
        })

    def _mock_planner() -> str:
        return json.dumps({
            "milestones": [
                {
                    "id": "m-0",
                    "description": "Complete user goal on page",
                    "status": "active",
                    "success_criteria": "Target action completed successfully"
                }
            ]
        })

    def _mock_navigator() -> str:
        found_ids = re.findall(r'["\'](atlas-\d+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'(atlas-\d+)', full_prompt)
        target_id = found_ids[0] if found_ids else "atlas-001"

        lower_user = user_prompt.lower()
        is_consequential = any(w in lower_user for w in ("delete", "purchase", "buy", "order", "remove", "pay", "submit payment"))
        if is_consequential:
            return json.dumps({
                "type": "confirmation",
                "thought": "This action has real-world consequences and requires user confirmation.",
                "reply": "Are you sure you want to proceed with this action?",
                "steps": [],
                "requires_confirmation": True,
                "confirmation_prompt": "Do you want to confirm this action?",
                "confirmation_options": ["Yes, proceed", "No, cancel"],
                "pending_step": {
                    "action": "click",
                    "element_id": target_id,
                    "value": None,
                    "description": "Confirm consequential action",
                    "delay_ms": 600
                },
                "confirmation_success_message": "Action successfully completed."
            })

        return json.dumps({
            "type": "plan",
            "thought": f"Interacting with element {target_id} to satisfy user goal.",
            "reply": f"Clicking element {target_id} for you now.",
            "steps": [
                {
                    "action": "click",
                    "element_id": target_id,
                    "value": None,
                    "description": f"Click element {target_id}",
                    "delay_ms": 600
                }
            ],
            "requires_confirmation": False,
            "confirmation_prompt": None,
            "confirmation_options": ["Yes, proceed", "No, cancel"],
            "pending_step": None,
            "confirmation_success_message": "Done! Action completed."
        })

    def _mock_simplify() -> str:
        found_ids = re.findall(r'["\'](atlas-\d+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'(atlas-\d+)', full_prompt)
        elements = [{"element_id": eid, "label": f"Control {eid}", "category": "button"} for eid in (found_ids[:5] if found_ids else ["atlas-001"])]
        return json.dumps(elements)

    def _mock_command() -> str:
        found_ids = re.findall(r'["\'](atlas-\d+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'(atlas-\d+)', full_prompt)
        target_id = found_ids[0] if found_ids else "atlas-001"
        return json.dumps({
            "action": "click",
            "element_id": target_id,
            "value": None,
            "message": f"Clicked {target_id}"
        })

    # 1. Explicit Role Routing (Strict Precedence)
    if norm_role in ("verifier",):
        return _mock_verifier()
    elif norm_role in ("planner",):
        return _mock_planner()
    elif norm_role in ("navigator", "navigation"):
        return _mock_navigator()
    elif norm_role in ("simplify", "simplifier"):
        return _mock_simplify()
    elif norm_role in ("command", "action", "parser"):
        return _mock_command()
    elif norm_role in ("summary", "summarizer"):
        return "This is a summary of the webpage. You can browse items or perform actions."

    # 2. Heuristic Prompt Fallback (ONLY when norm_role is None or unrecognized above)
    if "VERIFIER" in full_prompt or "signals_detected" in full_prompt or "post-action" in full_prompt.lower():
        return _mock_verifier()
    elif "milestone" in full_prompt.lower():
        return _mock_planner()
    elif "AUTHENTIC USER COMMAND" in full_prompt or '"steps"' in full_prompt or "agentic" in full_prompt.lower():
        return _mock_navigator()
    elif "INTERACTIVE ELEMENTS" in full_prompt or "simplify" in full_prompt.lower():
        return _mock_simplify()
    elif "ACTION TYPES:" in full_prompt:
        return _mock_command()
    elif "summary" in full_prompt.lower():
        return "This is a summary of the webpage. You can browse items or perform actions."

    # 3. Default fallback
    return "I am Atlas, your universal accessibility web assistant. How can I help you navigate this page?"


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
    Lightweight LLM connectivity check for GET /health.
    For LLM_PROVIDER=mock, returns True immediately with zero network requests.
    Never raises — any failure just means 'unavailable'.
    """
    provider = _get_current_provider()
    if provider == "mock":
        return True

    base_url = globals().get("LLM_BASE_URL") or os.getenv("LLM_BASE_URL", _default_base_url)
    api_key = globals().get("LLM_API_KEY") or os.getenv("LLM_API_KEY", "")

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "ollama":
                response = await client.get(f"{base_url}/api/tags")
            else:
                response = await client.get(
                    f"{base_url}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            return response.status_code == 200
    except Exception:
        return False


async def call_llm(
    user_prompt: str,
    system_prompt: Optional[str] = None,
    reasoning: bool = False,
    role: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """
    Invokes the configured AI provider (Mock, NVIDIA NIM, OpenAI-compatible, Groq, or Ollama) with retry logic.

    Args:
        user_prompt (str): User prompt text to send to the LLM.
        system_prompt (str | None): Optional system prompt text.
        reasoning (bool): Whether to enable reasoning/chain-of-thought for supported models.
        role (str | None): Agent role ('planner', 'navigator', 'verifier', 'simplify', etc.).
        model (str | None): Optional model override.

    Returns:
        str: Raw completion or response text from the model.

    Raises:
        LLMError: If connection times out, returns HTTP errors, or unexpected failures occur.
    """
    provider = _get_current_provider()
    effective_model = get_model_for_role(role=role, model_override=model)

    # BRANCH 0: Deterministic Mock Provider
    if provider == "mock":
        call_record = {
            "user_prompt": user_prompt,
            "system_prompt": system_prompt,
            "reasoning": reasoning,
            "role": role,
            "model": effective_model,
        }
        _mock_call_history.append(call_record)

        if _mock_canned_queue:
            return _mock_canned_queue.pop(0)

        return _generate_deterministic_mock_response(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            role=role,
            model=effective_model,
        )

    base_url = globals().get("LLM_BASE_URL") or os.getenv("LLM_BASE_URL", _default_base_url)
    api_key = globals().get("LLM_API_KEY") or os.getenv("LLM_API_KEY", "")

    max_retries = 2

    # Determine toggle token for supported models
    tokens = _reasoning_tokens(effective_model)
    toggle_token = (tokens[0] if reasoning else tokens[1]) if tokens else None

    # Construct system message content if toggle or system_prompt is present
    system_content: Optional[str] = None
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
                if provider == "ollama":
                    if system_content:
                        full_prompt = f"{system_content}\n\n{user_prompt}"
                    else:
                        full_prompt = user_prompt

                    response = await client.post(
                        f"{base_url}/api/generate",
                        json={"model": effective_model, "prompt": full_prompt, "stream": False},
                        timeout=30.0,
                    )
                    response.raise_for_status()
                    return response.json().get("response", "")

                # BRANCH 2: NVIDIA NIM / OpenAI-Compatible (including Groq)
                else:
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                    }

                    messages = []
                    if system_content is not None:
                        messages.append({"role": "system", "content": system_content})
                    messages.append({"role": "user", "content": user_prompt})

                    payload = {
                        "model": effective_model,
                        "messages": messages,
                        "temperature": 0.6 if reasoning else 0.0,
                        "max_tokens": 32768 if (reasoning and tokens) else (4096 if reasoning else 1024),
                    }
                    if reasoning and tokens:
                        payload["top_p"] = 0.95

                    response = await client.post(
                        f"{base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                        timeout=30.0,
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
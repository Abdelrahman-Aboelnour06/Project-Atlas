import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
import httpx
import asyncio
from dotenv import load_dotenv

logger = logging.getLogger("atlas.agent.llm")

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
VERIFIER_ALT_LLM_MODEL = os.getenv("VERIFIER_ALT_LLM_MODEL") or os.getenv("VERIFIER_LLM_MODEL") or LLM_MODEL

_INITIAL_LLM_PROVIDER = LLM_PROVIDER
_INITIAL_LLM_MODEL = LLM_MODEL
_INITIAL_PLANNER_MODEL = PLANNER_LLM_MODEL
_INITIAL_NAVIGATOR_MODEL = NAVIGATOR_LLM_MODEL
_INITIAL_VERIFIER_MODEL = VERIFIER_LLM_MODEL
_INITIAL_VERIFIER_ALT_MODEL = VERIFIER_ALT_LLM_MODEL

if LLM_PROVIDER not in ("ollama", "mock") and not LLM_API_KEY:
    raise RuntimeError(
        f"LLM_PROVIDER is '{LLM_PROVIDER}' but LLM_API_KEY is not set. "
        "Set LLM_API_KEY in .env (e.g. from https://console.groq.com or https://build.nvidia.com), "
        "or set LLM_PROVIDER=ollama to use a local model, or LLM_PROVIDER=mock for deterministic testing."
    )


class LLMError(Exception):
    pass


class LLMRateLimited(LLMError):
    """Raised when an LLM provider returns HTTP 429 Too Many Requests."""
    def __init__(self, message: str, retry_after: float = 2.0, model: Optional[str] = None):
        super().__init__(message)
        self.retry_after = retry_after
        self.model = model


# ── Health, Diagnostic Logging & Failure Tracking ────────────────────────────

_last_error_class: Optional[str] = None
_last_error_time: Optional[str] = None
_limited_mode: bool = False
_last_model_used: Optional[str] = None
_json_mode_unsupported: Set[str] = set()


def record_llm_failure(
    provider: str,
    model: Optional[str],
    exc: Exception,
    status_code: Optional[int] = None,
) -> None:
    """
    Records an LLM failure without logging or storing any prompts, URLs, headers, or API keys.
    Updates the operational health state and marks limited_mode as True.
    """
    global _last_error_class, _last_error_time, _limited_mode, _last_model_used
    exc_class = exc.__class__.__name__
    _last_error_class = exc_class
    _last_error_time = datetime.now(timezone.utc).isoformat()
    _limited_mode = True
    if model:
        _last_model_used = model

    # Strictly log only provider, model, error class, and status code (no secrets/prompts)
    logger.error(
        "LLM call failed: provider=%s, model=%s, error_class=%s, status_code=%s",
        provider,
        model,
        exc_class,
        status_code,
    )


def record_llm_success(provider: str, model: Optional[str]) -> None:
    """Records an LLM call success, resetting limited_mode back to False."""
    global _limited_mode, _last_model_used
    _limited_mode = False
    if model:
        _last_model_used = model


def is_limited_mode() -> bool:
    """Returns True if the LLM client is operating in degraded/limited mode due to a recent failure."""
    return _limited_mode


def set_limited_mode(enabled: bool) -> None:
    """Manually toggles limited_mode (used in testing or explicit admin control)."""
    global _limited_mode
    _limited_mode = bool(enabled)


def get_llm_health_info() -> Dict[str, Any]:
    """Returns sanitised health status info for the GET /health probe."""
    return {
        "provider": _get_current_provider(),
        "model": _last_model_used or get_model_for_role(),
        "last_error_class": _last_error_class,
        "last_error_time": _last_error_time,
        "limited_mode": _limited_mode,
    }


def reset_llm_health() -> None:
    """Resets all health tracking variables (for deterministic test isolation)."""
    global _last_error_class, _last_error_time, _limited_mode, _last_model_used, _json_mode_unsupported
    _last_error_class = None
    _last_error_time = None
    _limited_mode = False
    _last_model_used = None
    _json_mode_unsupported.clear()


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
            "VERIFIER_ALT_LLM_MODEL": _INITIAL_VERIFIER_ALT_MODEL,
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
        goal_match = re.search(r'USER GOAL TO DECOMPOSE:\s*["\']?([^"\'\n]+)', user_prompt, re.I)
        goal_text = goal_match.group(1).strip() if goal_match else "Complete user goal on page"
        return json.dumps({
            "milestones": [
                {
                    "id": "m-0",
                    "description": goal_text,
                    "status": "active",
                    "is_final": True,
                    "branch_id": "b-0",
                    "success_criteria": "Target action completed successfully"
                }
            ]
        })

    def _mock_scout() -> str:
        lower_user = user_prompt.lower()
        cleaned_user = re.sub(r"boundary_id:\s*[0-9a-f]+", "", lower_user)
        cleaned_user = re.sub(r"--- (?:begin|end) [^-\n]+ ---", "", cleaned_user)
        detected_lang = "ar" if re.search(r"[\u0600-\u06FF]", user_prompt) else "en"
        if any(w in cleaned_user for w in ("captcha", "robot", "human verification", "recaptcha", "hcaptcha", "turnstile")):
            return json.dumps({
                "page_kind": "captcha",
                "blockers": ["captcha"],
                "form_inventory": [],
                "primary_cta": None,
                "summary": "CAPTCHA challenge page",
                "detected_language": detected_lang,
            })
        if any(re.search(rf"\b{re.escape(w)}\b", cleaned_user) for w in ("two_factor_code", "verification code", "two-factor", "2fa", "security code", "otp")):
            return json.dumps({
                "page_kind": "form",
                "blockers": ["otp"],
                "form_inventory": ["verify-form"],
                "primary_cta": "verify-btn",
                "summary": "OTP verification page",
                "detected_language": detected_lang,
            })
        has_form_input = len(re.findall(r'"tag":\s*"(input|select|textarea)"', lower_user)) >= 2
        if has_form_input:
            found_forms = re.findall(r'["\']form_id["\']:\s*["\']([^"\']+)["\']', user_prompt)
            form_inv = [f for f in list(dict.fromkeys(found_forms)) if f and f.lower() != "null"]
            if not form_inv:
                form_inv = ["main-form"]
            found_ids = re.findall(r'["\']id["\']:\s*["\']([^"\']+)["\']', user_prompt)
            btn_ids = [i for i in found_ids if any(b in i.lower() for b in ("btn", "button", "submit", "send"))]
            cta = btn_ids[-1] if btn_ids else (found_ids[-1] if found_ids else "submit-btn")
            return json.dumps({
                "page_kind": "form",
                "blockers": [],
                "form_inventory": form_inv,
                "primary_cta": cta,
                "summary": "Interactive form page",
                "detected_language": detected_lang,
            })
        return json.dumps({
            "page_kind": "other",
            "blockers": [],
            "form_inventory": [],
            "primary_cta": None,
            "summary": "Standard web page",
            "detected_language": detected_lang,
        })

    def _mock_form_filler() -> str:
        found_refs = re.findall(r'["\']ref["\']:\s*["\']([^"\']+)["\']', user_prompt)
        if not found_refs:
            found_refs = re.findall(r'["\']id["\']:\s*["\']([^"\']+)["\']', user_prompt)
        fields = []
        submit_ref = None
        for r in found_refs:
            r_lower = r.lower()
            if any(b in r_lower for b in ("submit", "btn", "button", "send")):
                submit_ref = r
                continue
            val = "{password}" if any(p in r_lower for p in ("pass", "pwd", "secret")) else ("{profile.email}" if "email" in r_lower else ("{profile.full_name}" if any(n in r_lower for n in ("name", "user")) else "John Doe"))
            src = "vault" if "{password}" in val else ("profile" if "{profile." in val else "user")
            fields.append({
                "ref": r,
                "action": "fill",
                "value": val,
                "source": src,
                "confidence": 1.0,
                "rationale": "Automated form fill"
            })
        if not submit_ref and found_refs:
            for r in reversed(found_refs):
                if any(b in r.lower() for b in ("submit", "btn", "button", "send")):
                    submit_ref = r
                    break
        return json.dumps({
            "form_id": "main-form",
            "fields": fields,
            "submit_ref": submit_ref,
            "missing_required": [],
            "blockers": []
        })

    def _mock_navigator() -> str:
        found_ids = re.findall(r'["\']id["\']:\s*["\']([^"\']+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'["\']ref["\']:\s*["\']([^"\']+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'["\'](atlas-[^"\']+)["\']', full_prompt)
        if not found_ids:
            found_ids = re.findall(r'(atlas-\d+)', full_prompt)

        target_id = found_ids[0] if found_ids else "atlas-001"
        lower_user = user_prompt.lower()
        for eid in found_ids:
            eid_clean = eid.lower().replace("atlas-", "").replace("ref_", "").replace("-", " ").replace("_", " ")
            words = [w for w in eid_clean.split() if len(w) > 2]
            if any(w in lower_user for w in words):
                target_id = eid
                break

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

    def _mock_repair() -> str:
        target = user_prompt
        if "Malformed Content to Repair:" in target:
            target = target.split("Malformed Content to Repair:", 1)[1]
        if "Return ONLY the fixed, valid JSON:" in target:
            target = target.split("Return ONLY the fixed, valid JSON:", 1)[0]
        target = target.strip()
        if "```" in target:
            target = re.sub(r"```(?:json)?|```", "", target).strip()
        repaired = re.sub(r"'([^']*)'", r'"\1"', target)
        repaired = re.sub(r",\s*([\]}])", r"\1", repaired)
        try:
            json.loads(repaired)
            return repaired
        except Exception:
            return json.dumps({"status": "repaired", "repaired": True})

    # 1. Explicit Role Routing (Strict Precedence)
    if norm_role in ("verifier",):
        return _mock_verifier()
    elif norm_role in ("planner",):
        return _mock_planner()
    elif norm_role in ("scout",):
        return _mock_scout()
    elif norm_role in ("form_filler", "formfiller", "form"):
        return _mock_form_filler()
    elif norm_role in ("navigator", "navigation"):
        return _mock_navigator()
    elif norm_role in ("simplify", "simplifier"):
        return _mock_simplify()
    elif norm_role in ("command", "action", "parser"):
        return _mock_command()
    elif norm_role in ("repair", "repair_json", "json_repair"):
        return _mock_repair()
    elif norm_role in ("summary", "summarizer"):
        return "This is a summary of the webpage. You can browse items or perform actions."

    # 2. Heuristic Prompt Fallback (ONLY when norm_role is None or unrecognized above)
    if "VERIFIER" in full_prompt or "signals_detected" in full_prompt or "post-action" in full_prompt.lower():
        return _mock_verifier()
    elif "SCOUT" in full_prompt or "page_kind" in full_prompt:
        return _mock_scout()
    elif "FORM_FILLER" in full_prompt or "submit_ref" in full_prompt:
        return _mock_form_filler()
    elif "milestone" in full_prompt.lower():
        return _mock_planner()
    elif "AUTHENTIC USER COMMAND" in full_prompt or '"steps"' in full_prompt or "agentic" in full_prompt.lower():
        return _mock_navigator()
    elif "INTERACTIVE ELEMENTS" in full_prompt or "simplify" in full_prompt.lower():
        return _mock_simplify()
    elif "ACTION TYPES:" in full_prompt:
        return _mock_command()
    elif "json repair" in full_prompt.lower() or "malformed content to repair" in full_prompt.lower():
        return _mock_repair()
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
            if response.status_code == 200:
                record_llm_success(provider, None)
                return True
            else:
                record_llm_failure(provider, None, httpx.HTTPStatusError("ping failed", request=response.request, response=response), status_code=response.status_code)
                return False
    except Exception as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        record_llm_failure(provider, None, e, status_code=status_code)
        return False


async def call_llm(
    user_prompt: str,
    system_prompt: Optional[str] = None,
    reasoning: bool = False,
    role: Optional[str] = None,
    model: Optional[str] = None,
    max_tokens: Optional[int] = None,
    json_mode: bool = False,
) -> str:
    """
    Invokes the configured AI provider (Mock, NVIDIA NIM, OpenAI-compatible, Groq, or Ollama) with retry logic.

    Args:
        user_prompt (str): User prompt text to send to the LLM.
        system_prompt (str | None): Optional system prompt text.
        reasoning (bool): Whether to enable reasoning/chain-of-thought for supported models.
        role (str | None): Agent role ('planner', 'navigator', 'verifier', 'simplify', etc.).
        model (str | None): Optional model override.
        max_tokens (int | None): Optional max_tokens override.
        json_mode (bool): Whether to request structured JSON output from supported providers.

    Returns:
        str: Raw completion or response text from the model.

    Raises:
        LLMError: If connection times out, returns HTTP errors, or unexpected failures occur.
    """
    provider = _get_current_provider()
    effective_model = get_model_for_role(role=role, model_override=model)

    if _mock_canned_queue:
        call_record = {
            "user_prompt": user_prompt,
            "system_prompt": system_prompt,
            "reasoning": reasoning,
            "role": role,
            "model": effective_model,
            "json_mode": json_mode,
        }
        _mock_call_history.append(call_record)
        record_llm_success("mock", effective_model)
        return _mock_canned_queue.pop(0)

    # BRANCH 0: Deterministic Mock Provider
    if provider == "mock":
        call_record = {
            "user_prompt": user_prompt,
            "system_prompt": system_prompt,
            "reasoning": reasoning,
            "role": role,
            "model": effective_model,
            "json_mode": json_mode,
        }
        _mock_call_history.append(call_record)
        record_llm_success("mock", effective_model)

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

    unsupported_key = f"{provider}:{effective_model}"
    active_json_mode = json_mode and (unsupported_key not in _json_mode_unsupported)

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient() as client:

                # BRANCH 1: Local Ollama
                if provider == "ollama":
                    if system_content:
                        full_prompt = f"{system_content}\n\n{user_prompt}"
                    else:
                        full_prompt = user_prompt

                    ollama_payload: Dict[str, Any] = {
                        "model": effective_model,
                        "prompt": full_prompt,
                        "stream": False,
                    }
                    if active_json_mode:
                        ollama_payload["format"] = "json"

                    response = await client.post(
                        f"{base_url}/api/generate",
                        json=ollama_payload,
                        timeout=30.0,
                    )
                    response.raise_for_status()
                    record_llm_success(provider, effective_model)
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

                    effective_max_tokens = max_tokens if max_tokens is not None else (
                        32768 if (reasoning and tokens) else (4096 if reasoning else 1024)
                    )

                    payload = {
                        "model": effective_model,
                        "messages": messages,
                        "temperature": 0.6 if reasoning else 0.0,
                        "max_tokens": effective_max_tokens,
                    }
                    if reasoning and tokens:
                        payload["top_p"] = 0.95
                    if active_json_mode:
                        payload["response_format"] = {"type": "json_object"}

                    response = await client.post(
                        f"{base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                        timeout=30.0,
                    )
                    response.raise_for_status()
                    record_llm_success(provider, effective_model)
                    return response.json()["choices"][0]["message"]["content"]

        except httpx.TimeoutException as e:
            record_llm_failure(provider, effective_model, e, status_code=None)
            if attempt == max_retries:
                raise LLMError(f"LLM request timed out after {max_retries} retries: {e.__class__.__name__}") from e
            await asyncio.sleep(1)

        except httpx.HTTPStatusError as e:
            # Handle HTTP 400 when json_mode was rejected by the provider
            if e.response.status_code == 400 and active_json_mode:
                logger.warning(
                    "Provider %s model %s returned HTTP 400 with json_mode. Remembering and retrying without json_mode.",
                    provider,
                    effective_model,
                )
                _json_mode_unsupported.add(unsupported_key)
                active_json_mode = False
                continue

            if e.response.status_code == 429:
                retry_wait = None
                retry_after_val = 2.0
                try:
                    import re
                    m = re.search(r"try again in ([\d\.]+)s", e.response.text)
                    if m:
                        retry_after_val = float(m.group(1))
                    ra = e.response.headers.get("retry-after") or e.response.headers.get("x-ratelimit-reset-requests")
                    if ra:
                        retry_after_val = float(ra)
                    if retry_after_val <= 6.0 and attempt < max_retries:
                        retry_wait = retry_after_val + 0.2
                except Exception:
                    pass

                if retry_wait is not None:
                    logger.info("LLM rate limited (429). Retrying after %.2fs backoff (attempt %d/%d)...", retry_wait, attempt + 1, max_retries)
                    await asyncio.sleep(retry_wait)
                    continue

                # Auto-fallback to secondary lighter model on Groq when primary model hits rate limit
                if provider == "groq" and effective_model != "openai/gpt-oss-20b" and attempt < max_retries:
                    logger.info("Primary Groq model %s rate limited. Falling back to openai/gpt-oss-20b...", effective_model)
                    effective_model = "openai/gpt-oss-20b"
                    continue

                record_llm_failure(provider, effective_model, e, status_code=429)
                raise LLMRateLimited(
                    f"LLM rate limit (429): {e.response.text}",
                    retry_after=retry_after_val,
                    model=effective_model,
                )

            record_llm_failure(provider, effective_model, e, status_code=e.response.status_code)
            raise LLMError(f"LLM HTTP error: {e.response.status_code} - {e.response.text}") from e

        except LLMError:
            raise

        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            record_llm_failure(provider, effective_model, e, status_code=status_code)
            raise LLMError(f"Unexpected LLM error: {str(e)}") from e


async def repair_json(
    raw: str,
    schema_hint: Optional[str] = None,
    role: Optional[str] = "repair",
    model: Optional[str] = None,
) -> str:
    """
    Attempts to repair broken or malformed JSON output from an LLM.
    Runs only on a parse failure, never on timeouts/HTTP errors, and at most once.

    Args:
        raw: Raw or malformed string from a prior LLM call.
        schema_hint: Optional description or schema of expected JSON structure.
        role: Optional role name for role-based routing (defaults to 'repair').
        model: Optional model override.

    Returns:
        Repaired valid JSON string parseable by json.loads.

    Raises:
        LLMError: If repair retry fails or returns non-JSON.
    """
    import json
    from app.agent.json_utils import extract_json

    # Step 1: Check if already parseable
    cleaned = extract_json(raw)
    try:
        json.loads(cleaned)
        return cleaned
    except Exception:
        pass

    # Step 2: At most one retry asking the model to return valid JSON
    system_prompt = (
        "You are a strict JSON repair utility. Fix all syntax errors (such as trailing commas, "
        "missing quotes, single quotes, unescaped characters, or malformed braces) and return ONLY "
        "the valid JSON object or array. Do NOT output markdown code fences, reasoning blocks, or conversational prose."
    )
    if schema_hint:
        user_prompt = (
            f"Expected Schema / Format:\n{schema_hint}\n\n"
            f"Malformed Content to Repair:\n{raw}\n\n"
            "Return ONLY the fixed, valid JSON:"
        )
    else:
        user_prompt = (
            f"Malformed Content to Repair:\n{raw}\n\n"
            "Return ONLY the fixed, valid JSON:"
        )

    # Call LLM once with json_mode=True. Any timeout/401/403/5xx raises LLMError directly.
    repaired_raw = await call_llm(
        user_prompt=user_prompt,
        system_prompt=system_prompt,
        reasoning=False,
        role=role,
        model=model,
        json_mode=True,
    )

    repaired_clean = extract_json(repaired_raw)
    try:
        json.loads(repaired_clean)
        return repaired_clean
    except Exception as e:
        raise LLMError("Failed to repair malformed JSON into valid JSON.") from e

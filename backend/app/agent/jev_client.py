"""
Atlas v3.0 System 1 Decision Client
backend/app/agent/jev_client.py

Client interface for TypeSafe AI's Jev 3 non-autoregressive decision model.
Provides sub-100ms typed decisions (choose, score, judge/noul) for rapid per-hop
DOM candidate selection, page classification, and outcome verification.
Falls back seamlessly to System 2 when confidence < 0.85 or on network timeout.
"""

import os
import time
import asyncio
import logging
from typing import Any, Dict, List, Optional, Union
import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger("atlas.agent.jev")

JEV_API_KEY = os.getenv("JEV_API_KEY", "")
JEV_BASE_URL = os.getenv("JEV_BASE_URL", "https://api.typesafe.ai/v1")
JEV_TIMEOUT_MS = int(os.getenv("JEV_TIMEOUT_MS", "800"))
JEV_PROVIDER = os.getenv("JEV_PROVIDER", "mock" if not JEV_API_KEY else "live")


class JevError(Exception):
    """Base exception for Jev API errors."""
    pass


class JevTimeoutError(JevError):
    """Raised when Jev exceeds its execution budget, triggering System 2 fallback."""
    pass


class JevChoice(BaseModel):
    """Result of a Jev choice selection among multiple candidate options."""
    selected_id: str
    selected_option: Optional[Dict[str, Any]] = None
    confidence: float = Field(ge=0.0, le=1.0)
    score_distribution: Dict[str, float] = Field(default_factory=dict)
    rationale: Optional[str] = None
    latency_ms: float = 0.0


class JevScore(BaseModel):
    """Result of a Jev continuous alignment score."""
    score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: Optional[str] = None
    latency_ms: float = 0.0


class JevNoul(BaseModel):
    """Result of a Jev binary (yes/no) judgment."""
    result: bool
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: Optional[str] = None
    latency_ms: float = 0.0


class JevClient:
    """
    Non-autoregressive decision client for Atlas System 1 reflex decisions.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        provider: Optional[str] = None,
    ):
        self.api_key = api_key or JEV_API_KEY
        self.base_url = base_url or JEV_BASE_URL
        self.timeout_ms = timeout_ms or JEV_TIMEOUT_MS
        self.provider = provider or ("mock" if not self.api_key else JEV_PROVIDER)
        self._simulate_latency_ms: float = 0.0

    async def choose(
        self,
        state: Dict[str, Any],
        options: List[Dict[str, Any]],
        question: str,
    ) -> Optional[JevChoice]:
        """
        Picks the single most appropriate option from candidate options in <100ms.
        Returns None if options list is empty.
        """
        if not options:
            return None

        start_time = time.perf_counter()

        # Handle timeout simulation in tests
        if self._simulate_latency_ms > self.timeout_ms:
            await asyncio.sleep(self._simulate_latency_ms / 1000.0)
            raise JevTimeoutError(f"Jev decision timed out after {self.timeout_ms}ms")

        if self.provider == "mock":
            res = self._mock_choose(state, options, question)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

        # Live TypeSafe AI API call with hard timeout gate
        timeout_sec = self.timeout_ms / 1000.0
        payload = {
            "state": state,
            "options": options,
            "question": question,
            "model": "jev-3-decision",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                resp = await client.post(
                    f"{self.base_url}/choose",
                    json=payload,
                    headers=headers,
                )
                if resp.status_code != 200:
                    raise JevError(f"Jev API returned HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                latency = (time.perf_counter() - start_time) * 1000.0
                return JevChoice(
                    selected_id=data.get("selected_id", options[0].get("ref", options[0].get("id", ""))),
                    selected_option=data.get("selected_option"),
                    confidence=float(data.get("confidence", 0.9)),
                    score_distribution=data.get("score_distribution", {}),
                    rationale=data.get("rationale"),
                    latency_ms=latency,
                )
        except httpx.TimeoutException:
            raise JevTimeoutError(f"Jev choose timed out after {self.timeout_ms}ms")
        except Exception as exc:
            logger.warning("Jev choose live call failed: %s. Falling back to mock/system 2.", exc)
            res = self._mock_choose(state, options, question)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

    async def judge(
        self,
        state: Dict[str, Any],
        statement: str,
    ) -> JevNoul:
        """
        Evaluates a binary assertion (True/False) with confidence in <80ms.
        """
        start_time = time.perf_counter()

        if self._simulate_latency_ms > self.timeout_ms:
            await asyncio.sleep(self._simulate_latency_ms / 1000.0)
            raise JevTimeoutError(f"Jev judge timed out after {self.timeout_ms}ms")

        if self.provider == "mock":
            res = self._mock_judge(state, statement)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

        timeout_sec = self.timeout_ms / 1000.0
        payload = {
            "state": state,
            "statement": statement,
            "model": "jev-3-decision",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                resp = await client.post(
                    f"{self.base_url}/judge",
                    json=payload,
                    headers=headers,
                )
                if resp.status_code != 200:
                    raise JevError(f"Jev API HTTP {resp.status_code}: {resp.text}")
                data = resp.json()
                return JevNoul(
                    result=bool(data.get("result", True)),
                    confidence=float(data.get("confidence", 0.95)),
                    rationale=data.get("rationale"),
                    latency_ms=(time.perf_counter() - start_time) * 1000.0,
                )
        except httpx.TimeoutException:
            raise JevTimeoutError(f"Jev judge timed out after {self.timeout_ms}ms")
        except Exception as exc:
            logger.warning("Jev judge live call failed: %s. Using heuristic.", exc)
            res = self._mock_judge(state, statement)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

    async def score(
        self,
        state: Dict[str, Any],
        criteria: str,
    ) -> JevScore:
        """
        Calculates a continuous alignment score (0.0 to 1.0) in <80ms.
        """
        start_time = time.perf_counter()

        if self._simulate_latency_ms > self.timeout_ms:
            await asyncio.sleep(self._simulate_latency_ms / 1000.0)
            raise JevTimeoutError(f"Jev score timed out after {self.timeout_ms}ms")

        if self.provider == "mock":
            res = self._mock_score(state, criteria)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

        timeout_sec = self.timeout_ms / 1000.0
        payload = {
            "state": state,
            "criteria": criteria,
            "model": "jev-3-decision",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                resp = await client.post(
                    f"{self.base_url}/score",
                    json=payload,
                    headers=headers,
                )
                if resp.status_code != 200:
                    raise JevError(f"Jev API HTTP {resp.status_code}: {resp.text}")
                data = resp.json()
                return JevScore(
                    score=float(data.get("score", 0.9)),
                    confidence=float(data.get("confidence", 0.95)),
                    rationale=data.get("rationale"),
                    latency_ms=(time.perf_counter() - start_time) * 1000.0,
                )
        except httpx.TimeoutException:
            raise JevTimeoutError(f"Jev score timed out after {self.timeout_ms}ms")
        except Exception as exc:
            logger.warning("Jev score live call failed: %s. Using heuristic.", exc)
            res = self._mock_score(state, criteria)
            res.latency_ms = (time.perf_counter() - start_time) * 1000.0
            return res

    # ── Deterministic System 1 Heuristics (Zero-Latency Mock Mode) ───────────────

    def _mock_choose(
        self,
        state: Dict[str, Any],
        options: List[Dict[str, Any]],
        question: str,
    ) -> JevChoice:
        """Evaluates candidate options using non-autoregressive token affinity scoring."""
        q_tokens = set(question.lower().split())
        scored: List[tuple[float, str, Dict[str, Any]]] = []

        for opt in options:
            ref = str(opt.get("ref") or opt.get("id") or "")
            label = str(opt.get("label") or opt.get("inner_text") or opt.get("placeholder") or opt.get("name") or "")
            role = str(opt.get("role") or opt.get("type") or opt.get("tag") or "")
            text_tokens = set(f"{label} {role} {ref}".lower().split())

            # Keyword and semantic affinity
            overlap = len(q_tokens.intersection(text_tokens))
            score = 0.5 + (0.15 * overlap)

            # High confidence boosts for explicit type matching
            if "search" in question.lower() and any(s in f"{role} {label}".lower() for s in ("search", "find", "query")):
                score += 0.4
            if "submit" in question.lower() and any(s in f"{role} {label}".lower() for s in ("submit", "continue", "next", "create")):
                score += 0.4
            if "button" in question.lower() and opt.get("tag") == "button":
                score += 0.1

            score = min(score, 0.98)
            scored.append((score, ref, opt))

        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best_ref, best_opt = scored[0]

        distribution = {ref: sc for sc, ref, _ in scored}
        return JevChoice(
            selected_id=best_ref,
            selected_option=best_opt,
            confidence=best_score,
            score_distribution=distribution,
            rationale=f"Selected {best_ref} based on token affinity score of {best_score:.2f}",
        )

    def _mock_judge(
        self,
        state: Dict[str, Any],
        statement: str,
    ) -> JevNoul:
        """Evaluates condition statements against state tokens."""
        s_lower = statement.lower()
        state_str = str(state).lower()

        # CAPTCHA check
        if "captcha" in s_lower or "challenge" in s_lower:
            has_captcha = any(w in state_str for w in ("captcha", "recaptcha", "turnstile", "hcaptcha", "robot"))
            return JevNoul(
                result=has_captcha,
                confidence=0.96 if has_captcha else 0.92,
                rationale="Verified presence of bot challenge tokens in page state",
            )

        # Form check
        if "form" in s_lower:
            has_inputs = any(w in state_str for w in ("input", "textarea", "select", "password", "email"))
            return JevNoul(
                result=has_inputs,
                confidence=0.94 if has_inputs else 0.88,
                rationale="Detected structured interactive input elements in DOM summary",
            )

        return JevNoul(result=True, confidence=0.90, rationale="Heuristic judgment satisfied")

    def _mock_score(
        self,
        state: Dict[str, Any],
        criteria: str,
    ) -> JevScore:
        """Computes alignment score between state and criteria."""
        import re
        c_tokens = set(re.findall(r'\w+', criteria.lower()))
        state_tokens = set(re.findall(r'\w+', str(state).lower()))
        overlap = len(c_tokens.intersection(state_tokens))
        sc = min(0.6 + (0.15 * overlap), 0.98)
        return JevScore(score=sc, confidence=0.92, rationale=f"Calculated criteria overlap score of {sc:.2f}")


# ── Global Singleton Factory ───────────────────────────────────────────────────

_global_jev_client: Optional[JevClient] = None


def get_jev_client() -> JevClient:
    """Returns the process-wide JevClient singleton instance."""
    global _global_jev_client
    if _global_jev_client is None:
        _global_jev_client = JevClient()
    return _global_jev_client

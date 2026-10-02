"""
Concurrency Stress Tests for AgentScheduler and Invariants
backend/tests/test_scheduler_concurrency.py
Adheres strictly to §8.7, §8.8, and §13.6 of atlas-v2-architecture.md.
"""

import asyncio
import time
import pytest
from typing import Any, Optional

from app.agent.llm_client import LLMRateLimited
from app.agent.scheduler import (
    AgentScheduler,
    Priority,
    GoalTrace,
    run_speculative_turn,
    try_consume,
)
from app.models.goal import Budget, GoalState, PlanStep, VerifierResult, AgenticPlan


class FakeLLM:
    """Mock provider with programmable latency, cancellation tracking, and synthetic 429s."""

    def __init__(self):
        self._delays: dict[str, float] = {}
        self._responses: dict[str, Any] = {}
        self._rate_limits: dict[str, dict] = {}
        self._requests: dict[str, int] = {}
        self._cancelled: dict[str, bool] = {}

    def delay(self, role: str, seconds: float):
        self._delays[role] = seconds
        return self

    def respond(self, role: str, response: Any):
        self._responses[role] = response
        return self

    def rate_limit(self, model: str, retry_after: float = 0.2, times: int = 1):
        self._rate_limits[model] = {"retry_after": retry_after, "times": times, "count": 0}
        return self

    def request_count(self, key: str) -> int:
        return self._requests.get(key, 0)

    def cancelled(self, role: str) -> bool:
        return self._cancelled.get(role, False)

    async def call(self, role: str, model: str = "mock-model", **kwargs):
        self._requests[model] = self._requests.get(model, 0) + 1
        self._requests[role] = self._requests.get(role, 0) + 1

        rl = self._rate_limits.get(model)
        if rl and rl["count"] < rl["times"]:
            rl["count"] += 1
            raise LLMRateLimited(
                f"Synthetic 429 for {model}",
                retry_after=rl["retry_after"],
                model=model,
            )

        delay_s = self._delays.get(role, 0.0)
        if delay_s > 0:
            try:
                await asyncio.sleep(delay_s)
            except asyncio.CancelledError:
                self._cancelled[role] = True
                raise

        return self._responses.get(role, "ok")


@pytest.mark.asyncio
async def test_speculation_cancelled_on_terminal_verdict():
    """
    Invariant I2 & I6:
    Speculative work is cancelled when the verdict is terminal,
    and its result never reaches the caller.
    """
    fake_llm = FakeLLM()
    fake_llm.delay("verifier", 0.02).respond(
        "verifier",
        VerifierResult(status="goal_complete", reason="Target goal achieved."),
    )
    fake_llm.delay("navigator", 0.25).respond(
        "navigator",
        AgenticPlan(
            reply="Click next",
            steps=[PlanStep(action="click", element_id="btn-next")],
        ),
    )

    scheduler = AgentScheduler()
    state = GoalState(goal="Purchase widget", budget=Budget(max_llm_calls=10))

    resp = await run_speculative_turn(
        scheduler=scheduler,
        state=state,
        verifier_fn=lambda: fake_llm.call("verifier", model="llama-3.3-70b-versatile"),
        navigator_fn=lambda: fake_llm.call("navigator", model="llama-3.3-70b-versatile"),
    )

    assert resp.status == "goal_complete"
    assert fake_llm.cancelled("navigator") is True
    assert resp.steps == []


@pytest.mark.asyncio
async def test_model_backoff_is_shared_across_concurrent_tasks():
    """
    Invariant I5:
    A 429 on one model arms a shared backoff gate that subsequent
    calls to that model wait behind.
    """
    fake_llm = FakeLLM()
    fake_llm.rate_limit("gpt-oss-120b", retry_after=0.25, times=1)
    fake_llm.respond("navigator", "plan_ok")

    scheduler = AgentScheduler()
    t0 = time.monotonic()

    async def run_task():
        return await scheduler.run(
            role="navigator",
            tenant_id="tenant-1",
            fn=lambda: fake_llm.call("navigator", model="gpt-oss-120b"),
            model_override="gpt-oss-120b",
        )

    results = await asyncio.gather(*[run_task() for _ in range(5)])

    assert len(results) == 5
    assert all(r == "plan_ok" for r in results)
    assert fake_llm.request_count("gpt-oss-120b") == 6
    assert time.monotonic() - t0 >= 0.25


@pytest.mark.asyncio
async def test_budget_decrement_is_race_free():
    """
    Invariant I5:
    Budget decrements under concurrent load never exceed the ceiling.
    """
    state = GoalState(goal="Race test", budget=Budget(max_llm_calls=3))
    results = await asyncio.gather(*[try_consume(state) for _ in range(10)])

    assert state.budget.llm_calls == 3
    assert results.count(True) == 3
    assert results.count(False) == 7

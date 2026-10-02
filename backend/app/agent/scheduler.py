"""
Atlas v2 Scheduler — Concurrency, Admission Control, and Tracing
backend/app/agent/scheduler.py
Adheres strictly to §8.7, §8.8, and §15 of atlas-v2-architecture.md.
Prime Directive: 100% universal across all websites, zero domain or vendor hardcoding.
"""

import asyncio
from contextlib import asynccontextmanager
from enum import Enum
import logging
import os
import time
from typing import Any, Callable, Dict, List, Literal, Optional, Union
import uuid

from pydantic import BaseModel, Field

from app.agent import llm_client
from app.agent.llm_client import LLMRateLimited
from app.models.goal import (
    AgenticPlan,
    Budget,
    GoalOverallStatus,
    GoalState,
    GoalStepResponse,
    PlanStep,
    VerifierResult,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_CONCURRENCY = int(os.getenv("DEFAULT_MODEL_CONCURRENCY", "4"))
DEFAULT_TENANT_CONCURRENCY = int(os.getenv("DEFAULT_TENANT_CONCURRENCY", "8"))


class Priority(str, Enum):
    """Execution priority lane."""
    USER = "user"
    SPECULATIVE = "speculative"


class Span(BaseModel):
    """Structured telemetry span for agent LLM invocations (§15)."""
    span_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    parent_span_id: Optional[str] = None
    trace_id: str
    role: str
    model: str
    priority: str
    hop: int = 0
    branch_id: str = "b-0"
    started_at: float = Field(default_factory=time.monotonic)
    ended_at: Optional[float] = None
    outcome: Literal["ok", "error", "cancelled", "rate_limited"] = "ok"
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    error_message: Optional[str] = None

    def ok(self, result: Any = None) -> None:
        self.outcome = "ok"
        self.ended_at = time.monotonic()

    def error(self, exc: Exception) -> None:
        self.outcome = "error"
        self.error_message = str(exc)
        self.ended_at = time.monotonic()

    def rate_limited(self, retry_after: float) -> None:
        self.outcome = "rate_limited"
        self.error_message = f"Rate limited. Retry after {retry_after}s"
        self.ended_at = time.monotonic()

    def cancelled(self) -> None:
        self.outcome = "cancelled"
        self.ended_at = time.monotonic()


class GoalTrace:
    """Collects and groups spans under a single goal trace."""

    def __init__(self, trace_id: Optional[str] = None, hop: int = 0, branch_id: str = "b-0"):
        self.trace_id = trace_id or str(uuid.uuid4())
        self.hop = hop
        self.branch_id = branch_id
        self.spans: List[Span] = []
        self._marks: List[Dict[str, Any]] = []

    def start_span(
        self,
        role: str,
        model: str,
        priority: Union[Priority, str],
        parent_span_id: Optional[str] = None,
    ) -> Span:
        p_str = priority.value if hasattr(priority, "value") else str(priority)
        span = Span(
            trace_id=self.trace_id,
            parent_span_id=parent_span_id,
            role=role,
            model=model,
            priority=p_str,
            hop=self.hop,
            branch_id=self.branch_id,
            started_at=time.monotonic(),
        )
        self.spans.append(span)
        return span

    def end_span(self, span: Span) -> None:
        if span.ended_at is None:
            span.ended_at = time.monotonic()

    def mark(self, event: str, **details: Any) -> None:
        self._marks.append({
            "event": event,
            "timestamp": time.monotonic(),
            "details": details,
        })


class Perception(BaseModel):
    """Ensemble perception output from Verifier + Scout fan-out (§8.3)."""
    verdict: VerifierResult
    page: Optional[Any] = None
    hints: Optional[Dict[str, Any]] = None


# ── Race-free Atomic Budget Tracking ──────────────────────────────────────────

_budget_locks: Dict[int, asyncio.Lock] = {}
_budget_meta_lock = asyncio.Lock()


async def get_budget_lock(state: GoalState) -> asyncio.Lock:
    """Retrieves or creates an asyncio.Lock bound to state's budget object."""
    key = id(state.budget)
    async with _budget_meta_lock:
        if key not in _budget_locks:
            _budget_locks[key] = asyncio.Lock()
        return _budget_locks[key]


async def try_consume(state: GoalState, cost: int = 1) -> bool:
    """
    Atomically consumes `cost` LLM calls from state budget (§8.7 & §13.6).
    Returns True if successfully consumed without exceeding max_llm_calls; False otherwise.
    """
    lock = await get_budget_lock(state)
    async with lock:
        if state.budget.llm_calls + cost <= state.budget.max_llm_calls:
            state.budget.llm_calls += cost
            return True
        return False


# ── Agent Scheduler ───────────────────────────────────────────────────────────

class AgentScheduler:
    """Admission control, concurrency limiting, and tracing for all agent LLM calls."""

    def __init__(self) -> None:
        # Rate limits are per-model at provider, so semaphores are per-model
        self._model_sems: Dict[str, asyncio.Semaphore] = {}
        # Fairness across tenants: one goal cannot monopolize the pool
        self._tenant_sems: Dict[str, asyncio.Semaphore] = {}
        # Shared backoff: model -> monotonic time until which all tasks hold
        self._backoff: Dict[str, float] = {}
        self._lock = asyncio.Lock()

    def _clean_model_key(self, model: str) -> str:
        return model.replace("/", "_").replace("-", "_").replace(".", "_").upper()

    def _get_model_concurrency(self, model: str) -> int:
        clean = self._clean_model_key(model)
        env_key = f"MODEL_CONCURRENCY_{clean}"
        val = os.getenv(env_key)
        if val:
            try:
                return max(1, int(val))
            except ValueError:
                pass
        return DEFAULT_MODEL_CONCURRENCY

    def _get_model_sem(self, model: str) -> asyncio.Semaphore:
        if model not in self._model_sems:
            capacity = self._get_model_concurrency(model)
            self._model_sems[model] = asyncio.Semaphore(capacity)
        return self._model_sems[model]

    def _get_tenant_sem(self, tenant_id: str) -> asyncio.Semaphore:
        if tenant_id not in self._tenant_sems:
            self._tenant_sems[tenant_id] = asyncio.Semaphore(DEFAULT_TENANT_CONCURRENCY)
        return self._tenant_sems[tenant_id]

    def _arm_backoff(self, model: str, retry_after: float) -> None:
        """Arms a shared backoff gate for all tasks using `model`."""
        now = time.monotonic()
        target = now + max(0.05, float(retry_after))
        current = self._backoff.get(model, 0.0)
        self._backoff[model] = max(current, target)
        logger.warning(
            "Scheduler armed backoff for model '%s' for %.2fs (until %.2f)",
            model,
            retry_after,
            self._backoff[model],
        )

    def is_backed_off(self, model: str) -> bool:
        return self._backoff.get(model, 0.0) > time.monotonic()

    async def _await_backoff(self, model: str) -> None:
        """Waits until any active backoff gate for `model` expires."""
        while True:
            until = self._backoff.get(model, 0.0)
            now = time.monotonic()
            if until <= now:
                break
            wait_s = until - now
            await asyncio.sleep(wait_s)

    @asynccontextmanager
    async def _model_sem_ctx(self, model: str, priority: Priority):
        sem = self._get_model_sem(model)
        if priority == Priority.SPECULATIVE:
            # Speculative lane: only acquires if spare capacity beyond reserved floor (1)
            while True:
                if self.is_backed_off(model):
                    await self._await_backoff(model)
                if getattr(sem, "_value", 1) > 1:
                    await sem.acquire()
                    break
                await asyncio.sleep(0.02)
        else:
            await sem.acquire()
        try:
            yield
        finally:
            sem.release()

    @asynccontextmanager
    async def _tenant_sem_ctx(self, tenant_id: str):
        sem = self._get_tenant_sem(tenant_id)
        await sem.acquire()
        try:
            yield
        finally:
            sem.release()

    async def run(
        self,
        *,
        role: str,
        fn: Callable[..., Any],
        tenant_id: str = "default",
        priority: Priority = Priority.USER,
        trace: Optional[GoalTrace] = None,
        model_override: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        """
        Executes an agent callable under admission control, backoff, and tracing.
        If a 429 occurs, arms shared backoff and transparently retries.
        """
        model = model_override or llm_client.get_model_for_role(role=role)

        while True:
            await self._await_backoff(model)

            async with self._tenant_sem_ctx(tenant_id), self._model_sem_ctx(model, priority):
                # Double-check backoff after acquiring semaphore
                if self.is_backed_off(model):
                    continue

                span = trace.start_span(role=role, model=model, priority=priority) if trace else None
                try:
                    res = fn(**kwargs)
                    if asyncio.iscoroutine(res):
                        res = await res
                    if span:
                        span.ok(res)
                    return res
                except LLMRateLimited as exc:
                    self._arm_backoff(model, exc.retry_after)
                    if span:
                        span.rate_limited(exc.retry_after)
                        if trace:
                            trace.end_span(span)
                    # Loop back to wait behind shared backoff
                    continue
                except asyncio.CancelledError:
                    if span:
                        span.cancelled()
                        if trace:
                            trace.end_span(span)
                    raise
                except Exception as exc:
                    if span:
                        span.error(exc)
                        if trace:
                            trace.end_span(span)
                    raise
                finally:
                    if span and trace:
                        trace.end_span(span)


# Global singleton scheduler
default_scheduler = AgentScheduler()


# ── Speculative Planning & Cancellation (§8.5) ───────────────────────────────

async def run_speculative_turn(
    scheduler: AgentScheduler,
    state: GoalState,
    verifier_fn: Callable[[], Any],
    navigator_fn: Callable[[], Any],
    trace: Optional[GoalTrace] = None,
) -> GoalStepResponse:
    """
    Executes verifier and speculative navigator concurrently.
    If verifier outcome is terminal (goal_complete / goal_failed), navigator is cancelled immediately (I2).
    """
    spec_task: Optional[asyncio.Task] = None
    verdict: Optional[VerifierResult] = None
    plan: Optional[AgenticPlan] = None

    try:
        async with asyncio.TaskGroup() as tg:
            t_verify = tg.create_task(
                scheduler.run(
                    role="verifier",
                    priority=Priority.USER,
                    fn=verifier_fn,
                    trace=trace,
                ),
                name="verifier:primary",
            )
            spec_task = tg.create_task(
                scheduler.run(
                    role="navigator",
                    priority=Priority.SPECULATIVE,
                    fn=navigator_fn,
                    trace=trace,
                ),
                name="navigator:speculative",
            )

            # Await verdict first
            while not t_verify.done():
                await asyncio.sleep(0.01)

            verdict = t_verify.result()

            if verdict.status in ("goal_complete", "goal_failed"):
                # Discard and cancel speculative task immediately
                if spec_task and not spec_task.done():
                    spec_task.cancel()
                if trace:
                    trace.mark("speculation_discarded", reason=verdict.status)
            else:
                # In progress: wait for speculation to complete or join
                if trace:
                    trace.mark("speculation_adopted")

    except* asyncio.CancelledError:
        pass

    if verdict and verdict.status in ("goal_complete", "goal_failed"):
        state.status = verdict.status
        state.verifier_result = verdict
        return GoalStepResponse(
            status=verdict.status,
            goal_state=state,
            reply=verdict.reason or ("Goal completed." if verdict.status == "goal_complete" else "Goal failed."),
            steps=[],
        )

    # Speculation adopted
    if spec_task and spec_task.done() and not spec_task.cancelled():
        try:
            plan = spec_task.result()
        except Exception:
            plan = None

    steps = plan.steps if plan else []
    reply = plan.reply if plan else (verdict.reason if verdict else "Proceeding with goal.")
    status: GoalOverallStatus = verdict.status if verdict else "in_progress"
    if status not in ("goal_complete", "goal_failed", "milestone_complete", "requires_confirmation"):
        status = "in_progress"

    state.status = status
    if verdict:
        state.verifier_result = verdict

    return GoalStepResponse(
        status=status,
        goal_state=state,
        reply=reply,
        steps=steps,
    )

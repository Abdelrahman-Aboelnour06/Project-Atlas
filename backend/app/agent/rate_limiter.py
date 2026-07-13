"""
Lightweight in-memory per-tenant rate limiter for the /v1/agent WS pipeline.

Why: the frontend caches "simplify" results and only re-sends after a
meaningful DOM change, not on every mutation (Contract 5) — but a bug in
that debounce/caching logic, or any other runaway loop re-triggering
"simplify"/"command", would hammer the LLM and Postgres and could
self-inflict an outage mid-demo (status doc §2.6). This is a coarse
circuit breaker, not precise per-endpoint metering.

Design notes:
  - Sliding window per tenant_id, in-process memory only. Resets on
    restart and does not share state across multiple backend workers —
    fine for a single-instance hackathon deployment, not meant to survive
    a horizontally-scaled production setup.
  - Checked in routes/agent.py right after auth, so it's keyed on the
    real tenant_id (a UUID resolved from a valid API key) rather than the
    raw api_key string.

Config (env, both optional):
  RATE_LIMIT_MAX_REQUESTS   default 30   — requests allowed per window
  RATE_LIMIT_WINDOW_SECONDS default 60   — sliding window size, in seconds
"""
import os
import time
from collections import defaultdict, deque
from threading import Lock

MAX_REQUESTS = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "30"))
WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

_buckets: dict[str, deque] = defaultdict(deque)
_lock = Lock()


def check(tenant_id) -> bool:
    """
    Records one request for `tenant_id` and reports whether it's allowed.

    Returns:
        True  — under the limit, request may proceed (and now counts
                toward the window).
        False — tenant has hit MAX_REQUESTS within the last
                WINDOW_SECONDS; caller should reject this message.
    """
    key = str(tenant_id)
    now = time.monotonic()

    with _lock:
        bucket = _buckets[key]
        cutoff = now - WINDOW_SECONDS
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= MAX_REQUESTS:
            return False

        bucket.append(now)
        return True


def reset() -> None:
    """
    Clears all rate-limit state for every tenant.

    Test-only: call from a pytest fixture between tests so one test's
    (or one module-scoped client's) message volume can never bleed into
    another test's limit.
    """
    with _lock:
        _buckets.clear()

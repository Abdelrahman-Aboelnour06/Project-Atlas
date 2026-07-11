"""
test_rate_limiter.py — unit tests for app.agent.rate_limiter.

Exercises the limiter directly (not through the WS endpoint) so it's fast
and doesn't depend on LLM/DB mocking. See test_websocket.py for the
integration-level test confirming routes/agent.py actually enforces this
after auth.
"""
import pytest

from app.agent import rate_limiter


@pytest.fixture(autouse=True)
def _clean_state():
    """Belt-and-suspenders: this module already gets the session-wide
    autouse reset from conftest.py, but resetting again locally makes
    this file correct even if run standalone or reordered."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def test_allows_requests_under_the_limit(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 5)
    for _ in range(5):
        assert rate_limiter.check("tenant-a") is True


def test_blocks_once_limit_is_hit(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 3)
    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-a") is True
    # 4th request within the window, still under the limit's timestamp — blocked
    assert rate_limiter.check("tenant-a") is False


def test_blocked_tenant_stays_blocked_until_window_clears(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 1)
    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-a") is False
    assert rate_limiter.check("tenant-a") is False  # not a one-shot fluke


def test_tenants_have_independent_buckets(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 1)
    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-a") is False
    # tenant-b's bucket is untouched by tenant-a's traffic
    assert rate_limiter.check("tenant-b") is True


def test_accepts_non_string_tenant_ids(monkeypatch):
    """tenant_id from validate_api_key() is a uuid.UUID, not a str —
    check() must key off str(tenant_id) consistently either way."""
    import uuid
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 1)
    tid = uuid.uuid4()
    assert rate_limiter.check(tid) is True
    assert rate_limiter.check(tid) is False
    assert rate_limiter.check(str(tid)) is False  # same tenant, same bucket


def test_old_requests_fall_out_of_the_sliding_window(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 1)
    monkeypatch.setattr(rate_limiter, "WINDOW_SECONDS", 10)

    fake_now = [1000.0]
    monkeypatch.setattr(rate_limiter.time, "monotonic", lambda: fake_now[0])

    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-a") is False  # still inside the window

    fake_now[0] += 11  # advance past WINDOW_SECONDS
    assert rate_limiter.check("tenant-a") is True  # old entry aged out


def test_reset_clears_every_tenant(monkeypatch):
    monkeypatch.setattr(rate_limiter, "MAX_REQUESTS", 1)
    rate_limiter.check("tenant-a")
    rate_limiter.check("tenant-b")
    assert rate_limiter.check("tenant-a") is False
    assert rate_limiter.check("tenant-b") is False

    rate_limiter.reset()

    assert rate_limiter.check("tenant-a") is True
    assert rate_limiter.check("tenant-b") is True

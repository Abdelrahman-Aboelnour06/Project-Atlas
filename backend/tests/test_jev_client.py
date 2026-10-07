"""
test_jev_client.py - Unit & Integration tests for Jev 3 System 1 Decision Engine
Validates typed schemas, sub-100ms decision routing, deterministic mock provider,
and graceful degradation to System 2 fallback.
"""

import asyncio
import pytest
from app.agent.jev_client import (
    JevClient,
    JevChoice,
    JevScore,
    JevNoul,
    JevError,
    JevTimeoutError,
    get_jev_client,
)


@pytest.mark.asyncio
async def test_jev_choice_schema_and_selection():
    """Jev client choose() returns a validated JevChoice with selected ref and confidence."""
    client = JevClient(provider="mock")
    candidates = [
        {"ref": "ref_search_input", "tag": "input", "role": "searchbox", "label": "Search products"},
        {"ref": "ref_cart_btn", "tag": "button", "role": "button", "label": "Shopping Cart"},
        {"ref": "ref_logo", "tag": "a", "role": "link", "label": "Home"},
    ]
    
    result = await client.choose(
        state={"url": "https://store.example.com", "page_title": "Store Catalog"},
        options=candidates,
        question="Which element is the search input bar to type a product name?",
    )
    
    assert isinstance(result, JevChoice)
    assert result.selected_id == "ref_search_input"
    assert result.confidence >= 0.85
    assert result.latency_ms is not None
    assert result.latency_ms < 150  # Must be ultrafast System 1 reflex


@pytest.mark.asyncio
async def test_jev_noul_judgment():
    """Jev client judge() returns a boolean judgment with probability score."""
    client = JevClient(provider="mock")
    
    # Positive case
    is_form = await client.judge(
        state={"dom_summary": "input email, input password, button submit"},
        statement="This page contains an interactive user authentication form.",
    )
    assert isinstance(is_form, JevNoul)
    assert is_form.result is True
    assert is_form.confidence > 0.80

    # Negative case
    has_captcha = await client.judge(
        state={"dom_summary": "article content, heading, paragraph text"},
        statement="This page contains a CAPTCHA or Cloudflare challenge.",
    )
    assert isinstance(has_captcha, JevNoul)
    assert has_captcha.result is False
    assert has_captcha.confidence > 0.80


@pytest.mark.asyncio
async def test_jev_score_evaluation():
    """Jev client score() scores alignment of an element or state against criteria."""
    client = JevClient(provider="mock")
    
    score_res = await client.score(
        state={"element_text": "Proceed to Checkout", "tag": "button", "is_primary": True},
        criteria="Is this element the primary call-to-action button for purchase?",
    )
    assert isinstance(score_res, JevScore)
    assert 0.0 <= score_res.score <= 1.0
    assert score_res.score > 0.85


@pytest.mark.asyncio
async def test_jev_empty_options_returns_none():
    """When no candidates are provided, choose() returns None without raising an exception."""
    client = JevClient(provider="mock")
    result = await client.choose(
        state={"url": "https://example.com"},
        options=[],
        question="Find the target button",
    )
    assert result is None


@pytest.mark.asyncio
async def test_jev_timeout_and_fallback():
    """If Jev exceeds timeout threshold, it raises JevTimeoutError so caller falls back to System 2."""
    # Configure tiny 1ms timeout to trigger timeout simulation
    client = JevClient(provider="mock", timeout_ms=1)
    
    # Simulate slow call with delay
    client._simulate_latency_ms = 50
    with pytest.raises(JevTimeoutError):
        await client.choose(
            state={"url": "https://example.com"},
            options=[{"ref": "btn-1", "label": "Click me"}],
            question="Select button",
        )


@pytest.mark.asyncio
async def test_jev_singleton_factory():
    """get_jev_client() provides a shared, thread-safe client instance."""
    client1 = get_jev_client()
    client2 = get_jev_client()
    assert client1 is client2

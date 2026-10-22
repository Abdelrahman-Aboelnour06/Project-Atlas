"""
Atlas Configuration & Feature Flags Endpoint
GET /v1/config

Provides runtime configuration, capability negotiation, and kill-switches (H15).
"""

import os
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


def is_multitab_enabled() -> bool:
    """
    Evaluates whether multi-tab reasoning is enabled.
    Controlled by environment variable MULTITAB_ENABLED (or ATLAS_MULTITAB_ENABLED).
    Defaults to True unless set to '0', 'false', 'no', 'off', or 'disabled' (case-insensitive).
    """
    raw = os.getenv("MULTITAB_ENABLED")
    if raw is None:
        raw = os.getenv("ATLAS_MULTITAB_ENABLED", "true")
    val = (raw or "true").strip().lower()
    return val not in ("0", "false", "no", "off", "disabled")


class MultiTabConfig(BaseModel):
    enabled: bool = Field(default=True, description="Whether multi-tab reasoning & coordination is enabled")
    maxHandoffs: int = Field(default=4, description="Maximum tab handoffs allowed per session")
    leaseTtlSeconds: int = Field(default=20, description="Tab lease lock TTL in seconds")


class ConfigResponse(BaseModel):
    multiTab: MultiTabConfig = Field(default_factory=MultiTabConfig, description="Multi-tab configuration and kill-switch flag")
    version: str = Field(default="0.3.0", description="Atlas API version")


@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """
    Returns runtime configuration, feature flags, and limits.
    """
    return ConfigResponse(
        multiTab=MultiTabConfig(
            enabled=is_multitab_enabled(),
            maxHandoffs=4,
            leaseTtlSeconds=20,
        ),
        version="0.3.0",
    )

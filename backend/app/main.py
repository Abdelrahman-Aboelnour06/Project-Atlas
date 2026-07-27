from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.routes import agent, session, health, audit

app = FastAPI(
    title="Atlas API",
    version="0.1.0",
    description="Atlas Agentic AI — accessibility platform backend.",
)

# CORS — restricted to the extension origin(s), not "*".
# ALLOWED_ORIGINS is a comma-separated env var so each dev's unpacked
# extension ID (chrome-extension://<id>) can be added without editing code.
# Wildcard "*" + allow_credentials=True is rejected by browsers anyway, so
# this was never actually working permissively — just silently broken.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000"
allowed_origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

# Chrome extension origin lock – only the specific unpacked/published ID is allowed
extension_id = os.getenv("EXTENSION_ID", "pknbdfjklmabcdefghijklmnopqrstuv")
allow_origin_regex = rf"^chrome-extension://{extension_id}$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)                # GET  /health
app.include_router(session.router, prefix="/v1") # POST /v1/session/start
app.include_router(agent.router,   prefix="/v1") # WS   /v1/agent
app.include_router(audit.router,   prefix="/v1") # POST /v1/audit/log
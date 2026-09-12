import os
from pathlib import Path
from dotenv import load_dotenv

# Ensure .env is loaded regardless of current working directory
_env_candidates = [
    Path.cwd() / ".env",
    Path.cwd() / "backend" / ".env",
    Path(__file__).resolve().parent.parent / ".env",
]
for _p in _env_candidates:
    if _p.is_file():
        load_dotenv(dotenv_path=_p)
        break

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import agent, session, health, audit, chat

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
_default_origins = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:8000,http://127.0.0.1:8000,"
    "http://localhost:5500,http://127.0.0.1:5500"
)
allowed_origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

# Allow requests from the extension, localhost on any port, or any host webpage where content scripts run
allow_origin_regex = os.getenv("ALLOW_ORIGIN_REGEX", r".*")

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
app.include_router(chat.router,    prefix="/v1") # POST /v1/chat
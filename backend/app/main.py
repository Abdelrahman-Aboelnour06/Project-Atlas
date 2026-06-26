from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import agent, session, health

app = FastAPI(
    title="Atlas API",
    version="0.1.0",
    description="Atlas Agentic AI — accessibility platform backend.",
)

# CORS — dev mode, allow all origins
# TODO: tighten before production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)                # GET  /health
app.include_router(session.router, prefix="/v1") # POST /v1/session/start
app.include_router(agent.router,   prefix="/v1") # WS   /v1/agent

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="Atlas API", version="1.0.0")

# CORS — dev mode allows all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health Check ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "atlas-api"}

# ── Routers (uncomment as teams build them) ──────────────────────────────────
# from app.routes.session import router as session_router
# from app.routes.agent import router as agent_router
# from app.routes.audit import router as audit_router
# app.include_router(session_router, prefix="/v1")
# app.include_router(agent_router, prefix="/v1")
# app.include_router(audit_router, prefix="/v1")

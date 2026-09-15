# Project Atlas — Backend Service

FastAPI-powered asynchronous backend providing real-time AI web automation, page simplification, and conversational assistance.

## Architecture & Endpoints

- **/v1/agent (WebSocket)**: Real-time dual-pipeline agent endpoint.
  - Supports auth handshake with CSWSH protection and brute-force throttling (3 failed attempts -> WS 1008).
  - Handles command actions (resolves natural language to DOM interactions).
  - Handles simplify analysis (generates plain-language element summaries for older adults).
  - Employs short-lived database connections via get_db_context() to prevent pool exhaustion.
- **POST /v1/session/start**: Initializes unique session UUIDs. Requires X-Atlas-Key header.
- **POST /v1/chat**: Multi-turn conversation and agentic multi-step planning with prompt-injection fences.
- **POST /v1/summary**: High-level page summarization.
- **POST /v1/fixes**: Heuristic accessibility fix generator.
- **POST /v1/audit/log**: Records client-side accessibility audit findings.
- **GET /health**: Health check reporting database and LLM connectivity status.

## Environment Variables

Configure in backend/.env:

| Variable | Description | Default / Example |
|----------|-------------|-------------------|
| DATABASE_URL | PostgreSQL connection URL (asyncpg) | postgresql+asyncpg://postgres:postgres@localhost:5432/atlas |
| LLM_PROVIDER | AI provider (groq, nvidia_nim, or ollama) | groq |
| LLM_BASE_URL | AI API base URL | https://api.groq.com/openai/v1 |
| LLM_MODEL | Target model identifier | llama-3.3-70b-versatile |
| LLM_API_KEY | Provider API key (e.g. from console.groq.com) | gsk_your_api_key_here |
| API_KEY_HEADER | Header name for API key authentication | X-Atlas-Key |
| ALLOWED_ORIGINS | Comma-separated list of allowed origins | http://localhost:3000,... |
| ALLOW_ORIGIN_REGEX | Regex for allowed extension origins | ^chrome-extension://[a-z]{32}$ |

*Note: Atlas supports Groq (ultra-low latency LPU inference with `llama-3.3-70b-versatile`), NVIDIA NIM (with Nemotron reasoning toggles `/think` vs `/no_think`), and local Ollama.*

## Setup & Running

`ash
# 1. Activate virtual environment
cd backend
python -m venv venv
venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run development server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
`

## Running Tests

`ash
# Run all backend tests
pytest tests/

# Run security and resilience suite
pytest tests/test_security_resilience.py -v
`

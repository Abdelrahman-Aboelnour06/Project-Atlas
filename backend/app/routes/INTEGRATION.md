# Tasks 5–8 — Integration Guide

> Rewritten to match the current code. The previous version of this file
> was written while the command pipeline was still the only pipeline —
> it predates the simplify pipeline, the PII sanitize pass, and a couple
> of field/status names that changed since. If you copy-pasted its old
> test payload or its `"ok"`/`"no_match"` statuses into anything, those
> are no longer correct — see below.

## What's built

| File | Task | What it does |
|------|------|-------------|
| `app/agent/llm_client.py` | 4 | `call_llm()` / `ping_llm()` — talks to the configured provider (Ollama or any OpenAI-compatible one), retries on timeout |
| `app/agent/sanitize.py` | 2.3 | `strip_pii_from_dom()` / `trim_log_payload()` — the one, shared PII pass both pipelines rely on |
| `app/agent/prompt.py` | 5 | `build_prompt()` — command pipeline prompt |
| `app/agent/parser.py` | 6 | `parse_action()` — validates raw LLM JSON → `ActionResponse` |
| `app/agent/simplify_prompt.py` | 2.1 | `build_simplify_prompt()` — simplify pipeline prompt (the sidebar feature) |
| `app/agent/simplify_parser.py` | 2.1 | `parse_simplify_response()` — validates raw LLM JSON → element list |
| `app/agent/rate_limiter.py` | 2.6 | `check()` / `reset()` — per-tenant sliding-window limiter |
| `app/routes/agent.py` | 7 | Full WS handler — auth → rate limit → sanitize → dispatch → log → respond |
| `app/routes/audit.py` | 8 | `POST /v1/audit/log` — writes flagged accessibility errors to `error_logs` |

---

## Confirm your `.env`

Default provider is **NVIDIA NIM** (OpenAI-compatible) — `LLM_API_KEY` is
required unless you switch to Ollama:

```env
LLM_PROVIDER=nvidia_nim
LLM_MODEL=meta/llama-3.1-70b-instruct
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_API_KEY=                    # required — get one from https://build.nvidia.com

# To use local Ollama instead:
# LLM_PROVIDER=ollama
# LLM_MODEL=llama3
# LLM_BASE_URL=http://localhost:11434
# LLM_API_KEY=
```

The app raises `RuntimeError` at import time — not a silent misbehavior —
if `LLM_PROVIDER` isn't `"ollama"` and `LLM_API_KEY` is blank. That's
intentional: better to fail loudly on boot than get confusing 401s from
the provider later. See `backend/.env.example` for the full list
(`DATABASE_URL`, `API_KEY_HEADER`, etc.).

Optional, both have working defaults:
```env
RATE_LIMIT_MAX_REQUESTS=30      # requests per tenant per window
RATE_LIMIT_WINDOW_SECONDS=60
```

---

## Full pipeline data flow

```
Frontend WS message  { session_id, api_key, url, dom_map, type, command }
    │
    ▼
AgentMessage(**data)                 ← app/models/request.py — parse + validate shape
    │
    ├─ validate_api_key(db, key)     ← app/db/connection.py — resolves tenant_id, or error
    │
    ├─ rate_limiter.check(tenant_id) ← app/agent/rate_limiter.py — error if exceeded
    │
    ├─ strip_pii_from_dom(dom_map)   ← app/agent/sanitize.py — ONE shared pass, before either branch
    │
    ├─ dispatch on `type`:
    │     "simplify" ─┬─ build_simplify_prompt(dom)   ← app/agent/simplify_prompt.py
    │                  ├─ call_llm(prompt)             ← app/agent/llm_client.py
    │                  └─ parse_simplify_response(raw) ← app/agent/simplify_parser.py
    │     "command"  ─┬─ build_prompt(dom, command)    ← app/agent/prompt.py
    │                  ├─ call_llm(prompt)             ← app/agent/llm_client.py
    │                  └─ parse_action(raw, dom)        ← app/agent/parser.py
    │
    ├─ _log_usage(db, ...)           ← usage_logs table — "command" pipeline only
    │
    └─ websocket.send_json(...)      ← response back to client
```

---

## Test the full pipeline

Start your chosen provider (Ollama example):
```bash
ollama pull llama3
```

Then start the server:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Send a test WS message (wscat, the frontend snippet, or any WS client).
Every field below is required by `AgentMessage` / `DomNode` — a payload
missing any of them (including `type`, or any `DomNode` key even when its
value is `null`) gets rejected with a `status: "error"` reply:

```json
{
  "session_id": "test-session-001",
  "api_key":    "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url":        "https://demo.atlas.com",
  "type":       "command",
  "command":    "click checkout",
  "dom_map": [{
    "id": "atlas-001", "tag": "button", "type": null,
    "inner_text": "Checkout", "placeholder": null,
    "aria_label": "Checkout", "href": null, "name": null, "role": null
  }]
}
```

Expected response (Contract 2 — note `"success"`, not `"ok"`):
```json
{
  "status":     "success",
  "action":     "click",
  "element_id": "atlas-001",
  "value":      null,
  "message":    "Click on 'atlas-001'"
}
```

For the sidebar feature, send the same shape with `"type": "simplify"`
and `"command": ""` — see `docs/contracts.md` Contract 5 for the full
response shape (`elements: [...]`), and `backend/tests/test_websocket.py`
for worked examples of both flows on one connection.

---

## Response statuses the client will receive

Every response — command or simplify — carries exactly one of:

| `status` | When |
|----------|------|
| `"success"` | Pipeline ran and returned a usable result |
| `"error"` | Bad input, invalid/missing API key, rate limit exceeded, LLM failure, or no matching element/nothing usable in the LLM output |

There is no `"no_match"` status — a command the model can't resolve to an
element comes back as `status: "error"` with a human-readable `message`,
same as any other unresolvable case. See `docs/contracts.md` Contract 2
and Contract 5 for the exact field shapes, and the "WebSocket error
handling" section there for which failures keep the connection open
(nearly all of them) versus close it (only an unhandled server
exception, code 1011).

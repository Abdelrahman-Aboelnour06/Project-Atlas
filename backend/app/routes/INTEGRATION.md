# Tasks 5 + 6 + 7 — Integration Guide

## What was built

| File | Task | What it does |
|------|------|-------------|
| `app/agent/__init__.py` | — | Re-exports the full agent pipeline |
| `app/agent/prompt.py` | 5 | Builds the system + user prompt string for `call_llm()` |
| `app/agent/parser.py` | 6 | Validates raw LLM JSON → ActionResponse dict |
| `app/routes/agent.py` | 7 | Full WS handler — auth → pipeline → log → respond |

---

## Drop-in instructions

### 1. Copy the new files into your repo

```
backend/
└── app/
    ├── agent/
    │   ├── __init__.py      ← new
    │   ├── llm_client.py    ← already exists (Task 4)
    │   ├── prompt.py        ← new (Task 5)
    │   └── parser.py        ← new (Task 6)
    └── routes/
        └── agent.py         ← replace existing stub (Task 7)
```

### 2. Confirm your `.env` has these LLM variables

```env
# Ollama (default — runs locally)
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama3
LLM_API_KEY=                         # leave blank for Ollama

# Or swap in any OpenAI-compatible provider:
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini
# LLM_API_KEY=sk-...
```

### 3. One possible adjustment — UsageLog field names

In `app/routes/agent.py`, `_log_usage()` creates a `UsageLog` ORM object.
Make sure the field names in the call match your ORM model in `app/db/models.py`:

```python
# Current call in _log_usage() — adjust if your columns are named differently:
UsageLog(
    tenant_id=tenant_id,
    session_id=session_id,
    url=url,
    command=command,
    action=action,
    element_id=element_id,
    status=status,
    created_at=datetime.now(timezone.utc),
)
```

---

## Full pipeline data flow

```
Frontend WS message
    │
    ▼
WSMessage(**data)                    ← app/models/request.py (already exists)
    │
    ├─ validate_api_key(db, key)     ← app/db/connection.py (already exists)
    │
    ├─ build_prompt(dom_map, cmd)    ← app/agent/prompt.py    [Task 5]
    │
    ├─ call_llm(prompt)              ← app/agent/llm_client.py [Task 4]
    │
    ├─ parse_action(raw_llm)         ← app/agent/parser.py    [Task 6]
    │
    ├─ _log_usage(db, ...)           ← usage_logs table       [Task 6 req]
    │
    └─ websocket.send_text(json)     ← ActionResponse dict back to client
```

---

## Test the full pipeline

Start Ollama and pull the model first:
```bash
ollama pull llama3
```

Then start the server:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Send a test WS message (use wscat or the frontend snippet):
```json
{
  "session_id": "test-session-001",
  "api_key":    "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url":        "https://demo.atlas.com",
  "dom_map": [
    {
      "id": "btn-checkout",
      "tag": "button",
      "inner_text": "Checkout",
      "aria_label": null
    }
  ],
  "command": "click checkout"
}
```

Expected response:
```json
{
  "status": "ok",
  "action": "click",
  "element_id": "btn-checkout",
  "value": null,
  "message": "Click on 'btn-checkout'"
}
```

---

## Error states the client will receive

| status | When |
|--------|------|
| `"ok"` | Action found and ready to execute |
| `"no_match"` | LLM found no matching element (command unclear or element absent) |
| `"error"` | LLM timed out, returned bad JSON, or internal server error |

All three shapes are identical — the client always gets `status`, `action`, `element_id`, `value`, `message`.

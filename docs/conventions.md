# Atlas — Team Format & Conventions

> Read this before writing a single line of code.
> Consistency across 3 teams is what keeps the repo clean during a 3-day sprint.

---

## Git Workflow

### Branch Naming

```
<team>/<task-id>-<short-description>
```

| Team | Prefix | Example |
|------|--------|---------|
| Backend A | `backend-a/` | `backend-a/task3-postgres-schema` |
| Backend B | `backend-b/` | `backend-b/task5-prompt-engineering` |
| Frontend | `frontend/` | `frontend/taskA-dom-serializer` |

### Commit Message Format

```
[TEAM] TASK-ID: short description (imperative, max 60 chars)
```

**Examples:**
```
[BE-A] TASK-3: add tenants and api_keys tables
[BE-B] TASK-7: wire websocket handler to action parser
[FE]   TASK-A: add MutationObserver with 300ms debounce
[FE]   TASK-E: scaffold next.js dashboard with mock sign-in
```

**Rules:**
- Use imperative mood — "add", "fix", "update", not "added" or "adding"
- No emoji in commit messages
- Keep subject line under 60 characters
- Never commit directly to `main` — always open a PR

### Pull Request Format

**Title:** same format as commit message
**Description must include:**
- What this PR does (1–2 sentences)
- Which task it closes: `Closes Task X`
- Any dependency: `Needs Task Y merged first`
- Test: how you verified it works

---

## Python (Backend)

### Style
- Follow **PEP 8** — use `black` for auto-formatting
- Line length: **88 characters** (black default)
- Use type hints on all function signatures

### File Naming
```
snake_case.py
```

### Function / Variable Naming
```python
# functions: snake_case
def parse_action(raw: str) -> ActionResult:

# constants: UPPER_SNAKE
MAX_RETRIES = 2

# Pydantic models: PascalCase
class DomNode(BaseModel):
    id: str | None
    tag: str
```

### Pydantic Models
All request/response shapes must be defined as Pydantic models in `/backend/app/models/`.
**Never** use raw `dict` for API inputs or outputs.

```python
# Good
class ActionResponse(BaseModel):
    status: Literal["success", "error"]
    action: Literal["click", "fill", "scroll", "focus"] | None
    element_id: str | None
    value: str | None
    message: str

# Bad
def handle(data: dict):
    return {"status": "ok", "action": data["action"]}
```

### Error Handling
Always return structured errors — never let exceptions bubble to the client raw.

```python
# Good
except LLMTimeoutError:
    return ActionResponse(status="error", message="AI timed out. Please try again.")

# Bad
except Exception as e:
    raise e
```

### Environment Variables
All secrets and config go in `.env`. Access via `os.getenv()` or a `config.py` module.
**Never hardcode keys, URLs, or passwords.**

---

## JavaScript (Client Script)

### Style
- Use **ES6+** — arrow functions, `const`/`let`, template literals
- No semicolons (pick one — no semicolons — and stick to it)
- Line length: 80 characters

### File Naming
```
kebab-case.js
```

### Function / Variable Naming
```js
// functions: camelCase
const serializeDom = () => { ... }

// constants: UPPER_SNAKE
const DEBOUNCE_MS = 300

// classes: PascalCase
class AtlasAgent { ... }
```

### Module Pattern
Each file exports one clear thing:

```js
// dom-serializer.js
const serializeDom = () => {
  // ...
}

export { serializeDom }
```

### No DOM Manipulation from speech.js or websocket-client.js
- `dom-serializer.js` owns DOM reading
- `executor.js` owns DOM writing
- `speech.js` only handles audio
- `websocket-client.js` only handles the socket

Keep concerns separated — crossing these lines makes debugging a nightmare.

---

## Next.js (Dashboard)

### Style
- Use **TypeScript** (`.tsx` files)
- Component files: `PascalCase.tsx`
- Utility files: `camelCase.ts`
- Use **Tailwind** utility classes only — no custom CSS files unless unavoidable

### Component Structure
```tsx
// Good — one component per file, named export
export default function ApiKeyCard({ apiKey }: { apiKey: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-gray-500">Your API Key</p>
      <code className="font-mono text-sm">{apiKey}</code>
    </div>
  )
}
```

### Data Fetching
Use `fetch` with `async/await` inside `useEffect` or server components.
No external state management libraries — keep it simple for the hackathon.

---

## SQL (PostgreSQL)

### Naming
```sql
-- tables: snake_case, plural
CREATE TABLE tenants (...);
CREATE TABLE api_keys (...);
CREATE TABLE usage_logs (...);
CREATE TABLE error_logs (...);

-- columns: snake_case
tenant_id, created_at, is_active
```

### Every Table Must Have
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at  TIMESTAMP DEFAULT NOW()
```

### Foreign Keys
Always define explicitly — don't rely on application-level joins.

```sql
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
```

---

## File Structure Rules

| Rule | Detail |
|------|--------|
| One thing per file | No 500-line files that do everything |
| No dead code | Don't commit commented-out blocks |
| No `console.log` in JS | Use a proper logger or remove before PR |
| No `print()` in Python for debugging | Use `logging` module |
| `.env` is never committed | Always in `.gitignore` |
| Secrets never hardcoded | `.env.example` shows the key names, not the values |

---

## Folder Ownership

Do not edit files outside your team's folder without notifying the other team.

| Folder | Owner |
|--------|-------|
| `/backend/app/db/` | Backend A |
| `/backend/app/models/` | Backend A |
| `/backend/app/routes/` | Backend B |
| `/backend/app/agent/` | Backend B |
| `/client-script/` | Frontend |
| `/dashboard/` | Frontend |
| `/demo-site/` | Frontend |
| `/docs/contracts.md` | All teams — change by consensus only |

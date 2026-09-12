# Project Atlas — Comprehensive Technical Documentation

> **⚠️ Living Document:** This file must be kept updated as the project evolves. Every time a new feature ships, a schema changes, or a dependency is added, update the relevant section here. Stale documentation is worse than no documentation.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Complete System Architecture](#2-complete-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Data Models](#4-data-models)
5. [Current Status](#5-current-status)
6. [Roadmap](#6-roadmap)
7. [Setup Instructions](#7-setup-instructions)
8. [Contribution Guidelines](#8-contribution-guidelines)
9. [For AI Agents Specifically](#9-for-ai-agents-specifically)

---

## 1. Project Overview

**Project Name:** Atlas

**Tagline:** An AI-powered browser assistant that makes any website accessible to anyone.

### What Atlas Is

Atlas is a Chrome extension backed by a Python API that reads the interactive elements of any webpage, strips out the noise, and presents them in a clean sidebar the user can understand and act on — by clicking, typing a command, or speaking out loud.

The target user is anyone who struggles with the complexity of modern websites: elderly people, people with cognitive or motor disabilities, or anyone who just can't find what they're looking for. Instead of hunting for buttons, they open Atlas, see a simplified view of the page, and either tap an item or say "click checkout."

### Core Goals

- **Accessibility first:** Make any website navigable without knowing where anything is.
- **Privacy by design:** Never send typed field values to the AI. Passwords and sensitive inputs are stripped before leaving the browser.
- **Universal:** Works on any website without site-specific configuration.
- **Real-time:** Commands execute instantly on the live page.

### Vision

Atlas starts as a browser extension. The long-term vision is a platform where any organization can issue API keys to their users, giving them an AI agent layer on top of their existing website without rebuilding anything.

---

## 2. Complete System Architecture

### Architecture Diagram

```mermaid
flowchart TD
    subgraph Browser["Chrome Browser (client-script/)"]
        EXT["Extension Core\nmanifest.json & background.js"]
        CS["content.js\nOrchestrator & Flow Coordinator"]
        SER["dom-serializer.js\nDynamic Semantic Categorizer & Filter"]
        SB["sidebar.js\nUI (Accordion, SVG Controls, Typing Wave)"]
        WS_CLIENT["websocket-client.js\nBidirectional WS & REST Client"]
        EXEC["executor.js\nUniversal Interaction Engine (W3C Pointer, dblclick, Enter)"]
        SPEECH["speech.js\nVoice Input & TTS Output"]
    end

    subgraph Backend["FastAPI Backend (localhost:8000)"]
        MAIN["main.py\nFastAPI App & CORS Config"]
        AGENT["agent.py\nWebSocket & Action Route"]
        CHAT_ROUTE["chat.py\nREST Natural Language Route"]
        AUTH["API Key Auth\nSHA-256 Lookup"]
        RATE["rate_limiter.py\nSliding Window Limiter"]
        PLANNER["agentic_planner.py\nMulti-Step Agentic Action Planner"]
        SIMPLIFY["simplify_prompt.py\nDOM Simplifier"]
        HEALTH["health.py\nHealth Check"]
    end

    subgraph Cloud["External Services"]
        NEON["Neon.tech\nPostgreSQL (Serverless)"]
        NVIDIA["NVIDIA NIM API\nMeta Llama 3.1 8B Instruct"]
    end

    EXT -->|"Toggle message"| CS
    CS <--> SER
    CS <--> SB
    CS <--> WS_CLIENT
    CS --> EXEC
    CS <--> SPEECH

    SER -->|"Dynamic Categorized DOM Map"| CS
    WS_CLIENT <-->|"WebSocket /v1/agent\nREST /v1/chat"| AGENT

    AGENT --> AUTH
    AUTH -->|"SHA-256 key lookup"| NEON
    AGENT --> RATE
    AGENT -->|"agentic action planning"| PLANNER
    AGENT -->|"simplify request"| SIMPLIFY

    PLANNER <-->|"HTTPS REST"| NVIDIA
    SIMPLIFY <-->|"HTTPS REST"| NVIDIA
    AGENT -->|"Action Plan / Steps reply"| WS_CLIENT

    WS_CLIENT --> CS
    CS --> EXEC
    EXEC -->|"W3C pointer, click, open (dblclick+Enter), fill\non real DOM"| Browser
```

### Layer Explanations

#### Frontend / Extension Layer (`client-script/`)

| File | Role |
|---|---|
| `manifest.json` | Extension config — permissions, content script injection, background service worker |
| `content.js` | **Orchestrator.** Wires modules together, detects URL/SPA changes, handles command routing and sidebar interactions |
| `dom-serializer.js` | **Dynamic Semantic Categorizer.** Scans DOM, discards non-interactive noise, dynamically classifies elements into semantic groups (Navigation, Files & Folders, Controls, Search, Links) with emoji metadata and collapsible structures |
| `sidebar.js` | **UI.** Accessible sidebar panel — dual tabs (Chat & Elements), collapsed accordion menus on load, SVG reload button, 3-dot wave typing animation, search filtering |
| `sidebar.css` | Scoped styling under `#atlas-sidebar-root` with accessibility themes, animations, and focus rings |
| `websocket-client.js` | Bidirectional connection to backend `/v1/agent` and REST client for `/v1/chat` |
| `executor.js` | **Universal Interaction Engine.** Simulates complete W3C event sequences (`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`), universal `open` (`dblclick` + `Enter` keyCode 13) for desktop web apps (Google Drive, Dropbox, Notion), plus `fill`, `scroll`, `focus` |
| `speech.js` | Web Speech API wrapper for speech-to-text recognition and text-to-speech output |
| `background.js` | Service worker — listens for extension icon activation and triggers `ATLAS_TOGGLE` |
| `options.js` / `options.html` | Settings page — tenant API key and backend connection configuration |

#### Backend / API Layer (`backend/app/`)

Built with **FastAPI** (Python). Runs inside Docker or standalone on port 8000.

| File | Role |
|---|---|
| `main.py` | App entry point. Configures CORS, rate limiting middleware, mounts API and WebSocket routes |
| `routes/agent.py` | WebSocket `/v1/agent`. Authenticates session, routes to agentic planner or simplify pipeline |
| `routes/chat.py` | REST `/v1/chat`. Natural language conversational fallback |
| `routes/health.py` | GET `/health` — live health check reporting DB connectivity and LLM reachability |
| `agent/agentic_planner.py` | **Multi-Step Agentic Planner.** Translates user commands + page context into structured multi-step action plans (`click`, `open`, `fill`, `scroll`, `focus`), handles confirmation requirements |
| `agent/simplify_prompt.py` | Generates prompt to simplify complex DOM maps into clean, plain-language accessibility labels |
| `db/connection.py` | SQLAlchemy async engine setup for Neon PostgreSQL |
| `migrations/001_init.sql` | Relational schema definition (tenants, api_keys, usage_logs, error_logs) |
| `migrations/seed.py` | Demo tenant and seeded credentials |

#### Database Layer

**Neon.tech** — serverless PostgreSQL hosted on AWS Europe. Scales to zero when idle with TLS encrypted connections (`asyncpg`).

#### External Integrations

| Service | Purpose | Protocol |
|---|---|---|
| NVIDIA NIM API | Hosted LLM inference (Meta Llama 3.1 8B Instruct) | HTTPS REST POST |
| Neon.tech | PostgreSQL database | `asyncpg` over TLS |

### Data Flow — End to End

#### Flow 1: Page Load (Simplify)

```
User opens a webpage and clicks the Atlas icon
  → background.js sends ATLAS_TOGGLE to content.js
  → content.js mounts the sidebar
  → dom-serializer.js scans the page DOM
      → filters invisible, disabled, machine-labeled elements
      → scores each element (primary / secondary tier)
      → resolves human-readable labels (label > aria-label > text > placeholder)
  → sidebar.js renders elements immediately with local labels (fast)
  → content.js opens WebSocket to ws://localhost:8000/v1/agent
  → backend validates API key (SHA-256 hash lookup in Neon)
  → content.js sends { type: "simplify", dom_map: [...], url: "..." }
  → backend calls NVIDIA NIM with simplify prompt
  → NVIDIA returns cleaned labels + categories
  → backend sends response over WebSocket
  → sidebar.js re-renders with AI-improved labels
```

#### Flow 2: User Command

```
User types "click checkout" or speaks it
  → content.js detects question vs command (isQuestion())
  → if command: sends { type: "command", command: "click checkout", dom_map: [...] }
  → backend calls NVIDIA NIM with command prompt
  → NVIDIA returns { action: "click", element_id: "atlas-001" }
  → backend forwards response over WebSocket
  → executor.js finds element by data-atlas-id attribute
  → executor.js calls element.click() on the real page
  → sidebar chat shows "✅ Done."
```

#### Flow 3: Element Panel Click

```
User clicks "Add to Cart" in the Elements panel
  → dom-serializer.pause() (suppresses MutationObserver re-render)
  → executor finds element by atlas ID
  → element.scrollIntoView() + element.click() or element.focus()
  → dom-serializer.resume() after 1 second
  → sidebar status updates
```

---

## 3. Technology Stack

### Extension (Frontend)

| Technology | Version | Why |
|---|---|---|
| Vanilla JavaScript | ES2022 | No build step needed for Chrome extensions. Keeps the extension lightweight. |
| Chrome Extension Manifest V3 | V3 | Current standard. Service workers instead of background pages. |
| Web Speech API | Browser native | Free, built into Chrome. No external dependency for voice. |
| WebSocket API | Browser native | Persistent bidirectional connection to backend for real-time commands. |

### Backend

| Technology | Version | Why |
|---|---|---|
| Python | 3.11 | Latest stable with full async support |
| FastAPI | Latest | Async-native Python web framework. Auto-generates OpenAPI docs. Equivalent to Spring Boot in Java. |
| Uvicorn | Latest | ASGI server that runs FastAPI. Handles async WebSocket connections properly. |
| SQLAlchemy | 2.x (async) | ORM for database access. Async-compatible with asyncpg. |
| asyncpg | Latest | High-performance async PostgreSQL driver. Required for Neon's SSL connection. |
| python-dotenv | Latest | Loads `.env` file into environment variables. |

### Infrastructure

| Technology | Why |
|---|---|
| Docker + Docker Compose | Reproducible environment. One command to start everything. Eliminates "works on my machine." |
| WSL2 (Ubuntu) | Runs Docker Desktop on Windows without full Linux VM overhead. |
| Neon.tech (PostgreSQL) | Serverless — scales to zero when idle. Free tier generous enough for hackathon. AWS Europe region. |
| NVIDIA NIM API | Hosted Llama 3.1 8B inference. No GPU needed locally. Free credits for developers. |

---

## 4. Data Models

### Database Schema

```sql
-- Tenants (organizations / users of the Atlas platform)
CREATE TABLE tenants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    email        VARCHAR(255) NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- API Keys (each tenant can have multiple keys)
CREATE TABLE api_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash   VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of the raw key
    key_prefix VARCHAR(16) NOT NULL,          -- first 16 chars for identification
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_key_hash  ON api_keys(key_hash);
CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);

-- Usage Logs
CREATE TABLE usage_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id VARCHAR(36)  NOT NULL,
    url        VARCHAR(2048),
    command    TEXT,
    action     VARCHAR(16),   -- click | fill | scroll | focus
    element_id VARCHAR(255),
    timestamp  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Error Logs
CREATE TABLE error_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url        VARCHAR(2048) NOT NULL,
    element_id VARCHAR(255),
    error_type VARCHAR(64)  NOT NULL,  -- missing_alt | missing_aria | missing_label
    suggestion TEXT,
    flagged_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### DOM Node Structure (Extension → Backend payload)

```typescript
// Each element in the dom_map array
interface DomNode {
  id:             string   // e.g. "atlas-1234567890-0" (data-atlas-id attribute)
  tag:            string   // "button" | "a" | "input" | "select" | "textarea"
  type:           string | null  // input type e.g. "text" | "email" | "submit"
  inner_text:     string | null  // visible text (null for password fields)
  placeholder:    string | null
  aria_label:     string | null
  href:           string | null  // for <a> tags
  name:           string | null  // form field name
  role:           string | null  // ARIA role
  resolved_label: string         // best human-readable label (computed by serializer)
  group_label:    string | null  // e.g. "Price Range" for grouped inputs
  tier:           "primary" | "secondary"  // primary = shown by default
}
```

### WebSocket Message Payloads

```json
// Simplify request (Extension → Backend)
{
  "session_id": "uuid-string",
  "api_key": "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://example.com",
  "type": "simplify",
  "command": "",
  "dom_map": [ /* DomNode[] */ ]
}

// Simplify response (Backend → Extension)
{
  "status": "success",
  "elements": [
    { "element_id": "atlas-123", "label": "Add to Cart", "category": "button" }
  ],
  "message": null
}

// Command request (Extension → Backend)
{
  "session_id": "uuid-string",
  "api_key": "atlas_a1b2c3...",
  "url": "https://example.com",
  "type": "command",
  "command": "click checkout",
  "dom_map": [ /* DomNode[] */ ]
}

// Command response / Agentic Action Plan (Backend → Extension)
{
  "status": "success",
  "thought": "Locating and opening the requested item.",
  "steps": [
    {
      "action": "open",
      "element_id": "atlas-row-123",
      "value": null,
      "description": "Double-clicking and activating item"
    }
  ],
  "confirmation_prompt": null,
  "confirmation_options": [],
  "pending_step": null,
  "message": "Opening file..."
}
```

### API Key Authentication Flow

```
Raw key:  atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
          ↓ SHA-256
Hash:     cda8df9e23d13353b387e05afd84b8e70fbd3d0124996dc77a8b1cb622257e4e
          ↓ lookup in api_keys table
Tenant:   Atlas Demo Corp (demo@atlas-saas.com)
```

The raw key never touches the database. Only the hash is stored. This means even if the database is breached, keys cannot be recovered.

---

## 5. Current Status

### ✅ Completed

- [x] Chrome Extension (Manifest V3) — fully functional
- [x] Universal Prime Directive: 100% website-agnostic across Google Drive, Gmail, Amazon, SPAs, etc.
- [x] Dynamic AI Semantic Categorizer (Navigation, Files & Folders, Controls, Inputs, Links)
- [x] Accordion-style collapsible groups (collapsed by default on load)
- [x] Vector SVG Reload button with synchronized UI re-indexing
- [x] Universal Interaction Engine (`doClick` with W3C Pointer/Mouse sequences)
- [x] Universal `doOpen` (full double-click + W3C Enter keyCode 13 for desktop web apps)
- [x] Multi-Step Agentic Action Planner (`agentic_planner.py` with multi-action steps & confirmation dialogs)
- [x] 3-dot wave typing indicator animation during inference
- [x] REST `/v1/chat` & `/v1/audit/log` routes
- [x] DOM serializer with two-tier scoring and robust label resolution
- [x] Voice input via Web Speech API and text-to-speech output
- [x] FastAPI backend running in Docker / standalone
- [x] WebSocket endpoint at `/v1/agent`
- [x] API key authentication via SHA-256 hash lookup in Neon
- [x] PII protection — password fields stripped before leaving browser
- [x] Neon PostgreSQL database initialized and seeded
- [x] Health endpoint (`GET /health`) returning db + llm status
- [x] URL change detection for SPAs
- [x] MutationObserver with pause/resume to prevent re-render loops
- [x] Skeleton loading animation while LLM processes
- [x] CareLink Pharmacy demo site (realistic pharmacy for live demos)
- [x] CORS configured to accept `chrome-extension://` origins
- [x] Docker Compose setup with `.env` support

### Demo API Key (seed data)

```
Raw key:  atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
Tenant:   Atlas Demo Corp (demo@atlas-saas.com)
```

### Working Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | System health check |
| `/v1/agent` | WebSocket | Main agent endpoint |

---

## 6. Roadmap

### Priority 1 — MVP Must-Haves

- [ ] Route chat questions through FastAPI backend to NVIDIA (currently falls back to local labels)
- [ ] Add `chat` message type to WebSocket protocol alongside `simplify` and `command`
- [ ] Send page text content with chat questions so NVIDIA can answer about the page
- [ ] Fix CORS to pin to specific extension ID in production (currently accepts any `chrome-extension://` origin)
- [ ] Deploy backend to Render or Railway so Docker isn't required to use the extension

### Priority 2 — V1 Nice-to-Haves

- [ ] Alembic for proper database migration management (replace raw SQL scripts)
- [ ] Per-session conversation memory (pass message history to NVIDIA for multi-turn chat)
- [ ] Rate limiting on the extension side (prevent NVIDIA API hammering)
- [ ] Options page UX polish — better onboarding for new users
- [ ] Chrome Web Store submission
- [ ] Short-lived session tokens instead of raw API keys in extension storage

### Priority 3 — Future

- [ ] Multi-page browsing agent (follow links, search across the site)
- [ ] Tenant dashboard (usage logs, key management, analytics)
- [ ] Support for Firefox (WebExtensions API is compatible)
- [ ] Mobile browser support
- [ ] Custom per-tenant AI personas ("Hi, I'm the CareLink assistant")
- [ ] Webhook system for usage events

---

## 7. Setup Instructions

### Prerequisites

- Windows with WSL2 (Ubuntu) installed, OR Linux/macOS
- Docker Desktop installed and running
- Chrome or Brave browser
- A NVIDIA NIM API key (free at https://build.nvidia.com)
- A Neon.tech account (free at https://neon.tech)

### Step 1 — Clone the repo

```bash
git clone https://github.com/Abdelrahman-Aboelnour06/Project-Atlas.git
cd Project-Atlas
```

### Step 2 — Configure environment variables

```bash
cd backend
cp .env.example .env  # if example exists, otherwise create .env manually
```

Edit `backend/.env`:

```env
# App
APP_NAME=Atlas API
APP_VERSION=0.1.0
DEBUG=true

# Database — get from Neon.tech dashboard
# IMPORTANT: must use ?ssl=require not ?sslmode=require (asyncpg requirement)
DATABASE_URL=postgresql+asyncpg://username:password@host/dbname?ssl=require

# LLM — get API key from https://build.nvidia.com
LLM_PROVIDER=nvidia_nim
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=meta/llama-3.1-8b-instruct
LLM_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx

# Security
API_KEY_HEADER=X-Atlas-Key
```

### Step 3 — Start the backend

```bash
cd backend
docker compose up --build -d
```

### Step 4 — Initialize the database (first time only)

```bash
# Run this exactly — split into individual statements for asyncpg compatibility
docker compose exec atlas-backend python -c "
import asyncio, os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv
load_dotenv()

statements = [
    '''CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )''',
    '''CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key_hash VARCHAR(64) NOT NULL UNIQUE,
        key_prefix VARCHAR(16) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )''',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id)',
    '''CREATE TABLE IF NOT EXISTS usage_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id VARCHAR(36) NOT NULL,
        url VARCHAR(2048), command TEXT, action VARCHAR(16),
        element_id VARCHAR(255), timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )''',
    'CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_id ON usage_logs(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id)',
    '''CREATE TABLE IF NOT EXISTS error_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        url VARCHAR(2048) NOT NULL, element_id VARCHAR(255),
        error_type VARCHAR(64) NOT NULL, suggestion TEXT,
        flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )''',
    'CREATE INDEX IF NOT EXISTS idx_error_logs_tenant_id ON error_logs(tenant_id)',
]

async def init():
    engine = create_async_engine(os.getenv('DATABASE_URL'))
    async with engine.begin() as conn:
        for stmt in statements:
            await conn.execute(text(stmt))
    await engine.dispose()
    print('Schema created.')

asyncio.run(init())
"
```

### Step 5 — Seed the database

```bash
docker compose exec atlas-backend python -m app.migrations.seed
```

This creates:
- Tenant: `Atlas Demo Corp (demo@atlas-saas.com)`
- API Key: `atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Step 6 — Verify the backend is healthy

```bash
curl http://localhost:8000/health
# Expected: {"service":"atlas-backend","status":"ok","db":"ok","llm":"ok"}
```

### Step 7 — Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `client-script/` folder
5. Click the Atlas icon in the toolbar
6. Go to **Options** and enter the API key: `atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Step 8 — Test the demo site

Open `demo-site/index.html` in Chrome and click the Atlas icon. The sidebar should appear and populate within a few seconds.

### Common Commands

```bash
# Start backend
docker compose up -d

# Stop backend
docker compose down

# View logs
docker compose logs atlas-backend

# Restart after code changes
docker compose down
docker compose up --build -d

# Run inside container
docker compose exec atlas-backend python -m app.migrations.seed

# NOTE: PowerShell does not support &&
# Run commands separately, not chained
```

### Key Gotchas

| Problem | Solution |
|---|---|
| `asyncpg` SSL error | Use `?ssl=require` not `?sslmode=require` in DATABASE_URL |
| Extension not responding after file update | Fully remove and re-add extension in chrome://extensions. Toggle off/on is not enough. |
| `DEFAULT_BASE_URL already declared` error | All content scripts must be wrapped in IIFEs `(function(){ ... })()` to prevent variable collisions on re-injection |
| `&&` not working in terminal | You're in PowerShell. Run commands separately. |
| Docker not starting | Open Docker Desktop first and wait for the whale icon to stop animating |

---

## 8. Contribution Guidelines

### Coding Standards

**JavaScript (Extension)**
- All content scripts wrapped in IIFEs to prevent variable collision
- Public APIs attached to `window.AtlasXxx` (e.g. `window.AtlasSidebar`, `window.AtlasSerializer`)
- All CSS scoped under `#atlas-sidebar-root` to prevent host page conflicts
- No external dependencies — vanilla JS only in the extension

**Python (Backend)**
- Async everywhere — no blocking calls in route handlers
- Environment variables via `.env` and `os.getenv()` — never hardcode secrets
- Use SQLAlchemy async sessions, not raw `asyncpg` calls directly

### Branch Strategy

```
main          — stable, demo-ready
dev           — active development
feature/xxx   — individual features
fix/xxx       — bug fixes
```

### Before Submitting a PR

- [ ] Extension tested on at least two different websites
- [ ] Backend health endpoint returns `ok` for db and llm
- [ ] No secrets committed (check `.env` is in `.gitignore`)
- [ ] IIFEs present on all content scripts
- [ ] CSS changes scoped under `#atlas-sidebar-root`

---

## 9. For AI Agents Specifically

This section is written directly for Claude, GPT, or any AI agent being handed this project.

### What This Project Actually Is

Atlas is a Chrome extension + FastAPI backend that acts as an AI agent layer on top of any website. The extension reads the page DOM, sends it to a backend, the backend calls NVIDIA's Llama 3.1, and the result is either a simplified element list (for the sidebar) or an action to execute on the page (for commands).

### The Single Most Important Thing To Understand

**The `data-atlas-id` attribute is the linking pin of the entire system.**

When `dom-serializer.js` scans the page, it stamps every interactive element with a `data-atlas-id` attribute (e.g. `data-atlas-id="atlas-1234567890-0"`). This ID is sent to the backend as `element_id` in the DOM map. When the backend (via NVIDIA) decides which element to act on, it returns that same `element_id`. Then `executor.js` does `document.querySelector('[data-atlas-id="atlas-xxx"]')` to find and act on the real DOM element.

If this ID chain breaks, nothing works.

### Common Patterns

**Reading a file before editing it:**
Always read the current file content before making changes. The project has evolved significantly from session to session.

**The IIFE pattern:**
Every content script must be wrapped:
```javascript
;(function() {
  // all code here
  window.AtlasXxx = { ... }  // expose public API
})();
```
This prevents `SyntaxError: Identifier already declared` when Chrome re-injects scripts into a page that already has them.

**The pause/resume pattern:**
When executing an action on the page, always pause the MutationObserver first:
```javascript
window.AtlasSerializer.pause()
// ... do DOM action ...
setTimeout(() => window.AtlasSerializer.resume(), 1000)
```
Without this, the DOM change from clicking/focusing an element triggers a full re-render which wipes the sidebar.

**The two-tier system:**
Elements are scored 0-100 by `dom-serializer.js`. Score ≥ 50 = `primary` (shown by default). Score < 50 = `secondary` (shown under "Show more"). Nothing is ever fully discarded. When modifying the serializer, maintain this contract.

### File Ownership — What Touches What

| If you're changing... | Files to look at |
|---|---|
| What elements appear in the panel | `dom-serializer.js` — `scoreElement()`, `NOISE_SELECTORS`, `ALWAYS_SKIP_SELECTORS` |
| How elements are labeled | `dom-serializer.js` — `resolveLabel()` |
| Sidebar appearance / layout | `sidebar.js` + `sidebar.css` |
| What happens when user clicks panel item | `content.js` — `handleElementClick()` |
| What happens when user types a command | `content.js` — `handleChatInput()`, `runCommand()` |
| How the LLM interprets commands | `backend/app/agent/prompt.py` |
| How the LLM simplifies the DOM | `backend/app/agent/simplify_prompt.py` |
| API key validation | `backend/app/routes/agent.py` |
| Database schema | `backend/app/migrations/001_init.sql` |

### Pitfalls To Avoid

1. **Never use `&&` in PowerShell** — this project is developed on Windows. Use separate commands.
2. **Never modify `data-atlas-id` values** — they are generated once per element per page load and must be stable.
3. **Never send password field values to the backend** — strip them in `dom-serializer.js` before serialization.
4. **Never add global `const`/`let` to content scripts outside an IIFE** — Chrome will throw on re-injection.
5. **Always use `?ssl=require` in the Neon DATABASE_URL** — `?sslmode=require` breaks asyncpg silently.
6. **Don't use `docker compose down && docker compose up`** in PowerShell — run them separately.
7. **After replacing extension files**, always fully remove and re-add the extension — toggling off/on keeps old cached scripts in open tabs.

### Where To Look For Specific Things

| Question | Answer |
|---|---|
| "What API key is used for the demo?" | `atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6` — seeded by `migrations/seed.py` |
| "What port does the backend run on?" | 8000 |
| "What's the WebSocket URL?" | `ws://localhost:8000/v1/agent` |
| "Where is the NVIDIA API called?" | `backend/app/agent/simplify_prompt.py` and `prompt.py` |
| "What model is used?" | `meta/llama-3.1-8b-instruct` via NVIDIA NIM |
| "Where is the database connection configured?" | `backend/app/db/connection.py` + `backend/.env` |
| "How does auth work?" | SHA-256 hash of raw key looked up in `api_keys` table |
| "Where is the demo website?" | `demo-site/index.html` — CareLink Pharmacy |
| "What tables exist?" | `tenants`, `api_keys`, `usage_logs`, `error_logs` |

---

*Last updated: July 2026 — Cairo University AI Hackathon build*
*Maintained by: Team Atlas*

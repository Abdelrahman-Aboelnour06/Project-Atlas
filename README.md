# 🧭 Atlas — Master Project Documentation
*Cairo University AI Hackathon — project Atlas

## 📖 PART 1: PROJECT OVERVIEW

### What Atlas Does
Atlas is an AI-powered browser extension that helps elderly and disabled users navigate any website, regardless of how that website was built or how confusing its layout is. 

**The Problem:** Many websites are hard to use for elderly people or people with visual, motor, or cognitive impairments. Buttons are small or unlabeled, layouts are cluttered, and it isn't obvious what's clickable versus what's just decoration. Standard accessibility tools (like screen readers) require technical setup and a learning curve most casual users don't have.

**The Solution:** Atlas sits on top of any website as a browser extension. When the user activates it on a page, Atlas:
1. Scans the page's DOM and finds every interactive element.
2. Sends a simplified map of that page to an AI model, which translates each technical element into a short, plain-language description. (e.g. `<button id="chkout-btn-2">` becomes "Go to checkout").
3. Displays this simplified list in a sidebar next to the page.
4. When the user clicks (or speaks/types) an option, Atlas scrolls to the real element and makes it glow with a soft white highlight.
5. Users can also speak commands (e.g., "click checkout"), and Atlas will resolve that command directly to the correct action.

### Privacy & Safety
Because Atlas's users are a vulnerable group, privacy is a first-class concern:
* **PII Stripping:** Typed-in values for input/password/email fields are stripped/masked before reaching the LLM — only labels/placeholders are sent.
* **Ephemeral Data:** Raw DOM maps and full command texts are not persisted long-term in `usage_logs`.
* **CORS:** WebSocket origin allow-listing restricts requests to the actual Chrome extension origin.

---

## 🏗️ PART 2: SYSTEM ARCHITECTURE

### High-Level Flow
    Chrome Extension (Frontend)                Backend (FastAPI)
    ----------------------------                ------------------
    1. Content script scans DOM
       and tags every interactive
       element with a stable id
       (data-atlas-id="atlas-042")
                |
                v
    2. Sends DOM map over
       WebSocket  ------------------------>  3. Auth check (API key)
                                                       |
                                                       v
                                              4. Build prompt for LLM
                                                 ("simplify" or "command")
                                                       |
                                                       v
                                              5. Call LLM (Ollama / Hosted)
                                                       |
                                                       v
                                              6. Parse + validate LLM response
                                                       |
                                                       v
                                              7. Log to Postgres (usage_logs)
                                                       |
    8. Receive structured        <------------------- response
       response over WebSocket
                |
                v
    9a. Render sidebar               9b. Scroll to element + apply white-light 
                                         highlight, keyed off data-atlas-id

### The Two AI Pipelines
1. **Command pipeline:** (Input: DOM map + command) -> (Output: one structured action like click/fill/scroll/focus).
2. **Simplify pipeline:** (Input: DOM map) -> (Output: array of elements with plain-language labels and categories).

---

## 🤝 PART 3: SHARED CONTRACTS

> **⚠️ CRITICAL:** Element IDs must be synthetic (`data-atlas-id`), not native HTML IDs.

### Contract 1 — WebSocket Message Schema
Message sent **from browser → FastAPI**.
{
  "session_id": "string",
  "api_key":    "string",
  "url":        "string",
  "dom_map":    [ /* see Contract 3 */ ],
  "type":       "simplify | command",
  "command":    "string | null"
}

### Contract 2 — Action JSON Format
Message sent **from FastAPI → browser** (for `type: "command"`).
{
  "status":     "success | error",
  "action":     "click | fill | scroll | focus | none",
  "element_id": "string",
  "value":      "string | null",
  "message":    "string"
}

### Contract 3 — DOM Map Node Structure
{
  "id":          "string",        // data-atlas-id ONLY
  "tag":         "string",
  "type":        "string | null",
  "inner_text":  "string | null",
  "placeholder": "string | null",
  "aria_label":  "string | null",
  "href":        "string | null",
  "name":        "string | null",
  "role":        "string | null"
}

---

## 📋 PART 4: MASTER TASK BOARD

### 🔴 Critical Priority
1. **Backend:** Build the "simplify all elements" pipeline (prompt builder, parser, WS routing).
2. **Frontend:** Task A (DOM Serializer) — built against the `data-atlas-id` contract.
3. **Frontend:** Task J (Sidebar UI) — the headline feature, driven by the simplify pipeline.

### 🟡 Important Priority
4. **Backend:** CORS / extension-origin allow-list.
5. **Frontend:** Task C (WebSocket Client) & Task D (Action Executor w/ glow effect).
6. **Backend:** Task 8 (Error logging endpoint for accessibility issues).
7. **Backend:** PII-stripping pass on the DOM map.
8. **Backend:** Test hosted LLM fallback for demo day.

### 🟢 Easy / Independent Tasks
9. **Frontend:** Task B (Web Speech API) - independent.
10. **Frontend:** Task E (Next.js Dashboard) - independent.
11. **Frontend:** Task F (Demo Target Website).

### MVP Definition of Done
* [ ] "Simplify" pipeline returns valid element lists.
* [ ] `data-atlas-id` is the only ID used across the app.
* [ ] Widget appears on demo site, sidebar auto-populates on load.
* [ ] Clicking sidebar item highlights real element.
* [ ] Voice commands transcribe and execute actions correctly.
* [ ] Dashboard shows tenant API keys and mock sessions.

---

## 🛠️ PART 5: DEVELOPER CONVENTIONS

* **Git Workflow:** Branch naming `team/task-id-desc` (e.g., `backend-a/task3-postgres`). Commits must be imperative.
* **Python (Backend):** PEP 8, `black` formatter (88 chars), type hints everywhere. Use Pydantic models for I/O (no raw dicts).
* **JavaScript (Frontend):** ES6+, 80 chars, kebab-case file names. Strict module boundaries (Serializer owns DOM read, Executor owns DOM write).
* **Next.js:** TypeScript, Tailwind CSS, Server Components/useEffect for data fetching.
* **SQL:** Plural snake_case for tables. Every table must have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at`.

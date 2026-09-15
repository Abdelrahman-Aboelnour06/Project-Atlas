# Atlas — Shared Contracts

> These are locked on Day 1, Hour 0–1.
> **No team writes code until these are committed.**
> Any change requires agreement from all 3 teams.
>
> **v1.2 update:** `id` in Contract 3 is now the synthetic `data-atlas-id`
> injected by the content script — **never** the element's native HTML
> `id`. Contract 1 gained a `type` field so one WS connection can carry
> both the existing "one command → one action" flow and the new
> "simplify the whole page" flow. Contract 5 defines the
> simplify response shape that powers the sidebar (Task J). 
> WS Error handling and `type` requirements have been strictly defined.

---

## Contract 1 — WebSocket Message Schema

Message sent **from the browser snippet → FastAPI backend**.

```json
{
  "session_id": "string",
  "api_key":    "string",
  "url":        "string",
  "dom_map":    [ /* see Contract 3 */ ],
  "type":       "command | simplify",
  "command":    "string"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID generated client-side on each activation |
| `api_key` | `string` | Tenant API key — used to authenticate the request |
| `url` | `string` | Current page URL — used for audit logging |
| `dom_map` | `array` | Serialized DOM nodes — see Contract 3 |
| `type` | `"command" \| "simplify"` | Which pipeline to run. **REQUIRED — no default.** Omitting it makes the whole message invalid (see error handling below). |
| `command` | `string` | Raw transcribed voice command. Required field on every message (send `""` when `type` is `"simplify"`). |

### WebSocket Error Handling

Malformed JSON, a message that fails validation (including a missing/invalid
`type`), and an invalid or inactive `api_key` **all return a JSON reply on
the same connection and keep it open** — they never close the socket with a 4401:

```json
{ "status": "error", "message": "human-readable reason" }
```

This lets the extension retry with a corrected message (or valid API key) without having to
reconnect. The socket only closes on a genuinely unhandled server exception
(WS close code `1011`) or a normal client/browser disconnect.

---

## Contract 2 — Action JSON Format (Single-Action & Multi-Step Agentic Plans)

Message sent **from FastAPI backend → browser snippet**, in response to a `type: "command"` request.

### Multi-Step Agentic Action Plan (Current Standard)

```json
{
  "status": "success | error",
  "thought": "Internal LLM reasoning",
  "steps": [
    {
      "action": "click | open | fill | scroll | focus",
      "element_id": "string",
      "value": "string | null",
      "description": "string"
    }
  ],
  "confirmation_prompt": "string | null",
  "confirmation_options": ["Yes, proceed", "No, cancel"],
  "pending_step": {
    "action": "click | open",
    "element_id": "string",
    "description": "string"
  } | null,
  "message": "Human-readable summary or TTS feedback"
}
```

### Action Types

| Action | Supported Elements | Execution Behavior |
|---|---|---|
| `"click"` | Buttons, links, tabs, checkboxes, toggles | Dispatches W3C `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click` + anchor navigation |
| `"open"` | Files, folders, rows, treeitems, documents | Dispatches W3C double-click sequence (`detail: 1` → 60ms delay → `detail: 2` + `dblclick`) + W3C `Enter` keypress (`keyCode: 13`) |
| `"fill"` | Text inputs, textareas, search fields | Sets prototype value & dispatches `input` + `change` events |
| `"scroll"` | Any page element | Centers element in viewport with accessibility glow effect |
| `"focus"` | Any focusable element | Brings browser keyboard focus and active glow |

### Legacy Single-Action Format (Supported for Backward Compatibility)

```json
{
  "status":     "success | error",
  "action":     "click | open | double_click | fill | scroll | focus",
  "element_id": "string",
  "value":      "string | null",
  "message":    "string"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success" \| "error"` | Whether the AI found a valid action |
| `action` | `"click" \| "open" \| "double_click" \| "fill" \| "scroll" \| "focus"` | The action type to execute |
| `element_id` | `string` | The `data-atlas-id` of the target DOM element (see Contract 3 — **not** the native HTML `id`) |
| `value` | `string \| null` | Value to fill in (only for `fill` action, else `null`) |
| `message` | `string` | Human-readable TTS feedback: e.g. `"Clicked Checkout button"` |

**Error response** (when AI cannot find a matching element):
```json
{
  "status":     "error",
  "action":     null,
  "element_id": null,
  "value":      null,
  "message":    "Could not find an element matching your request."
}
```

---

## Contract 3 — DOM Map Node Structure

Each entry in the `dom_map` array follows this shape:

```json
{
  "id":          "string | null",
  "tag":         "string",
  "type":        "string | null",
  "inner_text":  "string | null",
  "placeholder": "string | null",
  "aria_label":  "string | null",
  "href":        "string | null",
  "name":           "string | null",
  "role":           "string | null",
  "sensitive":      "boolean | null",
  "resolved_label": "string | null",
  "group_label":    "string | null"
}
```

**⚠️ `id` is the synthetic `data-atlas-id`, not the native HTML `id`.**
Most real sites don't have an `id` attribute on their interactive elements.
The content script (Task A) injects `data-atlas-id="atlas-###"` on every
matched element before serializing, then reads that attribute back into
this `id` field. Backend and frontend both key off this value everywhere —
in the DOM map sent up, in `element_id` on actions/simplify results sent
back, and in `document.querySelector('[data-atlas-id="' + id + '"]')` on
the executor side. The native DOM `id` attribute is never read or written
by Atlas.

**Example:**
```json
[
  {
    "id":          "atlas-001",
    "tag":         "button",
    "type":        null,
    "inner_text":  "Proceed to Checkout",
    "placeholder": null,
    "aria_label":  "Proceed to Checkout",
    "href":        null,
    "name":        null,
    "role":        null
  },
  {
    "id":          "atlas-002",
    "tag":         "input",
    "type":        "email",
    "inner_text":  null,
    "placeholder": "Enter your email",
    "aria_label":  "Email address",
    "href":        null,
    "name":        "email",
    "role":        null
  }
]
```

**Rules:**
- Output is a **flat array** — no nested trees
- `null` for any field that doesn't exist on the node
- Strip all CSS classes, inline styles, images, SVGs
- Strip PII patterns from `inner_text` and `placeholder` (email regex, phone regex) — backend also re-applies PII stripping server-side (`app/agent/sanitize.py`) as a second gate before anything reaches the LLM or gets logged
- Only include interactive/semantic elements: `button`, `a`, `input`, `select`, `textarea`, `form`, `[role]`

---

## Contract 4 — API Key Transport

The API key is passed **in the WebSocket message body** as the `api_key` field (see Contract 1), and **in the JSON body** as `api_key` for REST endpoints (see Contract 5) — not as a header, to keep auth handling identical across WS and REST.

- Key format: `atlas_` prefix + 32-char alphanumeric string. Example: `atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
- The backend validates the key on every WebSocket message, not just on connect
- For REST endpoints (e.g. `/v1/audit/log`), pass the key in the JSON body as `api_key`

---

## Contract 5 — Simplify Response & Audit Log (new)

### 5a. Simplify response

Message sent **from FastAPI backend → browser snippet**, in response to a `type: "simplify"` request. Powers Task J's sidebar.

```json
{
  "status":   "success | error",
  "elements": [
    { "element_id": "atlas-001", "label": "Search box",              "category": "input"  },
    { "element_id": "atlas-002", "label": "Proceed to Checkout",     "category": "button" }
  ],
  "message":  "string | null"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success" \| "error"` | Whether the simplify pipeline succeeded |
| `elements` | `array` | One entry per interactive element, `[]` on error |
| `elements[].element_id` | `string` | Matches `id` from the `dom_map` sent (Contract 3) — must exist in that map, hallucinated ids are dropped server-side |
| `elements[].label` | `string` | Short plain-language description, e.g. `"Search box"`, `"Close this popup"` |
| `elements[].category` | `string` | `button \| link \| input \| select \| textarea \| form \| other` |
| `message` | `string \| null` | Error detail when `status` is `"error"`, otherwise `null` |

Frontend caches the last result and only re-sends `type: "simplify"` after a meaningful DOM change — not on every mutation.

### 5b. Audit log endpoint (Task 8)

```
POST /v1/audit/log
```

Request body:
```json
{
  "api_key": "atlas_...",
  "url":     "[https://client-site.com/checkout](https://client-site.com/checkout)",
  "errors": [
    {
      "element_id": "atlas-014",
      "error_type": "missing_alt",
      "suggestion": "Add alt text describing the hero image"
    }
  ]
}
```

Response:
```json
{ "logged": 1 }
```

`element_id` here is also the `data-atlas-id` value (Contract 3), for consistency with every other endpoint. Invalid/inactive `api_key` → `401`.

---

## Contract 6 — WebSocket Handshake & Pre-Authentication (`/v1/agent`)

Dedicated authentication handshake and Origin verification to protect against Cross-Site WebSocket Hijacking (CSWSH) and unthrottled brute-force attempts.

### 6a. CSWSH Handshake
- Browser WebSocket client transmits standard `Origin` header during HTTP upgrade.
- Backend verifies Origin against trusted patterns:
  - `chrome-extension://<id>`
  - `moz-extension://<id>`
  - `http://localhost:<port>` / `http://127.0.0.1:<port>`
  - Omitted Origin (non-browser test clients)
- Untrusted origins are rejected immediately with WS close code `1008` (Policy Violation).

### 6b. Authentication Message
Client sends an explicit `auth` message before issuing operational commands:
```json
{
  "type": "auth",
  "api_key": "atlas_...",
  "correlation_id": "atlas_1726000000000_abc123"
}
```
Response:
```json
{
  "status": "ok",
  "message": "Authenticated",
  "correlation_id": "atlas_1726000000000_abc123"
}
```
If authentication fails:
- Error response returned: `{"status": "error", "message": "Invalid or inactive API key."}`
- After **3 consecutive failed authentication attempts**, backend closes the connection with code `1008`.

---

## Contract 7 — Conversational QA (`POST /v1/chat`)

Conversational question-answering and multi-step action planning endpoint with context injection and prompt-injection fencing.

Request:
```json
{
  "messages": [
    { "role": "user", "content": "How do I purchase items?" }
  ],
  "context": {
    "page_text": "Extracted page text capped to 3000 chars",
    "dom_summary": "Extracted interactive DOM summary"
  }
}
```
Headers:
- `X-Atlas-Key`: API key string
- `Content-Type`: `application/json`

Response:
```json
{
  "reply": "You can click on any item in the list and select checkout.",
  "plan": {
    "type": "plan | conversation | confirmation",
    "steps": [
      {
        "action": "click",
        "element_id": "atlas-001",
        "description": "Click checkout"
      }
    ],
    "requires_confirmation": false
  }
}
```

---

## Contract 8 — Page Summarization (`POST /v1/summary`)

Fast page summarization endpoint providing executive summaries of web pages for older adults.

Request:
```json
{
  "url": "https://example.com/article",
  "page_text": "Clean textual content extracted from page body"
}
```
Headers:
- `X-Atlas-Key`: API key string

Response:
```json
{
  "summary": "This page provides information on prescription renewals...",
  "key_points": [
    "Step 1: Fill out the patient ID",
    "Step 2: Submit the renewal request"
  ]
}
```

---

## Contract 9 — Accessibility Fixes (`POST /v1/fixes`)

Heuristic accessibility fixes endpoint generating automated remedial suggestions for web elements.

Request:
```json
{
  "url": "https://example.com",
  "issues": [
    {
      "element_id": "atlas-001",
      "issue_type": "missing_alt",
      "tag": "img",
      "context": "Hero banner header"
    }
  ]
}
```
Headers:
- `X-Atlas-Key`: API key string

Response:
```json
{
  "fixes": [
    {
      "element_id": "atlas-001",
      "suggested_fix": "Add alt=\"Company logo with tagline\"",
      "code_snippet": "alt=\"Company logo with tagline\""
    }
  ]
}
```

---

## Contract 10 — Extension Internal Runtime Messaging

Chrome runtime message schema between content scripts, options page, and background service worker.

| Message Type | Direction | Payload | Description |
|--------------|-----------|---------|-------------|
| `ATLAS_TOGGLE` | SW → Content | `{ type: "ATLAS_TOGGLE" }` | Toggles the Atlas accessibility sidebar |
| `ATLAS_SOCKET_CONNECT` | Content → SW | `{ type: "ATLAS_SOCKET_CONNECT", baseUrl, apiKey }` | Connects/authenticates background WebSocket |
| `ATLAS_SOCKET_SEND` | Content → SW | `{ type: "ATLAS_SOCKET_SEND", payload, correlation_id }` | Transmits WebSocket payload and returns response mapped by correlation ID |
| `ATLAS_CHAT` | Content → SW | `{ type: "ATLAS_CHAT", baseUrl, apiKey, payload }` | Invokes `/v1/chat` REST endpoint via service worker |
| `ATLAS_OPEN_OPTIONS` | Content → SW | `{ type: "ATLAS_OPEN_OPTIONS" }` | Opens extension options page |

---

## Contract 11 — Client-Side Secret Tokens

Sensitive values (passwords, card numbers, CVV, expiry, SSN, OTP, PIN) are
never transmitted in plaintext. The extension substitutes a token in any
outbound `command` string and in any `value` it received from a prior
response that it needs to echo back. Tokens are opaque strings to the
backend — it never decodes them, only passes them through.

### Token grammar
`{category}` or `{category_N}` (N = 2, 3, ... for the 2nd+ field of the same
category on one page, e.g. a "confirm password" field).

Categories: `password | cc_number | cc_cvv | cc_expiry | cc_name | ssn | otp
| pin | secret` (`secret` is the generic fallback for anything the keyword
regex flags but doesn't classify more specifically).

Regex: `/^\{(password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret)(_\d+)?\}$/`

### Flow
1. Client extracts a sensitive value from the transcribed command (or from a
   typed value) and stores it in the local vault, keyed by
   `(origin, token)`. Storage is persistent — it survives tab close, browser
   restart, and Atlas re-activation, until the user explicitly deletes it.
2. Client sends the tokenized command upstream instead of the raw text.
3. Backend plans normally and may put the token verbatim into a `fill`
   step's `value` field — it is just a string to the LLM/backend.
4. Client's executor detects the token pattern in `value` before calling
   `doFill`, resolves it against the local vault for the current origin, and
   fills the real value.
5. If a token can't be resolved (vault miss — the user deleted it, or it's a
   fresh browser profile), the fill is aborted with a user-facing "please
   re-enter this field" message — Atlas never falls back to asking the LLM
   what the value was.
6. The user manages saved values from the extension's options page: list
   (by origin + category, never by value), delete one, or clear all.

### Server-side defense in depth
`backend/app/agent/sanitize.py` gains a second, independent guard that scans
incoming `command` text for high-confidence raw-secret patterns (13–19 digit
Luhn-valid sequences, SSN-shaped digits, etc.) even though the client should
already have tokenized them. A hit is treated as a client bug: the field is
redacted server-side before it reaches the LLM or any log line, and a
`security_event` is recorded (element/category only, never the value).

---

## Contract 12 — Goal-Directed Execution (Phase 1)

> **v1.0** — Phase 1: same-page Navigator + Verifier loop.
> Phase 2 will add Planner agent, `background.js` GoalStore, and cross-page state.

### Goal Step Request (`POST /v1/chat/goal_step`)

```json
{
  "goal_state": {
    "goal_id": "string",
    "original_goal": "string",
    "milestones": [
      {
        "id": "string",
        "description": "string",
        "status": "pending | active | completed | failed",
        "verification_method": "string (optional)"
      }
    ],
    "hop_count": 0,
    "max_hops": 8,
    "status": "in_progress | completed | failed",
    "plan_steps": []
  },
  "current_url": "string",
  "current_dom": [ /* Contract 3 DomNode[] */ ],
  "last_action_result": "string | null"
}
```

### Goal Step Response

```json
{
  "milestone_status": "in_progress | milestone_complete | goal_complete | goal_failed | requires_confirmation",
  "next_steps": [ /* Contract 2 PlanStep[] */ ],
  "updated_milestones": [ /* Milestone[] */ ],
  "requires_confirmation": false,
  "pending_step": null,
  "confirmation_prompt": null,
  "reply": "string",
  "updated_goal_state": { /* GoalState */ }
}
```

### Safety Guarantees

- **`max_hops`** (default 8): Hard ceiling — goal auto-fails past this and returns
  control to the user with a plain-language explanation.
- **`requires_confirmation`**: Consequential actions (buy, delete, pay, submit, etc.)
  pause for user approval, even mid-goal — inherited unchanged from the existing
  single-page planner gate.
- **Verifier rules-first**: 6 deterministic rules (client execution status, error
  indicators, success indicators, URL transitions, element disappearance, LLM
  fallback) are checked in sequence before any LLM judgment call.
- **No hallucinated IDs**: Navigator validates every `element_id` against the live
  DOM's `valid_ids` set; fuzzy-match recovery via `find_heuristic_match` (score ≥ 0.5)
  for near-misses; unresolvable IDs are silently discarded.

### Agents

| Agent | Module | Calls LLM? | Job |
|---|---|---|---|
| Navigator | `app/agent/navigator.py` | Yes (1 call per hop) | Resolve milestone + current DOM → one concrete `PlanStep` |
| Verifier | `app/agent/verifier.py` | Only if rules are inconclusive | Decide: `in_progress`, `milestone_complete`, `goal_complete`, or `goal_failed` |

---

## Versioning

| Version | Date | Change |
|---------|------|--------|
| v1.0 | Day 1 — Hour 1 | Initial contracts locked |
| v1.1 | Day 2 — Hour 0 | `id` = synthetic `data-atlas-id`, not native `id`; added `type` field to Contract 1; added Contract 5 (simplify response + audit log) |
| v1.2 | Day 2 — Hour 4 | `type` corrected to **required, no default**; WS error-handling defined. |
| v1.3 | Remediation Pass | Added `open` and `double_click` to Contract 2 action types; added `resolved_label` and `group_label` to Contract 3; added Contracts 6–10 (CSWSH handshake, Chat, Summary, Fixes, and Extension internal messaging). |
| v1.4 | Security Pass | Added Contract 11 (Client-Side Secret Tokens & Local Vault). |
| v1.5 | Phase 1 Goal Execution | Added Contract 12 (Goal-Directed Execution — Navigator + Verifier loop, `POST /v1/chat/goal_step`). |
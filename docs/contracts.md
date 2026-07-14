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

## Contract 2 — Action JSON Format

Message sent **from FastAPI backend → browser snippet**, in response to a `type: "command"` request.

```json
{
  "status":     "success | error",
  "action":     "click | fill | scroll | focus",
  "element_id": "string",
  "value":      "string | null",
  "message":    "string"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success" \| "error"` | Whether the AI found a valid action |
| `action` | `"click" \| "fill" \| "scroll" \| "focus"` | The action type to execute |
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
  "name":        "string | null",
  "role":        "string | null"
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

## Versioning

| Version | Date | Change |
|---------|------|--------|
| v1.0 | Day 1 — Hour 1 | Initial contracts locked |
| v1.1 | Day 2 — Hour 0 | `id` = synthetic `data-atlas-id`, not native `id`; added `type` field to Contract 1; added Contract 5 (simplify response + audit log) |
| v1.2 | Day 2 — Hour 4 | `type` corrected to **required, no default** (matches `AgentMessage`); WS error-handling defined — invalid/malformed messages and bad API keys return a JSON error and keep the connection open, they don't close the socket. |
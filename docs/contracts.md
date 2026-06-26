# Atlas — Shared Contracts

> These are locked on Day 1, Hour 0–1.
> **No team writes code until these are committed.**
> Any change requires agreement from all 3 teams.

---

## Contract 1 — WebSocket Message Schema

Message sent **from the browser snippet → FastAPI backend**.

```json
{
  "session_id": "string",
  "api_key":    "string",
  "url":        "string",
  "dom_map":    [ /* see Contract 3 */ ],
  "command":    "string"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID generated client-side on each activation |
| `api_key` | `string` | Tenant API key — used to authenticate the request |
| `url` | `string` | Current page URL — used for audit logging |
| `dom_map` | `array` | Serialized DOM nodes — see Contract 3 |
| `command` | `string` | Raw transcribed voice command from the user |

---

## Contract 2 — Action JSON Format

Message sent **from FastAPI backend → browser snippet**.

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
| `element_id` | `string` | The `id` attribute of the target DOM element |
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

**Example:**
```json
[
  {
    "id":          "checkout-btn",
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
    "id":          "email-input",
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
- Strip PII patterns from `inner_text` and `placeholder` (email regex, phone regex)
- Only include interactive/semantic elements: `button`, `a`, `input`, `select`, `textarea`, `form`, `[role]`

---

## Contract 4 — API Key Transport

The API key is passed **in the WebSocket message body** as the `api_key` field (see Contract 1).

- Key format: `atlas_` prefix + 32-char alphanumeric string. Example: `atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
- The backend validates the key on every WebSocket message, not just on connect
- For REST endpoints, pass the key as a header: `X-Atlas-Key: atlas_...`

---

## Versioning

| Version | Date | Change |
|---------|------|--------|
| v1.0 | Day 1 — Hour 1 | Initial contracts locked |

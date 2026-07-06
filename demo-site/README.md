# Riverbend Market — Atlas Demo Site (Task F)

A small, deliberately messy grocery-store page for testing the Atlas
extension end-to-end. It's a single static file with no build step.

## Run it

```bash
cd demo-site
python3 -m http.server 5500
```

Then open `http://localhost:5500` and activate Atlas from the toolbar.

## What it's built to exercise

| Feature | Where |
|---|---|
| DOM Serializer (Task A) — visible/hidden filtering, synthetic ids | Whole page |
| Simplify pipeline / sidebar labels (Contract 5) | Icon-only search button, the fake `<div>` "Add to cart", unlabeled newsletter inputs — all need the LLM to infer a real label |
| Executor "fill" action (Task D) | `#search-input`, checkout form (`full-name`, `email`) |
| Executor "click" action (Task D) | `Add to cart` buttons, `Proceed to Checkout` |
| PII stripping (`sanitize.py`) | `#card-number` — any typed value must be redacted before it reaches the LLM or `usage_logs` |
| Accessibility audit endpoint (`POST /v1/audit/log`) | Three intentional issues below, matching `error_logs.error_type` |

## Intentional accessibility issues (for the audit-log / Task 8 flow)

1. **`missing_alt`** — the "Heirloom Tomatoes" product image has no `alt`
   attribute at all; the "Sourdough Loaf" image has an empty `alt=""`
   despite being informative content, not decoration.
2. **`missing_aria`** — the 🔍 search button has no accessible name beyond
   an emoji; the "Rainbow Carrots" add-to-cart control is a `<div>` with an
   `onclick`, not a real button, and has no `role`/keyboard support.
3. **`missing_label`** — the newsletter form's email and ZIP inputs rely on
   `placeholder` text only, with no associated `<label>`.

Everything else on the page (search input, checkout form, the two
correctly-labeled product images, the real `<button>` elements) is clean,
so a working Atlas pipeline should treat those normally rather than
flagging them.

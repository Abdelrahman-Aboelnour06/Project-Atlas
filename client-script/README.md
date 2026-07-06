# Atlas Chrome Extension — client-script/

## Load it (dev mode)
1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `client-script/` folder
4. Pin the Atlas icon, click it on any page to activate

## Before it works end-to-end
- Backend must be running at `http://localhost:8000` (see `backend/`).
  Change `DEFAULT_BASE_URL` in `content.js` if it's elsewhere.
- Run `backend/app/migrations/seed.py` to get a demo API key
  (`atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`), or generate your own.
- First activation prompts for the API key and stores it in
  `chrome.storage.local` — you only enter it once per browser profile.

## File ownership (see docs/conventions.md)
| File | Owns |
|---|---|
| `dom-serializer.js` | DOM reading, `data-atlas-id` tagging (Task A) |
| `websocket-client.js` | The socket only (Task C) |
| `executor.js` | DOM writing — click/fill/scroll/focus + glow (Task D) |
| `sidebar.js` / `sidebar.css` | Sidebar UI (Task J) |
| `speech.js` | Web Speech API, audio only (Task B) |
| `content.js` | Orchestrator — wires the above together, no DOM logic of its own |
| `background.js` | Toolbar icon click → toggle message to content script |

## Known gaps / next steps
- Sidebar currently falls back to `inner_text` / `aria_label` for labels
  since the backend's "simplify" pipeline (README Part 4, item 1) isn't
  built yet. Swap `sidebar.js#labelFor` / `#categoryFor` for real
  simplify-pipeline output once that endpoint exists.
- No options page yet for re-entering/rotating the API key — it's a raw
  `window.prompt()` on first activation. Fine for demo day, worth a real
  UI before anyone else uses it.
- `manifest.json` has no icon set — add `icon128.png` before Chrome Web
  Store submission (not required for unpacked/dev loading).

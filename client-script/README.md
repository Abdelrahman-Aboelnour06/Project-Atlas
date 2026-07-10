# Atlas Chrome Extension — client-script/

## Load it (dev mode)
1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `client-script/` folder
4. Pin the Atlas icon, click it on any page to activate

## Before it works end-to-end
- Backend must be running at `http://localhost:8000` (see `backend/`).
  Change the backend URL in Atlas's **options page** if it's elsewhere
  (right-click the toolbar icon → "Options", or `chrome://extensions` →
  Atlas → "Extension options").
- Run `backend/app/migrations/seed.py` to get a demo API key
  (`atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`), or generate your own.
- First activation with no saved key opens the options page automatically
  — paste the key there, save, then click the toolbar icon again. The key
  is stored in `chrome.storage.local` and only needs to be entered once
  per browser profile.

## File ownership (see docs/conventions.md)
| File | Owns |
|---|---|
| `dom-serializer.js` | DOM reading, `data-atlas-id` tagging (Task A) |
| `websocket-client.js` | The socket only (Task C) — includes `sendCommand()` and `sendSimplify()` |
| `executor.js` | DOM writing — click/fill/scroll/focus + glow (Task D) |
| `sidebar.js` / `sidebar.css` | Sidebar UI (Task J) |
| `speech.js` | Web Speech API, audio only (Task B) |
| `content.js` | Orchestrator — wires the above together, no DOM logic of its own |
| `background.js` | Toolbar icon click → toggle message; relays "open options page" |
| `options.html` / `options.js` / `options.css` | Settings UI — API key + backend URL |

## What changed since the initial scaffold
- **Simplify pipeline is wired up.** The backend's `type: "simplify"` route
  (Contract 5) now exists, so `content.js` calls
  `AtlasSocket.sendSimplify()` on load and after every debounced DOM
  mutation, and hands the plain-language `{element_id, label, category}`
  results to `sidebar.js#renderElements()`. The old `inner_text` /
  `aria_label` / `placeholder` heuristic is still there as
  `AtlasSidebar.deriveDisplayItems()` — it renders instantly while the
  simplify call is in flight, and is the fallback if that call errors or
  times out, so the sidebar is never blank.
- **Real options page.** First activation with no stored key now opens
  `options.html` (via `chrome.runtime.openOptionsPage()`) instead of a raw
  `window.prompt()`. It supports viewing/hiding the key, clearing it, and
  overriding the backend URL — all persisted to `chrome.storage.local`.
- **Icons added.** `icons/icon16.png`, `icon48.png`, `icon128.png` are in
  place and referenced from `manifest.json`, so the toolbar and
  `chrome://extensions` no longer show a blank/default icon.

## Known gaps / next steps
- No rate limiting on the simplify call — a very "chatty" SPA that mutates
  the DOM constantly could trigger frequent LLM calls. The 300ms debounce
  in `dom-serializer.js#observe()` covers the common case; consider adding
  a minimum interval between simplify calls if that turns out to be an
  issue on real sites.
- Icons are a simple generated placeholder (compass mark on the sidebar's
  navy), not final brand art — swap before any Chrome Web Store
  submission.

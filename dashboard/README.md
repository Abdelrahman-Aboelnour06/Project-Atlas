# Atlas Dashboard (Task E)

Next.js + TypeScript + Tailwind tenant dashboard. Independent of the
extension pipeline (Tasks A/B/C/D/J) — no shared code, just the contracts
in `docs/contracts.md` for when it's wired to the real API.

## Run it

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000` — any email/password on the sign-in page
drops you into `/dashboard` (mock auth only, no real backend call yet).

## What's here

- `app/page.tsx` — mock sign-in
- `app/dashboard/page.tsx` — API keys, recent sessions, flagged
  accessibility issues
- `components/` — `ApiKeyCard`, `SessionsTable`, `ErrorsPanel`, `Header`
- `lib/mock-data.ts` — data shaped to match `backend/app/db/models.py`
  exactly (`Tenant`, `ApiKey`, `UsageLog`, `ErrorLog`), so swapping mock
  data for real `fetch()` calls later is a reshape-free change

## Design notes

Body copy uses **Atkinson Hyperlegible** (designed by the Braille
Institute for maximum character distinction) as the dashboard's actual
default font, not just an "accessibility mode" — the idea being that
Atlas's own internal tool should hold itself to the same legibility bar
as the product it ships. Headings use **Space Grotesk**. Visible focus
rings are global (`app/globals.css`), not per-component.

## Not built yet

- No real authentication — `app/page.tsx`'s form just redirects
- No live data fetching — everything reads from `lib/mock-data.ts`
- No "generate new key" backend call — the button in `app/dashboard/page.tsx`
  is currently a no-op; there's no `POST /v1/tenant/keys` endpoint yet on
  the backend to call

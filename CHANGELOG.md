# Changelog

All notable changes to Project Atlas will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Comprehensive Remediation Pass

### Fixed
- **P0 Blocker**: Defined missing `scrollToElement` helper in `client-script/executor.js`, fixing runtime `ReferenceError` on all automated element interactions.
- **Security (XSS)**: Replaced unescaped `innerHTML` string interpolation in `requestConfirmation` (`client-script/executor.js`) with safe DOM node construction.
- **Security (CSWSH)**: Added HTTP `Origin` header validation to `/v1/agent` WebSocket endpoint (`backend/app/routes/agent.py`) to block Cross-Site WebSocket Hijacking.
- **Security (Auth Brute-Force)**: Enforced immediate socket disconnection with WS code 1008 after 3 consecutive failed authentication attempts on `/v1/agent`.
- **Stability (Connection Pool Exhaustion)**: Eliminated `AsyncSession` dependency injection from long-lived `/v1/agent` WebSocket handler; introduced on-demand `get_db_context()` to release sessions immediately.
- **Security (SSRF)**: Removed dead `ATLAS_PROXY_FETCH` message handler from service worker (`client-script/background.js`).
- **Security (CVE)**: Upgraded `next` to `^14.2.36` and `postcss` to `^8.4.40` in `dashboard/package.json`, mitigating GHSA-p293-qw3h-jr36 remote code execution.
- **Secrets Hygiene**: Replaced live cloud credentials in `backend/.env` with safe placeholders and added root and backend `.dockerignore` files.
- **Universal Rule Compliance**: Stripped vendor-specific Amazon selectors (`#nav-global-location-popover-link`, etc.) and Google Drive strings from `dom-serializer.js` and `sidebar.js`, enforcing 100% universal W3C ARIA heuristics across all sites.

### Added
- **Older-Adult Accessibility**:
  - Enforced WCAG AA compliant contrast (`#137333`, >4.5:1) on `.atlas-chip-confirm`.
  - Replaced 12px traffic light button with 44x44px target with permanently visible glyph to prevent tremor drag.
  - Removed all 8 `outline: none` declarations and added universal 3px high-visibility focus indicators.
  - Added `role="log"` and `aria-live="polite"` to chat log.
  - Hoisted `.atlas-status` out of elements pane to remain active across all tabs.
  - Added confirmation safeguard before clearing API keys in `options.js`.
- **Performance & Concurrency**:
  - Added in-memory monotonic `TTLCache` (300s TTL) and offloaded PBKDF2 hashing via `asyncio.to_thread` in `connection.py`.
  - Added `correlation_id` tracking and Map-based routing in `background.js` to eliminate multi-tab response desynchronization.
  - Replaced `cloneNode(true)` in `content.js` with non-allocating `TreeWalker` capped at 3,000 characters.
  - Implemented two-phase layout-safe serialization in `dom-serializer.js` to eliminate forced layout reflow thrashing.
- **Contracts & Architecture**:
  - Reconciled action vocabulary to include `open` and `double_click` across backend models, parsers, executor, and dashboard.
  - Added `resolved_label` and `group_label` to `DomNode` schema and sanitization pipeline.
  - Documented Contracts 6–10 in `docs/contracts.md`.

## [0.1.0] - 2026-09-12

### Added
- Initial project architecture: FastAPI backend, Chrome MV3 extension, Next.js dashboard.
- Command and simplify AI pipelines.
- Neon PostgreSQL connection and usage logging.

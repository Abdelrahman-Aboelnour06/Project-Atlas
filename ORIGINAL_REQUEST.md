# Original User Request

## Initial Request — 2026-09-12T22:54:15Z

Execute the complete, prioritized remediation plan from the Project Atlas comprehensive audit across the FastAPI backend, Chrome MV3 extension, and Next.js dashboard to resolve all P0 blockers, older-adult accessibility barriers, performance/concurrency bottlenecks, documentation gaps, refactoring defects, and security vulnerabilities.

Working directory: c:\Users\abdel\OneDrive\Desktop\Hackthon\shit2
Integrity mode: demo

## Verification Resources
- `run_ci.ps1` / `run_ci.sh`: Complete 4-tier regression suite (Security, Unit, Module, System).
- `backend/tests/`: 129+ automated tests (`pytest tests/`).
- `client-script/test_extension.js`: 58+ Chrome extension tests (`node client-script/test_extension.js`).
- `dashboard/`: Dependency vulnerability scanner (`npm audit`).

## Requirements

### R1. P0 Critical & Blocker Remediations
- Define the missing `scrollToElement` helper in `client-script/executor.js` to restore element interaction functionality.
- Eliminate DOM-based XSS in `client-script/executor.js` by replacing unescaped `innerHTML` with safe DOM nodes.
- Guard the `/v1/agent` WebSocket endpoint against Cross-Site WebSocket Hijacking (CSWSH) and unthrottled authentication brute-force by verifying the HTTP `Origin` header and enforcing connection disconnects on repeated auth failures.
- Resolve database connection pool exhaustion by removing `AsyncSession` dependency injection from the long-lived WebSocket route in `backend/app/routes/agent.py` and acquiring sessions on demand.
- Remove the dead `ATLAS_PROXY_FETCH` handler from `client-script/background.js` to eliminate the open SSRF attack surface.
- Upgrade `next` in `dashboard/package.json` to `>=14.2.36` to patch critical unauthenticated RCE on Windows hosts (GHSA-p293-qw3h-jr36) and related CVEs.
- Sanitize `backend/.env` to eliminate plaintext live cloud credentials, and add a `.dockerignore` preventing secret leakage during container builds.

### R2. Older-Adult Accessibility & Usability Hardening
- Enforce WCAG AA minimum 4.5:1 contrast on all controls, specifically replacing the 2.23:1 green background on `.atlas-chip-confirm` with `#137333`.
- Remove all `outline: none` styles across `sidebar.css` and enforce a universal 3px high-visibility focus indicator for keyboard navigation.
- Replace the 12×12px traffic light close button with a permanent 44×44px close target with visible `✕` glyph, preventing accidental window dragging for users with hand tremors.
- Add `role="log"` and `aria-live="polite"` to `#atlas-chat-log`, and hoist `.atlas-status` out of `#atlas-pane-elements` so status updates remain visible and audible across both tabs.
- Add confirmation safeguards before clearing saved API keys in `options.js` and wrap destructive actions in confirmations.

### R3. Performance, Concurrency & Stability Optimizations
- Introduce an in-memory TTL authentication cache (`TTLCache`) and offload PBKDF2 hashing to worker threads via `asyncio.to_thread` to prevent the 34ms event loop freeze per message.
- Attach unique correlation IDs to extension messages in `client-script/background.js` and match responses via a Map to eliminate multi-tab response collisions and FIFO desyncs.
- Eliminate forced synchronous layout reflow thrashing in `dom-serializer.js` by separating DOM text reads from synthetic `data-atlas-id` writes.
- Replace `document.body.cloneNode(true)` in `content.js` with a non-allocating `TreeWalker` capped at 3,000 characters.

### R4. Refactoring & Universal Rule Compliance
- Reconcile action vocabulary divergence across backend schemas (`models/action.py`), parsers (`parser.py`), planner (`agentic_planner.py`), executor (`executor.js`), and dashboard (`SessionsTable.tsx`) to support `click`, `open`, `double_click`, `fill`, `scroll`, and `focus`.
- Eliminate hardcoded Amazon selectors and Google Drive text strings from `dom-serializer.js` and `sidebar.js`, replacing them with W3C ARIA semantic heuristics to comply with the Prime Directive.
- Add `resolved_label` and `group_label` to `DomNode` and enforce them in `sanitize.py`.
- Delete orphaned model duplicates in `backend/app/migrations/`.

### R5. Documentation & Verification Assets
- Apply the root `README.md` revamp, `backend/README.md`, `CHANGELOG.md`, and missing contracts (Contracts 6–10 in `docs/contracts.md`).
- Document all core public functions in `llm_client.py`, `agentic_planner.py`, and client scripts with standard docstrings and JSDoc headers.

## Acceptance Criteria

### Security & Operational Integrity
- [ ] `node client-script/test_extension.js` passes with 0 failures and confirms no `innerHTML` injection in `executor.js`.
- [ ] `pytest tests/test_security_resilience.py` passes 100% and tests verify CSWSH origin rejection.
- [ ] WebSocket connections do not hold checked-out database sessions after authentication.
- [ ] `npm audit` in `dashboard/` confirms high/critical CVEs in `next` and `postcss` are resolved.

### User Experience & Universal Standards
- [ ] All interactive buttons and inputs meet WCAG 2.5.5 minimum 44×44px touch targets.
- [ ] Contrast ratio on `.atlas-chip-confirm` exceeds 4.5:1 against text.
- [ ] Keyboard focus ring is visible on every element when tabbing.
- [ ] No hardcoded domain strings or vendor selectors exist in `dom-serializer.js` or `sidebar.js`.

### Test Suite Passing
- [ ] All 129+ backend tests pass (`pytest tests/`).
- [ ] `run_ci.ps1 -Stage all` passes all 4 tiers (Security, Unit, Module, System).

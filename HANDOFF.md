# Project Atlas — Transition Handoff

## 1. Goal
Complete the Atlas 5-wave hardening plan (universal navigation, UX accessibility, CI test gate, closed Shadow DOM, resilience packaging) and stabilize local developer stack startup (`run_atlas.sh`).

## 2. Current State
- Repository: `Abdelrahman-Aboelnour06/Project-Atlas` at HEAD `d7dd375` [verified].
- Backend tests: 659 pass (`LLM_PROVIDER=mock pytest backend/tests`) [verified].
- Frontend/JS tests: 349 pass baseline, 396 pass with Wave 0 suites added [verified].
- Playwright E2E (`ci/e2e/harness.js`): not run, requires Chromium extension runtime [claimed/unverified].
- Replay test flakiness: 0 failures across 1,000 consecutive runs post-fix (previously 1–2% flaky) [verified].
- CI test coverage: `ci/verify_all_tests_run.py` enforces 35/35 backend files and 9/9 JS suites [verified].
- Shadow DOM: closed shadow root isolation committed in `sidebar.js`, test adapters in progress [verified].
- Local setup: Docker build DNS failures and `atlas_db` PostgreSQL container creation errors unresolved on host [claimed/unverified].

## 3. What Worked
- **Flake Hunter fix (`backend/app/agent/llm_client.py`)**: Anchored 2FA/OTP keyword detection with `\b` regex boundaries and stripped hex nonces, eliminating false blocker triggers [verified].
- **Replay isolation fixture (`backend/tests/conftest.py`)**: Autouse fixture resetting mock state and rate-limiter queues between iterations [verified].
- **CI test gatekeeper (`ci/verify_all_tests_run.py`)**: AST-based test execution validator ensuring zero omitted test suites in `run_ci.sh`, `run_ci.ps1`, and `.github/workflows/ci.yml` [verified].
- **Sidebar APG dialog accessibility (`client-script/sidebar.js`)**: Focus trap clamping, initial `aria-expanded="true"`, and Escape key collapse handler [verified].
- **Closed Shadow DOM mount (`client-script/sidebar.js`)**: `host.attachShadow({ mode: "closed" })` with `adoptedStyleSheets` and `window.__atlasShadowRoot` test hook [verified].
- **DOM serializer filtering (`client-script/dom-serializer.js`)**: Explicitly skipping `#atlas-sidebar-host` so extension markup never pollutes LLM DOM maps [verified].

## 4. What Didn't Work / Was Ruled Out
- **Unanchored substring matching for auth blockers**: Scanning raw prompts for `"2fa"` collided with CSPRNG boundary nonces (e.g. `BOUNDARY_ID: a1c1b6b2fae7`); ruled out random seed or Jev judge bugs [verified].
- **Light DOM sidebar CSS isolation**: CSS prefixes failed to prevent host-page leaks (e.g. `* { font-size: 40px !important; }` or RTL direction on `<html>`); light DOM abandoned for closed Shadow DOM [verified].
- **Direct `document.getElementById` in test harnesses under closed Shadow DOM**: External scripts cannot query shadow children directly; tests must use `window.__atlasShadowRoot` or `AtlasSidebar.getRoot()` [verified].
- **Running migration `002_enable_rls.sql` unconditionally**: Script has a UTF-8 BOM (`EF BB BF`) [verified] and enforces `app.current_tenant_id` which the application never sets; must be skipped [claimed/unverified].
- **Re-running non-idempotent policies in `003_security_events.sql`**: `CREATE POLICY` fails on repeat runs without `IF NOT EXISTS` or conditional checks [claimed/unverified].
- **Unprivileged docker execution on Linux without group setup**: Plain `docker` returns permission denied when user is not in `docker` group; requires sudo fallback [claimed/unverified].

## 5. In Progress
- **Stopping point**: Wave 1 implementation underway. Shadow DOM isolation is committed to code; Playwright and challenger stress suites (`ci/e2e/ui_sidebar_behavior.js`, `client-script/test_w0_challenger_stress.js`) are being adapted to evaluate queries via `window.__atlasShadowRoot` [verified].
- **`run_atlas.sh` rewrite**: Refactored bash script drafted with sudo re-exec, docker fallback, `CREATE DATABASE` check, idempotent migrations (001 always, 003 once, 002 skipped), and pip timeouts; bash syntax validated via `bash -n`, execution not yet tested [claimed/unverified].

## 6. Next Steps
1. **Complete Wave 1 test harness adaptation**: Update remaining DOM lookups in `client-script/test_w0_challenger_stress.js` and `ci/e2e/ui_sidebar_behavior.js` to use `window.__atlasShadowRoot`, verifying immunity against `* { font-size: 40px !important; }`.
2. **Deliver Wave 1 U6 Setup Wizard**: Build 3-step setup modal in `client-script/options.html` and `options.js` with live `GET /health` connectivity check and input validation.
3. **Add Wave 1 E1 Enterprise Fixtures & J1 Benchmark**: Create `healthcare-intake.html`, `finance-statement.html`, and `checkout.html` in `demo-site/`; create `backend/tests/bench_hops.py` to measure empirical p50/p95 latency.
4. **Test rewritten `run_atlas.sh` with `pgserver`**: Install `pgserver` to supply embedded PostgreSQL binaries, stub docker/sudo, and verify test matrix (fresh DB, missing DB, port in use, idempotent rerun).
5. **Execute Wave 2 (Core UX)**: Implement milestone progress strip with always-visible Stop button (`sidebar-progress.js`), WCAG typography tokens (>=14px floor, >=44px hit targets), and Alt+A shortcut.
6. **Execute Wave 3 & 4 (Packaging, A11y & Truth-Pass)**: Create `package_extension.sh` (hardened CSP, no test files), run automated `axe-core` audit, and remove outdated `INTEGRATION.md`.

## 7. Open Decisions That Need the User
- **Docker vs Local PostgreSQL**: Does the host user have sudo privileges or membership in the `docker` group to manage `atlas-pg`, or should `run_atlas.sh` default to an embedded/local PostgreSQL instance?
- **Docker build DNS configuration**: Confirm whether updating `/etc/docker/daemon.json` with `{"dns": ["8.8.8.8"]}` or using `network: host` in `backend/docker-compose.yml` resolves host pip install timeouts.
- **RLS Migration Policy (002)**: Confirm if multi-tenant RLS in `002_enable_rls.sql` is formally deferred until application-level tenant context setting is implemented.

## 8. Files to Attach to the New Chat
Saved files in `outputs/` (mirrored for environment persistence):
- `outputs/atlas_work.patch`: Complete git diff of all tracked changes across backend, client-script, and CI configurations [verified].
- `outputs/run_atlas.patch`: Target patch of `run_atlas.sh` changes [verified].
- `outputs/git_status.txt`: Snapshot of modified and untracked files [verified].
- `HANDOFF.md`: This transition brief.
- Key specification files in repo: `docs/final_plan.md`, `AGENTS.md`, `backend/app/agent/verifier.py` (Rules 4/5/6 sacred).

---
**Single Next Action to Take First**:
Run `node client-script/test_w0_challenger_stress.js` and update any direct `document.getElementById('atlas-sidebar-root')` calls to `window.__atlasShadowRoot.getElementById('atlas-sidebar-root')` so the closed Shadow DOM suite passes 100% green.

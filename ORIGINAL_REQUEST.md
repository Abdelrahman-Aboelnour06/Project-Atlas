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

## Follow-up — 2026-09-13T10:33:52Z

Perform a comprehensive multi-agent security and resilience audit across the entire Project Atlas codebase, delivering an evidence-backed master report, attack chains, resilience analysis, and prioritized remediation plan without modifying production code.

Working directory: c:\Users\abdel\OneDrive\Desktop\Hackthon\shit2
Integrity mode: development

## Requirements

### R1. Independent Multi-Perspective Security & Resilience Audit
Execute an in-depth audit of the full codebase across 7 specialized domains without pre-filtering or partitioning:
1. **Identity & Access**: Authentication, JWT validation/tampering, IDOR, session lifecycle, RLS/database rules, authorization across privilege levels.
2. **Secrets & Data Exposure**: Bundled client assets, server-to-client serialization leaks, git history, storage buckets, PII/metadata retention, cloud/LLM credentials.
3. **Injection & Runtime Exploitation**: Injection vectors (SQL/NoSQL/command/template), XSS, code execution, unsafe deserialization, path traversal, SSRF, TOCTOU/race conditions, runtime logic bypasses.
4. **Supply Chain & Dependencies**: Direct & transitive dependency vulnerabilities, package freshness/staleness, typosquatting/hallucination checks against registries, pipeline integrity, prompt injection surfaces in LLM tool calling.
5. **Configuration & Infrastructure**: Security headers (CSP, HSTS, etc.), CORS, CSRF, rate limiting, debug modes, Docker/container configurations, IAM permissions, TLS/crypto primitives.
6. **Resilience & Blast-Radius**: Single points of failure (cloud, DNS, CDN, auth, DB), co-located monitoring/alerting, configuration change safety, graceful degradation, rollback & backup feasibility.
7. **Adversarial QA & Red Teaming**: Chain multi-vulnerability exploits across subagent findings, recalibrate severities based on practical exploitability, and identify unclassified edge-case flaws.

### R2. Strict Non-Destructive Audit Constraints
- **Audit only**: Do not alter codebase files or modify production/configuration code during the audit.
- **Evidence-backed**: Every finding must cite a specific file, line number, configuration block, or dynamic request/response evidence. Uncertain items must be flagged as "Needs manual review".
- **Safe verification**: Verification payloads must be benign canary markers only; never execute destructive tests.

### R3. Synthesized Deliverables & Actionable Output
Consolidate findings into a single structured master audit report artifact containing:
- **Executive Summary**: Risk posture, top 3 most critical threats, and identified attack chains.
- **Master Findings Table**: Vulnerability | Location (file & line) | Severity (Critical/High/Medium/Low/Info) | CWE/OWASP Reference | Found By | Verified Behaviorally (Y/N).
- **Resilience Findings Table**: Single Point of Failure | Location | Blast Radius | Recommended Mitigation.
- **Attack Chains & Exploitation Paths**: Concrete multi-step exploit chains linking multiple findings.
- **Prioritized Remediation Plan**: Fix strategy, estimated effort (<1h, 1-4h, >4h), and breaking change risk for each issue.
- **Quick Wins**: High-impact hardening fixes requiring <30 minutes to implement.
- **CI / Regression Prevention Checklist**: Concrete test criteria and lint/static rules to enforce in CI.
- **Needs Manual Review**: Items requiring live production infrastructure, external secret access, or human business decisions.

## Acceptance Criteria

### Audit Rigor & Quality
- [ ] Every repository directory (`backend/`, `client-script/`, `dashboard/`, `demo-site/`, deployment scripts, and configs) is audited across all 7 domains.
- [ ] 100% of reported vulnerabilities include exact file paths, line ranges, or configuration references.
- [ ] No speculative findings: every unverified finding is explicitly tagged as "Needs manual review" rather than asserted as confirmed.
- [ ] Zero code files modified in the repository working directory.

### Synthesis & Actionability
- [ ] Master report provides a unified, deduplicated findings table with verified behavioral flags.
- [ ] At least one end-to-end attack chain analysis is synthesized if compound vulnerabilities exist.
- [ ] Separate resilience table detailing blast radii and graceful degradation failures.
- [ ] Actionable remediation plan categorized by severity and effort with explicit breaking change warnings.
- [ ] CI prevention checklist includes concrete test criteria or rule configurations.

## Follow-up — 2026-09-15T18:55:57Z

Implement Phase 1 of Atlas Goal-Directed Multi-Step Execution: build the core Pydantic contracts, mock LLM provider, and the same-page Navigator and Verifier multi-agent pipeline with deterministic outcome verification.

Working directory: c:\Users\abdel\OneDrive\Desktop\Hackthon\shit2
Integrity mode: demo

## Requirements

### R1. Multi-Step Goal Contracts & Mock LLM Provider (Stage 0)
- Define Milestone, GoalState, GoalStepRequest, and GoalStepResponse Pydantic models extending existing AgenticPlan and PlanStep contracts.
- Add a deterministic mock provider in backend/app/agent/llm_client.py capable of returning predictable responses for multi-step execution without external network calls.
- Support per-role model configuration (PLANNER_LLM_MODEL, NAVIGATOR_LLM_MODEL, VERIFIER_LLM_MODEL), falling back to LLM_MODEL.

### R2. Same-Page Navigator & Verifier Agent Pipeline (Phase 1)
- For Phase 1, treat the entire user goal as a single implicit milestone — do not implement goal decomposition; that belongs to Phase 2's Planner.
- Implement the Navigator agent (extending backend/app/agent/agentic_planner.py) to resolve the active milestone into concrete, DOM-validated PlanSteps on the current page.
- Implement the Verifier agent to evaluate post-action outcomes against observable signals (URL change, DOM element appearance/disappearance) to output milestone_complete, in_progress, goal_complete, or goal_failed.
- Prioritize deterministic rules-first verification before falling back to LLM evaluation.
- Wire the goal_step handler into the REST router in backend/app/routes/chat.py (e.g. POST /v1/chat/goal_step), sitting directly alongside the existing /v1/chat agentic planner endpoint.

### R3. Safety Guardrails & Zero Regressions
- Enforce strict max_hops boundary (default 8) to terminate runaway loops with clear user messaging.
- Preserve the existing requires_confirmation human-in-the-loop gate for any consequential action step.
- Ensure 100% adherence to the Prime Directive (universal web standards, zero site-specific hacks).
- Maintain all existing tests in the test suite passing with zero regressions (baseline verified dynamically at run time).

## Acceptance Criteria

### Contracts & Mock Provider
- [ ] Pydantic models (Milestone, GoalState, GoalStepRequest, GoalStepResponse) pass unit tests for round-trip serialization and schema validation.
- [ ] LLM_PROVIDER=mock returns deterministic canned responses suitable for automated testing.
- [ ] Per-role model environment variables correctly route requests to their respective configurations.

### Navigator & Verifier Pipeline
- [ ] POST /v1/chat/goal_step endpoint processes GoalStepRequest and returns contract-compliant GoalStepResponse.
- [ ] Navigator resolves the implicit single milestone against page DOM without hallucinating element IDs.
- [ ] Verifier correctly identifies milestone_complete or goal_complete upon expected DOM mutation or URL transition.
- [ ] Verifier accurately flags failure when an action produces an unexpected state or times out.
- [ ] Consequential actions pause and populate requires_confirmation and confirmation_prompt.

### Safety & Test Verification
- [ ] Execution gracefully aborts with goal_failed status when hop_count exceeds max_hops.
- [ ] Comprehensive unit and integration test suite covers happy paths, verification failures, and safety limit cutoffs.
- [ ] All tests in the existing backend and extension test suites continue to pass with zero regressions.



## Follow-up — 2026-10-02T09:14:48Z

Complete the remaining integration and end-to-end verification tracks for Atlas v2: integrate the new Planner, Scout, and Form Filler agents into the chat.py execution loop (Track 1m), and establish the Playwright E2E extension harness (Track 1l).

Working directory: /media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2
Integrity mode: development

## Requirements

### R1. Integrate Planner, Scout, and Form Filler into chat.py (Track 1m)
- In `backend/app/routes/chat.py`, on the first hop of a goal when `goal_state.milestones` is empty, call `planner.plan_goal()` to generate milestones instead of the legacy single implicit milestone (Defect C fix).
- In the perception phase of `goal_step_endpoint`, execute `scout.classify_page()` concurrently with `verify_step_outcome()` and store `goal_state.page_kind`.
- When `goal_state.page_kind == "form"`, invoke `form_filler.plan_form_fill()` to generate a `FormPlan` using profile hints from `secret_vault.js` / defaults, emitting tokenized inputs and holding back `submit_ref`.
- Handle blockers (`otp`, `captcha`) by setting `goal_state.status = "awaiting_user_input"` and populating `goal_state.awaiting`.
- Hard rule: Do NOT touch Rules 4, 5, or 6 in `backend/app/agent/verifier.py`.

### R2. Playwright E2E Extension Test Harness (Track 1l)
- Create `ci/e2e/harness.js` that launches headless Chromium with the unpacked extension via `chromium.launchPersistentContext` specifying `channel: 'chromium'`.
- Verify extension loads correctly, background service worker responds, and `demo-site/index.html` navigates without errors.

## Acceptance Criteria

### Integration Tests (Track 1m)
- [ ] `LLM_PROVIDER=mock pytest backend/tests/test_goal_pipeline.py -v` passes with newly added integration tests asserting multi-milestone planning, page classification, and form fill plan execution.
- [ ] Full backend test suite `LLM_PROVIDER=mock pytest backend/tests -q` passes with >= 444 tests and zero regressions.

### E2E Harness (Track 1l)
- [ ] Running `node ci/e2e/harness.js` launches Chromium with the extension loaded, navigates to `demo-site/index.html`, and verifies service worker connectivity.

### Code & Specification Integrity
- [ ] Zero domain or website-specific hardcoding (Universal Directive).
- [ ] All 6 existing frontend test suites continue to pass (`test_extension.js`, `test_secret_vault.js`, `test_dom_serializer_v2.js`, `test_goal_store.js`, `test_executor_v2.js`, `demo-site/test_fixtures.js`).


## Follow-up — 2026-10-02T10:46:38Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Multi-Agent Security & Resilience Audit Team (7 specialist subagents: Identity & Access, Secrets & Data Exposure, Injection & Runtime Exploitation, Supply Chain & Dependency, Configuration & Infrastructure, Resilience & Blast-Radius, Adversarial QA / Red Team, and Orchestrator Synthesis)

Comprehensive multi-agent security and resilience audit across the entire Project Atlas codebase, orchestrating six parallel specialist subagents followed by adversarial red team chaining and a unified synthesis report with actionable remediations.

Working directory: /media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2
Integrity mode: development

## Requirements

### R1. Subagent 1 — Identity & Access Specialist Audit
- Audit authentication mechanics: client-side-only checks, JWT validation (signature verification, algorithm pinning vs `alg:none`, claims validation `exp`/`nbf`/`iss`/`aud`), open-signup attack surfaces, authentication rate limiting, and account enumeration.
- Audit authorization: missing checks on generated API endpoints (CWE-862), IDOR-by-default (CWE-639) across CRUD operations, inverted access-control logic, object-level authorization on chat/goal/messaging channels (preventing cross-session/thread access), multi-tenancy isolation, and function-level authorization on state-changing actions.
- Audit session management: token entropy/predictability, expiration handling, and server-side session invalidation on logout.
- Audit data access controls: verify database/storage security rules (e.g., RLS) are actively enforced on all tables/stores and enforce tenant ownership rather than mere authentication.
- Verification Method: Test/trace access claims across unauthenticated, alternative authenticated, and target identity states.
- Deliverable: Findings table (`Vulnerability | Location | Severity | Evidence | Verified behaviorally Y/N`) plus identification of the least trusted access-control mechanism with justification.

### R2. Subagent 2 — Secrets & Data Exposure Specialist Audit
- Inspect production bundles and client assets for embedded secrets: service keys, third-party payment/provider tokens, LLM API keys, private keys, and high-entropy secret patterns.
- Audit server-to-client serialization pipelines for data leakage (e.g., server state passed unredacted to client components or extensions).
- Review git commit history for inadvertently committed credentials, tokens, or private configuration files.
- Audit object/blob storage configurations and local cache artifacts for unauthenticated access or public directory listing.
- Inspect file handling pipelines for data stripping (e.g., EXIF/GPS metadata on file uploads).
- Verify data retention and deletion lifecycles across storage layers, background workers, and caches.
- Audit sensitive token exposure in URLs, query parameters, console/server logs, and PII/PHI handling.
- Deliverable: Findings table with exact strings/patterns and locations, explicitly flagging any finding enabling unauthorized spending (cloud/LLM compute) or third-party account takeover.

### R3. Subagent 3 — Injection & Runtime Exploitation Specialist Audit
- Audit for injection vectors: SQL/NoSQL, OS command injection, template injection, XPath, and prototype pollution across all input vectors.
- Audit DOM manipulation and client rendering for XSS vulnerabilities (e.g., unescaped `innerHTML`, dynamic script injection, unvalidated message passing).
- Audit code injection and unsafe execution paths: `eval()`, `exec()`, `Function()`, `pickle.loads()`, unsafe YAML/JSON loading, or unvalidated dynamic dispatch on user-controlled input.
- Audit file handling: path traversal, unrestricted file upload, SSRF via URL navigation or fetching endpoints, XXE, decompression bombs, and open redirects.
- Audit business logic and state machine transitions: race conditions (TOCTOU), workflow-step skipping via direct endpoint invocation, and privilege bypasses.
- Verification Method: Formulate benign non-destructive canary payloads to prove or disprove exploitability.
- Deliverable: Findings table noting whether each vulnerability was confirmed via execution or static analysis requiring dynamic validation.

### R4. Subagent 4 — Supply Chain & Dependency Specialist Audit
- Audit direct and transitive dependencies in lockfiles (`package-lock.json`, `requirements.txt`, etc.) against known CVE databases, focusing on prototype pollution, ReDoS, and path traversal.
- Analyze dependency staleness relative to the current date and identify outdated pinned versions from AI generation.
- Cross-reference all external packages against authoritative registry records (npm, PyPI) to detect hallucinated or typosquatted dependencies.
- Inspect CI/CD pipeline definitions for unpinned action versions, unverified remote scripts, or supply chain tampering risks.
- Audit agentic tooling and execution loops for infrastructure isolation (sandboxing, egress controls, least privilege credentials) versus prompt-only boundaries.
- Inspect untrusted content processing pipelines (DOM extraction, external web text) fed to LLMs with tool access for indirect prompt injection attack surfaces.
- Deliverable: Findings table plus a dedicated roster of unverified/suspect packages requiring manual registry validation.

### R5. Subagent 5 — Configuration & Infrastructure Specialist Audit
- Audit security headers: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy (both presence and defensive strength).
- Audit CORS configuration, allowed origins, and CSRF defense mechanisms on state-changing endpoints.
- Audit rate limiting and throttling on authentication endpoints and upstream paid LLM/API gateways.
- Check for debug mode toggles, verbose stack trace exposure, exposed development/inspection endpoints, and default credentials.
- Audit container and local deployment configurations (Dockerfiles, compose files, process permissions, exposed ports, non-root execution).
- Audit transport security, TLS configuration, cryptographic primitives, and entropy sources (insecure RNG).
- Deliverable: Findings table plus a "Hardening Checklist" of zero-cost configuration toggles (<30 min quick wins).

### R6. Subagent 6 — Resilience & Blast-Radius Specialist Audit
- Identify single points of failure (SPOFs): hard dependencies on external cloud providers, single LLM vendors, third-party auth, or unbuffered external services.
- Verify whether monitoring, telemetry, and rollback infrastructure share dependencies with the primary execution path.
- Audit configuration change management and state mutation safety (staged rollouts vs global instant updates).
- Audit asynchronous race conditions in agent execution, background stores, and persistent browser storage.
- Evaluate graceful degradation pathways: verify the system degrades safely and diagnostically during upstream API outages (e.g., 429 rate limits, 5xx server errors).
- Audit recovery and state replay mechanisms under unexpected tab closure, process crashes, or network disconnects.
- Deliverable: Findings table (`Single Point of Failure | Location | Blast Radius | Recommended Mitigation`) ordered by blast-radius impact.

### R7. Subagent 7 — Adversarial QA / Red Team Specialist Audit
- Run after Subagents 1–6 conclude their initial analysis.
- Review and correlate findings across all six domain reports to identify multi-step attack chains (e.g., combining information disclosure with access control or prompt injection).
- Conduct targeted adversarial reviews for unconventional business logic flaws, agent bypasses, or novel attack surfaces uncaptured by standard security checklists.
- Sanity-check and recalibrate severity rankings across all subagent reports based on actual end-to-end exploitability.
- Deliverable: Attack Chains section detailing multi-hop exploit scenarios, a recalibrated severity adjustment log with rationale, and any newly uncovered novel vulnerabilities.

### R8. Orchestrator Synthesis Report & Remediation Roadmap
- Aggregate and deduplicate findings from all specialist subagents, recording multi-agent convergence as a confidence signal.
- Produce a unified **Executive Summary** highlighting overall risk posture, top 3 urgent vulnerabilities, and identified attack chains.
- Construct the **Master Findings Table**: `Vulnerability | Location | Severity | CWE/OWASP Ref | Found By | Verified Behaviorally (Y/N)`.
- Construct the **Resilience Findings Table** detailing SPOFs and blast radii.
- Formulate a prioritized **Remediation Plan** sorted by severity, detailing proposed fixes, estimated effort, and breaking-change impact.
- Compile a list of **Quick Wins** (<30 minute implementations).
- Generate a **CI Verification Checklist** containing regression tests and static analysis rules to enforce continuous compliance.
- Highlight items requiring **Manual Review** (live infrastructure dependencies, human policy decisions).

### R9. Universal Directives & Safety Constraints
- Strictly follow the **Prime Directive**: All analysis, findings, and recommended fixes must be 100% universal across all websites, with zero domain or vendor hardcoding.
- **Audit-Only Mandate**: Perform non-destructive audits, static analysis, and benign dynamic canary checks only. Do not alter production code, credentials, or databases during the audit.
- Preserve existing test suite integrity: Any future remediation must maintain passing status on all 466 existing backend tests and 6 frontend test suites.

## Acceptance Criteria

### Specialist Audit Execution
- [ ] Subagents 1 through 6 complete independent audits covering their assigned domains without cross-agent anchoring.
- [ ] Subagent 7 ingests all reports from Subagents 1–6, verifies multi-step attack chains, and recalibrates severity ratings.
- [ ] Every recorded finding includes exact file paths, line numbers, configuration keys, or verified request/response traces.

### Synthesis & Deliverables
- [ ] Executive Summary clearly outlines posture, top 3 critical issues, and attack chains.
- [ ] Master Findings Table compiles all deduplicated security vulnerabilities with verified CWE/OWASP tags.
- [ ] Resilience Findings Table maps all SPOFs and cascading failure risks.
- [ ] Prioritized Remediation Plan details effort, breaking changes, and defensive architecture improvements.
- [ ] CI Verification Checklist provides concrete automated test patterns to prevent regressions.
- [ ] Hardening Checklist and Quick Wins outline actionable improvements achievable in under 30 minutes.

### Architectural & Universal Compliance
- [ ] No findings or proposed remediations suggest domain-specific hacks, website blacklists, or non-universal workarounds.
- [ ] Full baseline of 466 backend tests and extension test suites remain untouched and green.


## Follow-up — 2026-10-02T14:21:25Z

The server has restarted and quota has reset. Please resume the security and resilience audit. Check on your orchestrator and subagents, recover state from .agents/teamwork, and proceed with Phase 1 audits through synthesis.

## Follow-up — 2026-10-03T20:04:26Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Multi-Agent Parallel Implementation Team (Wave 1 & Wave 2 coordination: B0 branch reconciliation, N1 Arabic normalization, 0b contract language fields, RTL bidi rendering, V1 dual-language voice input, V2 TTS voice matching, N2a intent synonyms, N2b prompt language mirroring, L1-lite declarativeNetRequest & GoalStore language header, L1-full planner language milestone)

Implement Atlas v2.1 Dual-Language (Egyptian Arabic & English) and Intent Add-Ons: resolve branch reconciliation (B0), fix Arabic Unicode normalization and tokenization (N1), extend contracts with language signals (0b), implement chat bubble RTL rendering (RTL), dual-language voice input (V1) and TTS (V2), bilingual intent canonicalization (N2a), language-mirrored LLM prompts across 6 agent surfaces (N2b), and site-language-first navigation across client and planner (L1-lite & L1-full).

Working directory: /media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2
Integrity mode: development

## Requirements

### R1. Track B0: Branch Reconciliation Gate
- Reconcile `origin/feat/assistant-experience` into `main`.
- Resolve conflicts in `client-script/sidebar.css`, `sidebar.js`, `speech.js`, `websocket-client.js`, and `docs/contracts.md`.
- Ensure `main` is clean, merged, and that all 466 backend tests and extension test suites pass cleanly before any client-side tracks (RTL, V1) merge.

### R2. Track N1: Unicode & Arabic Normalization Fix
- In `backend/app/agent/agentic_planner.py`:
  - Upgrade `_normalize_text` to apply Unicode `NFKC` normalization, lowercase conversion, Arabic letter folding (alef variants `أ/إ/آ/ٱ` -> `ا`, `ى` -> `ي`, `ة` -> `ه`, `ؤ` -> `و`, `ئ` -> `ي`), Arabic-Indic & Persian digit conversion (`٠-٩` / `۰-۹` -> `0-9`), and strip tashkeel/tatweel (`[\u064B-\u065F\u0670\u0640]`).
  - Upgrade `find_heuristic_match`: tokenize Arabic words via `[\u0600-\u06FF]+`, filter Arabic stop words, and compute normalized clean keywords alongside Latin tokens.
  - Preserve exact behavior for Latin/English text.

### R3. Track 0b: Contract Extension — Language Signal
- In `backend/app/models/request.py`: Add `language: str | None = None` to `AgentMessage`.
- In `backend/app/models/goal.py`: Add `language: str | None = None` to `GoalState`.
- Default to `None` to maintain 100% backward compatibility with all existing callers and test fixtures.

### R4. Track RTL: Sidebar Bidi Rendering
- In `client-script/sidebar.css` and `sidebar.js`:
  - Set `dir="auto"` per message bubble in `.atlas-chat-log`, allowing the browser's bidirectional algorithm to render Arabic and English messages naturally without flipping panel chrome.
  - Convert bubble layout rules to CSS logical properties (`margin-inline-start`, `padding-inline-end`, `text-align: start`).
  - Keep `#atlas-sidebar-root` and outer extension UI in fixed LTR orientation.

### R5. Track V1 & V2: Dual-Language Voice Input & Output
- **V1 (Speech Recognition):**
  - In `client-script/speech.js`: Replace hardcoded `'en-US'` with `currentLang` initialized from `chrome.storage.local` key `atlas_voice_lang` (default `'en-US'`). Export `AtlasSpeech.setLanguage('ar-EG' | 'en-US')` and `getLanguage()`.
  - In `client-script/sidebar.js`: Add a two-state "EN" / "AR" language pill next to the microphone button. Implement auto-sticky heuristic: if final transcript contains Arabic characters (`[\u0600-\u06FF]`), silently update stored language for subsequent turns.
  - Forward active `language` with backend commands via `AgentMessage.language`.
- **V2 (TTS Voice Output):**
  - In `client-script/tts.js`: Detect reply language (`/[\u0600-\u06FF]/.test(text) ? 'ar-EG' : 'en-US'`). Match installed system voices via `speechSynthesis.getVoices()`. Log a warning without throwing if no Arabic voice is installed on the host OS.

### R6. Track N2a & N2b: Bilingual Intent Canonicalization & Language-Mirrored Prompts
- **N2a (Synonym Canonicalization):**
  - Create `backend/app/agent/intent_synonyms.py` with `CANONICAL_INTENTS` mapping English, MSA, and Egyptian colloquial phrases to canonical keys (`add_to_cart`, `search`, `go_home`, `subscribe`).
  - Implement `canonicalize_intent(user_message: str) -> str | None`. Wire it into `agentic_planner.py` before `find_heuristic_match()`.
- **N2b (Language-Mirrored Prompts):**
  - Add explicit language mirroring instructions to 6 system prompt surfaces: `agentic_planner.py`, `simplify_prompt.py`, `summary_prompt.py`, `planner.py`, `scout.py`, and `form_filler.py`.
  - Instruct models: "Reply in the same language the user is using. If `language` is an Arabic locale (e.g. 'ar-EG'), reply in Egyptian colloquial Arabic — not Modern Standard Arabic, and not a literal translation. If unset, infer from script. If mixed, mirror the mix."
  - Preserve all existing JSON response schemas.

### R7. Track L1-lite & L1-full: Site-Language-First Navigation
- **L1-lite (Client DNR & In-Page Switcher):**
  - In `client-script/manifest.json`: Add `"declarativeNetRequest"` permission.
  - In `client-script/background.js`: Add session-scoped tab-conditioned DNR rules injecting `Accept-Language: {lang};q=0.9, en;q=0.5` upon goal start (`GOAL_STATE_PUT`) and clearing upon goal completion (`GOAL_STATE_CLEAR`).
  - In `client-script/content.js`: Pre-scan landing page DOM for language switchers (`aria-label`/`title` containing "language"/"لغة", language link text, `<select name="lang">`) and click when present.
  - Store per-origin language choices in `chrome.storage.local` key `atlas_lang_pref:<origin>`.
- **L1-full (Planner & Scout Integration):**
  - In `backend/app/agent/scout.py`: Populate `detected_language` in page assessments.
  - In `backend/app/agent/planner.py`: When `GoalState.language` is set and differs from `detected_language`, insert a synthetic first milestone: `"Switch the page language to {language}"` (`satisfied_by_navigation=False`).

### R8. Universal Directive & Concurrency Waves
- **Wave Execution Discipline**:
  - Wave 1 (Zero-Collision Parallel Drafts): SA-B0, SA-N1, SA-N2a, SA-0b-g, SA-0b-r, SA-V2, SA-L1l, SA-N2b-A, SA-N2b-B.
  - Wave 2 (Sequential Integration on Shared Files): SA-N2a-wire, SA-N2b-C, SA-RTL, SA-V1, SA-L1f, SA-V2wire.
- **Universal Rule**: Zero domain or site-specific hardcoding. All DOM heuristics, language selectors, and matching rules must remain 100% universal across all websites.
- **Zero Regression**: Preserve passing status on all 466 backend tests and 134 frontend tests across every merge.

## Acceptance Criteria

### Branch Reconciliation & Contracts
- [ ] `git branch -a --merged main` verifies `feat/assistant-experience` is cleanly reconciled into `main`.
- [ ] `AgentMessage` in `request.py` and `GoalState` in `goal.py` accept optional `language: str | None = None`.
- [ ] `LLM_PROVIDER=mock pytest backend/tests -q` passes with >= 466 tests.

### Arabic Normalization & Intent Matching
- [ ] `_normalize_text("أضف إلى السلة")` returns `"اضفاليالسله"`, and `_normalize_text("iPhone ١٥")` returns `"iphone15"`.
- [ ] `find_heuristic_match("افتح الصفحة الرئيسية", ...)` and `find_heuristic_match("دوس على اشتراك", ...)` match target elements with score 1.0.
- [ ] `canonicalize_intent("اشتريلي الحاجه دي") == "add_to_cart"` and resolves against target DOM button `"أضف إلى السلة"`.

### Bidi UI & Dual-Language Voice
- [ ] Chat bubbles in `sidebar.js` have `dir="auto"`; Arabic messages flow RTL with correct logical padding while header/input chrome remains fixed LTR.
- [ ] `speech.js` supports `setLanguage('ar-EG')` and persists choice across extension reloads.
- [ ] `tts.js` detects Arabic text, selects Arabic voice if available, and warns gracefully without throwing if unavailable.

### Site-Language-First Navigation
- [ ] `manifest.json` contains `"declarativeNetRequest"`.
- [ ] `background.js` applies tab-scoped `Accept-Language` DNR rule during goal execution and cleans up on goal end.
- [ ] Planner inserts `"Switch the page language to {language}"` milestone when `GoalState.language` differs from Scout's `detected_language`.

### System Integrity
- [ ] Zero website/domain hardcoding across all added files.
- [ ] All 466 backend tests and all 6 frontend extension test suites pass cleanly.

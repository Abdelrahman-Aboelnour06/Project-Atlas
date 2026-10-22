# 🧭 Atlas — Master Project Documentation
*Cairo University AI Hackathon — Project Atlas (Dual-Speed Cognitive Web Autopilot)*

## 📖 PART 1: PROJECT OVERVIEW

### What Atlas Does
Atlas is an AI-powered browser extension that helps elderly and disabled users navigate any website, regardless of how that website was built or how confusing its layout is. 

**The Problem:** Many websites are hard to use for elderly people or people with visual, motor, or cognitive impairments. Buttons are small or unlabeled, layouts are cluttered, and it isn't obvious what's clickable versus what's just decoration. Standard accessibility tools (like screen readers) require technical setup and a learning curve most casual users don't have.

**The Solution:** Atlas sits on top of any website as a browser extension. When the user activates it on a page, Atlas:
1. Scans the page's DOM and finds every interactive element.
2. Sends a simplified map of that page to an AI model, which translates each technical element into a short, plain-language description. (e.g. `<button id="chkout-btn-2">` becomes "Go to checkout").
3. Displays this simplified list in a sidebar next to the page.
4. When the user clicks (or speaks/types) an option, Atlas scrolls to the real element and makes it glow with a soft white highlight.
5. Users can also speak commands (e.g., "click checkout"), and Atlas will resolve that command directly to the correct action.

### Privacy & Safety
Because Atlas serves users requiring high trust and accessibility, security and privacy are built into the foundational architecture:
* **Client-Side Cryptographic Vault:** Sensitive inputs (passwords, PINs, card numbers) are encrypted in IndexedDB using AES-GCM (Web Crypto API) and tokenized (`{password}`, `{profile.email}`) before reaching the backend or LLM.
* **Closed Shadow DOM Encapsulation:** Extension UI mounts in a closed Shadow Root (`mode: "closed"`), isolating it completely from hostile host-page CSS and preventing extension DOM leaks into LLM context.
* **Human-in-the-Loop Confirmation Rails:** Consequential actions (payments, account modifications, deletions) pause execution and require explicit user confirmation chips.
* **Connection Resilience:** Automatic exponential backoff with jitter (capped at 30s), dynamic status indicators, and offline input locks.
* **GDPR Compliance:** Dedicated tenant APIs (`/v1/tenant/summary`, `/v1/tenant/export`, `/v1/tenant/data`) supporting verifiable data export and irreversible erasure.
* **Ephemeral Data:** Raw DOM maps and full command texts are never persisted long-term.

---

## 🏗️ PART 2: SYSTEM ARCHITECTURE

### High-Level Flow
    Chrome Extension (Frontend)                Backend (FastAPI)
    ----------------------------                ------------------
    1. Content script scans DOM
       and tags every interactive
       element with a stable id
       (data-atlas-id="atlas-042")
                |
                v
    2. Sends DOM map over
       WebSocket  ------------------------>  3. Auth check (API key)
                                                       |
                                                       v
                                              4. Build prompt for LLM
                                                 ("simplify" or "command")
                                                       |
                                                       v
                                              5. Call LLM (Ollama / Hosted)
                                                       |
                                                       v
                                              6. Parse + validate LLM response
                                                       |
                                                       v
                                              7. Log to Postgres (usage_logs)
                                                       |
    8. Receive structured        <------------------- response
       response over WebSocket
                |
                v
    9a. Render sidebar               9b. Scroll to element + apply white-light 
                                         highlight, keyed off data-atlas-id

### The Two AI Pipelines
1. **System 1 (Reflex Engine):** Sub-100ms fast-path perception (Scout) and micro-action selection (Navigator) evaluating deterministic heuristics and non-autoregressive decision models.
2. **System 2 (Deliberative Planner):** Generative multi-hop milestone decomposition (`planner.py`) and contextual explanation powered by reasoning LLMs (650–2,200ms).
3. **Verification Quorum:** Deterministic rules-first outcome evaluation (`verifier.py` Rules 1–5) with LLM fallback (Rule 6).

---

## 🤝 PART 3: SHARED CONTRACTS

> **⚠️ CRITICAL:** Element IDs must be synthetic (`data-atlas-id`), not native HTML IDs.

### Contract 1 — WebSocket Message Schema
Message sent **from browser → FastAPI**.
{
  "session_id": "string",
  "api_key":    "string",
  "url":        "string",
  "dom_map":    [ /* see Contract 3 */ ],
  "type":       "simplify | command",
  "command":    "string | null"
}

### Contract 2 — Action JSON Format
Message sent **from FastAPI → browser** (for `type: "command"`).
```json
{
  "status":     "success | error",
  "action":     "click | open | double_click | fill | scroll | focus",
  "element_id": "string",
  "value":      "string | null",
  "message":    "string"
}
```

### Contract 3 — DOM Map Node Structure
```json
{
  "id":             "string",        // data-atlas-id ONLY
  "tag":            "string",
  "type":           "string | null",
  "inner_text":     "string | null",
  "placeholder":    "string | null",
  "aria_label":     "string | null",
  "href":           "string | null",
  "name":           "string | null",
  "role":           "string | null",
  "sensitive":      "boolean | null",
  "resolved_label": "string | null",
  "group_label":    "string | null"
}
```

---

## 📋 PART 4: MASTER TASK BOARD

### 🚀 5-Wave Production Roadmap — 100% Complete & Verified

* **Wave 0 (Safety Net & Test Harness):**
  * [x] Flake Hunter regex word boundary fix (`\b(2fa|otp)\b`) stripping nonces — 0 failures across 1,000 runs.
  * [x] Replay isolation fixtures and AST CI Gatekeeper (`ci/verify_all_tests_run.py`) executing 100% of test files.
* **Wave 1 (Foundations & Isolation):**
  * [x] Closed Shadow DOM mount (`sidebar.js`) immune to hostile CSS (`* { font-size: 40px !important; }`).
  * [x] Accessible 3-step Options Setup Wizard (`options.html`) with live `GET /health` check.
  * [x] Enterprise demo fixtures (`healthcare-intake`, `finance-statement`, `checkout`) with replay tests.
  * [x] J1 Latency benchmarks measuring empirical p50/p95 multi-hop latency (`bench_hops.py`).
* **Wave 2 (Core UX & Human Factors):**
  * [x] Real-time milestone progress bar ("Step X of Y") with ARIA live regions and Stop control (`AbortController`).
  * [x] WCAG 2.2 AAA typography tokens (>=14px floor, >=16px body, >=44px hit targets) and Alt+A shortcut.
  * [x] Live Web Audio amplitude visualization during speech recognition.
* **Wave 3 (Resilience, Packaging & Privacy):**
  * [x] Connection Resilience UX with exponential backoff & jitter capped at 30s and offline banners.
  * [x] Accessible 3-step Guided Tour walkthrough (`test_guided_tour.js`).
  * [x] Store-Ready MV3 Packaging (`package_extension.sh` / `.ps1`) with hardened CSP and zero dev artifacts.
  * [x] Tenant Privacy & GDPR endpoints (`/v1/tenant/summary`, `/export`, `/data`) with header auth.
* **Wave 4 (Integration, A11y & Truth-Pass):**
  * [x] Automated Axe-core accessibility audits: 0 critical and 0 serious violations.
  * [x] Documentation truth-pass synchronizing empirical test counts (1,481+ passing) and real benchmark latencies.
  * [x] Clean removal of obsolete `INTEGRATION.md`.

---

## 🛠️ PART 5: DEVELOPER CONVENTIONS

* **The Prime Directive**: 100% universal across all websites. No domain checks or bespoke site hacks (`AGENTS.md` / `GEMINI.md`).
* **Git Workflow:** Branch naming `team/task-id-desc`. Commits must be imperative.
* **Python (Backend):** PEP 8, type hints everywhere. Use Pydantic models for I/O.
* **JavaScript (Frontend):** ES6+, kebab-case file names. Strict module boundaries (Serializer owns DOM read, Executor owns DOM write).
* **Next.js:** TypeScript, Tailwind CSS.

---

## 🧪 PART 6: TESTING & VERIFICATION

Atlas features an automated multi-tier regression suite:

**Quality Floors & Empirical Baseline:**
- **Backend Test Suite:** **734 passed** (Quality Floor: 659, 37 test modules, 100% green)
- **JavaScript Test Suite:** **747 passed** (Quality Floor: 349, 18 core suites + Playwright harnesses, 100% green)
- **Total Test Baseline:** **1,481+ automated tests, 100% green**

**Measured Hop Latency Profile (from `backend/tests/bench_results.json`, N=200):**
- **Mock Baseline:** p50: **0.46ms**, p95: **0.50ms** (Scout: 0.30ms, Verifier: 0.02ms, Navigator: 0.16ms)
- **Simulated Network:** p50: **1.93ms**, p95: **2.17ms** (Scout: 1.26ms, Verifier: 0.16ms, Navigator: 0.66ms)
- **System 2 Deliberative Planning:** **650–2,200ms** (p50: ~850ms)
- **Fallback Latency:** 504 Timeout: **80.28ms**, Unreachable: **27.74ms**, CAPTCHA Intercept: **0.03ms** (<1ms)

```bash
# Full backend pytest regression suite (734 passed)
cd backend && pytest tests/

# Run empirical multi-hop latency and fallback benchmark (N >= 200 hops)
python tests/bench_hops.py --hops 200 --output tests/bench_results.json

# Chrome Extension core test suites (747 passed)
node client-script/test_extension.js && node client-script/test_wave2_ux.js

# Full CI self-check verification runner (100% test file discovery & execution)
python3 ci/verify_all_tests_run.py
```


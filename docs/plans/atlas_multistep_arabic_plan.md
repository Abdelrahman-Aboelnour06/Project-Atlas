# Atlas: multi-step navigation, Arabic replies and CI fix plan

Oct 22, 2026 · @Raafat Abualazm

Atlas already has a multi-step goal loop, but typed messages never reach it; this plan routes goals into that loop, teaches it to open menus and ask for inputs, makes the selected language reach every reply, and fixes a one-line CI break.

## Summary

| Problem | Root cause | Fix (workstreams) |
| --- | --- | --- |
| PPO "vehicle violations" request fails with "couldn't find an element" | Chat goes to a single-shot planner that only sees visible elements; the LLM call failed, so a literal matcher ran; hidden menu items are never serialized; the client cannot answer `awaiting_user_input` | Intent router, closed goal loop from the chat box, latent menu nodes, exploring navigator, slot filling (WS4 to WS7) |
| Replies stay English in Arabic mode | `/v1/chat` drops the `language` field; fixed replies are English; navigator and verifier take no language | Language contract end to end plus an Arabic string table (WS1 to WS3) |
| CI red after the last push | Tier 2 runs pytest from `./backend`; a new test calls `git diff backend/app/agent/verifier.py` relative to that folder and git exits 128 | Pin the test's working directory to the repo root (WS0) |

No code, config or GitHub state was changed while writing this plan.

## Root causes

All findings below come from reading `main` at commit `f4abd84` and running the CI steps locally. GitHub Actions logs were not reachable from this session, so the CI cause is reproduced, not read from the run page.

### Problem 1: the agent only matches visible labels

The reply the user saw is the last-resort fallback in `backend/app/agent/agentic_planner.py` (line 880). Five gaps line up to produce it:

1. **Typed chat never enters the goal loop.** `content.js` sends every typed message to `POST /v1/chat`, which calls `plan_agentic_action` once and returns a single batch of steps for the current page. The closed loop that already exists (`POST /v1/chat/goal_step`: planner, scout, navigator, verifier, form filler, `awaiting_user_input`) is only reached from resume paths (`ATLAS_GOAL_RESUME`, popup close, human-agency resume). Nothing starts a new goal from the chat box.
2. **The single-shot planner assumes the target is on screen.** Its prompt says "find the matching element in CURRENT INTERACTIVE DOM ELEMENTS". There is no notion of "open a menu, re-observe, choose again". Steps run blind in a `for` loop and the DOM is never re-read between them.
3. **That message only appears when the LLM call failed.** The text lives in the `except` branch, so for the PPO request the model call threw or returned non-JSON (timeout, 401, `<think>` output, or the mock provider). After that, only literal heuristics run, and none of them can map "مخالفات المركبات" to a menu path.
4. **Hidden menu items are invisible.** `dom-serializer.js` drops anything with `display:none`, `visibility:hidden` or `aria-hidden`. Sub-items of a collapsed menu such as "نيابات المرور" under "خدمات المواطنين" never reach the backend, and nothing records that a node is a menu toggle (`aria-haspopup`, `aria-expanded`, `aria-controls`).
5. **No slot filling in the typed path.** The goal pipeline can return `awaiting_user_input`, but `content.js` has no handler for it, so even the goal loop cannot ask for a national ID or plate number and resume.

### Problem 2: replies stay English in Arabic mode

1. **The language is dropped at the API boundary.** `content.js` sends `language` (from `AtlasSpeech.getLanguage()`) in the `/v1/chat` body, but `ChatRequest` in `routes/chat.py` has no `language` field, so Pydantic discards it. `plan_agentic_action` has no `language` parameter either.
2. **Language is inferred from the message script, not the mode.** `_build_canonical_plan` checks for Arabic letters in the user text. An English message in Arabic mode gets English, and every other deterministic reply (search, heuristic click, page description, "couldn't find", cancel, 401) is hard-coded English.
3. **The plain QA prompt has no language rule.** The no-DOM branch of `/v1/chat`, `/v1/summary`, and the error strings carry no language directive at all.
4. **The goal loop forgets it too.** `executeGoalHop` does not send `language`, and `navigator.py` and `verifier.py` take no language argument. The EN/AR pill is labelled "voice input language" and only drives speech recognition.

### Problem 3: CI fails in Tier 2

`Tier 2: Module Tests` runs `pytest tests/` from `./backend`. One test fails there: `test_m2_challenger_stress.py::TestSacredRailsAndUniversalCompliance::test_verifier_rules_4_5_6_zero_diff_lines` (944 passed, 1 failed locally on Python 3.11).

The test runs `git diff backend/app/agent/verifier.py` with no working-directory pin. From `./backend` that path does not exist, so git exits 128 with "ambiguous argument". It passes only when pytest runs from the repo root, which is how the authors ran it locally (`pytest backend/tests`). The test arrived in commit `9f3d6b5` ("feat1-3") and both commits went up together in the last push. Tier 3 lists Tier 2 in \`needs\`, and Tier 4 needs Tier 3, so a red Tier 2 skips everything after it.

Everything else checked locally is green: the secret scans, `pip-audit` (no known vulnerabilities), all Tier 1 JS suites, the dashboard `npm ci && npm run build`, the Tier 3 and Tier 4 pytest files, and `tools/package_extension.py`. The four Playwright harnesses could not launch here because this sandbox's Chromium build does not match the Playwright version, so they are unverified. The first green run after the fix must confirm them.

## Target architecture

The fix reuses the goal pipeline Atlas already has and closes the three gaps around it: a router in front, richer perception and exploration inside, and a language contract through all of it.

&#91;embedded content: target architecture · router, closed goal loop, language contract\]

Every chat message passes the router. Only goals enter the loop, which re-reads the page after each action, so a menu click becomes the first hop rather than the whole answer.

For the PPO request the loop runs like this: perception shows "خدمات المواطنين" as a menu toggle with a hidden child "نيابات المرور"; the navigator scores that child against "vehicle violations", reveals the menu and clicks it; the verifier sees a new page; on the form, slots ask for the national ID and plate number; after a yes, Atlas submits and reads the result. None of those labels are coded anywhere; the same moves work on any site with menus, drawers, link lists or a search box.

## Workstreams and agent owners

Ten agents, each owning a disjoint set of files so they can work in parallel branches without merge fights. Shared files (`models/goal.py`, `contracts/*.json`, `content.js`) have exactly one owner; others request changes through that owner.

| ID | Agent | Owns (files) | Delivers |
| --- | --- | --- | --- |
| WS0 | CI Medic | `backend/tests/test_m2_challenger_stress.py`, `.github/workflows/ci.yml` | Green pipeline on `main` |
| WS1 | Contract Owner | `backend/app/models/goal.py`, `contracts/*.json`, `docs/contracts.md` | v3 request/response schemas for chat and goal\_step |
| WS2 | Language Backend | new `backend/app/i18n.py`, language plumbing in `agentic_planner.py`, `navigator.py`, `verifier.py`, `planner.py`, `routes/chat.py` (QA and summary branches) | Every reply honours the selected language |
| WS3 | Language Client | `sidebar.js`, `speech.js`, `tts.js`, `options.*` | One language setting that drives UI, speech, TTS and requests |
| WS4 | Perception | `dom-serializer.js`, `models/dom.py` | Menu metadata and latent (hidden) navigation nodes |
| WS5 | Router and Loop | `content.js`, `background.js`, `goal-handoff.js`, `/v1/chat` routing in `routes/chat.py` | Typed and spoken goals enter the closed goal loop |
| WS6 | Navigator | `navigator.py`, `planner.py` (milestones), `intent_synonyms.py`, `scout.py` | Explore, reveal, backtrack and reach a target page on any site |
| WS7 | Slots and Forms | `form_filler.py`, `secret_vault` client code, goal\_step `awaiting_user_input` branches | Ask for required inputs, store sensitive ones safely, fill, confirm, submit |
| WS8 | LLM Reliability | `llm_client.py`, `routes/health.py` | Fewer silent fallbacks; visible "limited mode" when the model is down |
| WS9 | QA and Evals | `demo-site/`, `backend/tests/replay/`, `ci/e2e/` | Offline fixture sites, replay and Playwright scenarios, metrics |

An **Integrator** (human or lead agent) merges in wave order, runs `python3 ci/verify_all_tests_run.py`, and is the only one who touches `main`.

### WS0: CI Medic

1. In `test_verifier_rules_4_5_6_zero_diff_lines`, run git with `cwd` set to the repo root (`Path(__file__).resolve().parents[2]`) and add `--` before the path. Apply the same cwd to its sibling (`test_prime_directive_zero_domain_hardcoding`): from ./backend its git grep paths match nothing, so it passes today without checking anything.
2. Confirm Tier 3 Playwright harnesses pass on the runner. If they fail, fix there, never by skipping.
3. Optional: run backend pytest from the repo root in every tier so local and CI behave the same.

### WS1: Contract Owner

1. Add `language: Optional[str]` to `ChatRequest` and pass it through. Keep it optional so old clients still work.
2. Extend `UserInputRequest` with `fields: [{ref, label, kind, sensitive, pattern, required}]`, so one prompt can ask for several values (national ID and plate number together).
3. Add `intent_route` to the chat response (`direct`, `question`, `goal`) and a `goal_state` seed so the client can hand over to the loop.
4. Add `explore` metadata to `PlanStep`: `reason` (`reveal_menu`, `navigate`, `search`, `backtrack`) and `expect` (what should appear next), used by the verifier.
5. Bump `contract_version` to 3, update both JSON schemas and `test_v2_contracts.py` with v3 cases. Publish the contract before Wave 2 starts.

### WS2: Language Backend

1. Create `backend/app/i18n.py` with `resolve_reply_language(selected, user_text)`: the selected mode wins when it is Arabic; in English mode keep mirroring the user's script.
2. Move every hard-coded reply in `agentic_planner.py` and `routes/chat.py` into a string table with `en` and `ar-EG` entries (Egyptian colloquial, as the existing directive asks).
3. Add a `language` parameter to `plan_agentic_action`, `plan_milestone_step`, `verify_step_outcome`, `plan_form_fill`, the QA prompt and the summary prompt, and put one `REPLY LANGUAGE: ar-EG` line in each prompt.
4. Post-check: if the reply language is Arabic and the model returned mostly Latin text, retry once with a stricter instruction, then fall back to the string table.
5. Review the planner's "switch page language" milestone: it must only fire when the user asks, not merely because the mode differs from the page.

### WS3: Language Client

1. Rename the EN/AR pill to "Atlas language" and store one key (`atlas_lang`) with a migration from `atlas_voice_lang`.
2. Send that value as `language` on `/v1/chat`, `/v1/summary` and every goal hop.
3. Localise sidebar chrome (status lines, buttons, confirmation options, "Paused", errors) with an `ar` table and `dir="rtl"` on Arabic messages.
4. Pick an Arabic TTS voice when the mode is Arabic.

### WS4: Perception

1. For each interactive node, emit `menu`: `{haspopup, expanded, controls}` from `aria-haspopup`, `aria-expanded`, `aria-controls`, `<details>`, and common toggles (a button or link whose next sibling is a hidden `ul`/`nav`).
2. Emit **latent nodes**: links and menu items inside `nav`, `[role=menu]`, `[role=menubar]`, header lists and off-canvas drawers that are hidden only by CSS. Mark them `visible:false`, `reveal_via:<toggle id>`, and keep their text and `href`. Cap them (for example 150) and never include hidden inputs or `aria-hidden` dialogs.
3. Add `landmark` (header, nav, main, footer, aside) and a breadcrumb path so the navigator can tell navigation from content.
4. Executor: add a `reveal` step (hover then click the toggle, wait for `aria-expanded=true` or the target to become visible) used before acting on a latent node.

### WS5: Router and Loop

1. In `/v1/chat`, classify each message: `direct` when a visible node scores 0.85 or more, `question` for page questions, otherwise `goal`. Use the LLM when available and a rule fallback (task verbs, "اريد", "عايز", "I want to", no direct match) when not.
2. In `content.js`, when the route is `goal`, create the goal state and call `executeGoalHop` with `language`, `page_text` and `user_response`.
3. Handle every goal status in the client: `awaiting_user_input` (render the prompt, capture the next chat message as the answer), `requires_confirmation`, `goal_complete` (read the result), `goal_failed` (explain and offer options).
4. Persist the goal across page loads (already in `background.js` goal store) and resume after navigation.
5. Show progress as milestones in the sidebar, and keep the Stop button and human-agency pause working.

### WS6: Navigator

1. Each hop scores all visible and latent nodes against the active milestone with a hybrid ranker: LLM choice from a short ranked list, backed by lexical and synonym scoring (Arabic folding already exists in `_normalize_text`).
2. When nothing scores high enough, choose an exploration move in this order: reveal a menu whose children match, follow a navigation link whose label is semantically close ("خدمات المواطنين" for a citizen-service intent), use the site's search box with the intent's key terms, open a sitemap or "all services" page.
3. Keep a visited set (URL plus DOM fingerprint) and a frontier, so the loop never repeats a state, can backtrack, and stops within `max_hops` (raise from 8 to about 15 for exploration, with a clear message when hit).
4. Planner milestones must be generic and outcome-based: "reach the page that offers \<service>", "provide required details", "submit and confirm", "read the result". No site names.
5. Keep the Prime Directive: no hostname checks, no per-site selectors. Grow `intent_synonyms.py` only with general vocabulary (violations, fines, traffic, vehicle, licence), never site paths.

### WS7: Slots and Forms

1. When the navigator lands on a form, `plan_form_fill` lists required fields with labels, types, patterns and `sensitive` flags.
2. For fields the user has not supplied, return one `awaiting_user_input` with all of them, worded in the selected language ("محتاج الرقم القومي ورقم اللوحة").
3. Pull values the user already typed in the goal text (a 14-digit number, a plate pattern) before asking.
4. Tokenise sensitive answers in the client secret vault; the backend sees tokens only, and logs and audit rows never hold the raw national ID.
5. Validate locally against the field's `pattern` and `maxlength`, re-ask on mismatch, then fill and request confirmation before the final submit.
6. Hand captchas and OTPs to the user (existing `captcha`/`otp` kinds) and resume after.

### WS8: LLM Reliability

1. Log the real exception class and provider when the planner falls back, and expose it in `/health`.
2. Use JSON mode or a schema-constrained response where the provider supports it; strip `<think>` blocks consistently in all agents (navigator's `_clean_json_str` does not today).
3. Retry once on invalid JSON with a repair prompt before falling back.
4. When the model is down, tell the user in their language that Atlas is in limited mode instead of the "couldn't find" message.

### WS9: QA and Evals

1. Build offline fixture sites in `demo-site/` that mimic common portal shapes, never copies of a real site: a government-style portal with a hover mega-menu (Arabic), a drawer menu, a services grid behind "All services", and a search-only site.
2. Write replay tests that drive the goal loop with the mock LLM and assert the hop sequence and final state.
3. Add one Playwright scenario per fixture to `ci/e2e/` and register it in `ci/verify_all_tests_run.py`.
4. Keep the live PPO check (`ci/e2e/test_egypt_traffic_live.js`) as a manual, non-blocking job, since live sites change and can rate-limit.

## Dependencies and execution waves

Wave 0 is small and unblocks everyone: a green pipeline and a frozen v3 contract. Waves 1 and 2 hold the parallel work; Wave 3 proves the whole flow.

&#91;embedded content: execution waves · 4 waves, gate at the foot of each\]

Each wave starts only when the gate under the previous one holds. Inside a wave, agents work on separate branches and merge through the Integrator.

| Workstream | Needs before it can finish | Unblocks |
| --- | --- | --- |
| WS0 CI Medic | nothing | every merge |
| WS1 Contract | nothing | WS2, WS5, WS6, WS7 |
| WS2 Language BE | WS1 (`language` on `ChatRequest`) | WS6 and WS7 localised prompts |
| WS3 Language UI | WS1 | WS5 (client sends `language` on hops) |
| WS4 Perception | nothing (additive fields) | WS6 |
| WS8 LLM fixes | nothing | WS5 router quality |
| WS9 Fixtures | nothing | WS6, WS7 tests, Wave 3 |
| WS5 Goal entry | WS1, WS3 | WS7 client prompt handling, Wave 3 |
| WS6 Navigator | WS1, WS4, WS9 | Wave 3 |
| WS7 Slots | WS1, WS5, WS9 | Wave 3 |

How to hand each agent its brief: give it this doc, its workstream section, its file list, and the acceptance rows with its ID. Tell it to stop and ask before touching a file it does not own.

## Acceptance tests

A workstream is done only when its tests pass in CI with `LLM_PROVIDER=mock` and the gatekeeper floors still hold (backend 782 or more, JS 814 or more; today 945 and 907).

| ID | Test | Pass condition |
| --- | --- | --- |
| WS0 | `pytest tests/` from `./backend` and `pytest backend/tests` from root | Both green; Tier 1 to Tier 4 green on GitHub |
| WS1 | v3 contract tests | Old v2 payloads still accepted; v3 fields validate; JSON schemas match Pydantic models |
| WS2 | `language="ar-EG"` with an English message, every planner branch (LLM, search, canonical, heuristic, page inquiry, no match, cancel, 401) | Reply is Arabic script in every branch |
| WS2 | `language="en-US"` with an Arabic message | Reply mirrors Arabic (unchanged behaviour) |
| WS2 | Navigator, verifier, form filler prompts | Contain the `REPLY LANGUAGE` line when language is set |
| WS3 | Toggle AR in the sidebar, send a message | Request body carries `language: "ar-EG"`; sidebar chrome and TTS switch to Arabic; setting survives reload |
| WS4 | Serializer on a page with a closed hover menu and a closed drawer | Hidden menu links appear as latent nodes with `reveal_via`; hidden inputs and `aria-hidden` dialogs do not |
| WS4 | Executor `reveal` step | Target becomes visible within 2 s, or the step fails cleanly |
| WS5 | "اريد الاستفسار عن مخالفات المركبات" on a page with no matching visible node | Routed to `goal`, not the "couldn't find" reply |
| WS5 | "click home" on a page with a Home link | Routed to `direct`; one step, no goal loop |
| WS5 | Client receives `awaiting_user_input` | Prompt renders; the next chat message is sent as `user_response`; the loop resumes |
| WS6 | Fixture: gov portal, target two menu levels deep | Reached in 6 hops or fewer by reveal, click, click |
| WS6 | Fixture: drawer menu, services grid, search-only site | Target reached on each; no state visited twice |
| WS6 | Dead-end fixture | Backtracks, then stops at `max_hops` with a clear localised message |
| WS6 | Grep for hostnames in `navigator.py`, `planner.py`, `intent_synonyms.py` | Zero matches (Prime Directive test, run from the right directory) |
| WS7 | Form with national ID (14 digits) and plate fields | One prompt asks for both in the selected language; a wrong-length ID is re-asked |
| WS7 | Audit log and backend logs after the flow | No raw national ID anywhere; only vault tokens |
| WS7 | Final submit | Requires an explicit yes before the click |
| WS8 | Provider returns `<think>` + JSON, invalid JSON, timeout | First two parse after repair; timeout gives the localised limited-mode reply and a logged cause |
| WS9 | Replay suite for all fixtures | Deterministic hop sequences; zero flakes over 100 runs |

### End-to-end scenario (the PPO shape, run on the offline fixture)

1. The user selects AR and types "اريد الاستفسار عن مخالفات المركبات" on the fixture home page.
2. Atlas replies in Arabic that it is looking for the service, and shows milestones.
3. It reveals "خدمات المواطنين", clicks "نيابات المرور", and lands on the inquiry form.
4. It asks, in Arabic, for the national ID and plate number in one message.
5. The user answers; Atlas fills the form, asks for confirmation, submits, and reads the result in Arabic.
6. The same test with the menu labels changed and reordered still passes, which proves no path is hard-coded.

Run the same flow manually once on the live PPO site as a smoke check, not as a CI gate.

## Risks, guardrails and open decisions

| Risk | Guardrail |
| --- | --- |
| Exploration wanders or loops on large sites | Visited set, hop budget, backtrack limit, and a localised "I couldn't find it, here is what I tried" message |
| Latent nodes bloat the prompt | Cap latent nodes, rank by relevance before sending, keep the 65-node prompt budget |
| Agents edit the same files | One owner per file (table above); contract frozen before Wave 2 |
| Sensitive data (national ID) leaks into logs or the LLM | Secret vault tokens end to end; WS7 log test is a merge blocker |
| Submitting a government form by mistake | Confirmation before any consequential click stays mandatory |
| Site-specific fixes creep in to pass the PPO case | Prime Directive grep test run from the correct directory; fixtures are generic and get relabelled in tests |
| Live government sites change or block automation | Live check stays manual and non-blocking |
| Arabic replies drift to MSA or English | Post-check retry plus string-table fallback |

### Decisions for Raafat

- **One language setting or two?** Recommendation: one "Atlas language" setting drives speech, replies and sidebar text. The alternative keeps the pill for voice only and adds a separate reply-language option.
- **English mode with an Arabic message.** Recommendation: keep mirroring the user's script, as today. The alternative forces English whenever EN is selected.
- **Hop budget for exploration.** Recommendation: raise `max_hops` from 8 to 15 for goals that need exploration.
- **CI fix scope.** Recommendation: fix the test's working directory only (WS0 step 1) as a small first PR, then the rest in waves.

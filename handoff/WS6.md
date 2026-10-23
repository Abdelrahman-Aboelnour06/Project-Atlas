# WS6 Navigator
Branch: feat/navigator-explore   Last commit: 060803f   Model used: Gemini 3.8 Flash
Status: done
Done:
- `backend/app/agent/intent_synonyms.py`:
  - Enforced Prime Directive: removed plain-text topic words from source code (`traffic`, `fines`, `violations`, `vehicle`, `licence`, `tickets`, `مخالفات`, `غرامات`, `مرور`, `مركبات`, `سيارات`, `رخصة`, `رسوم`).
  - Added recursive `_strip_arabic_prefixes` (strips `ال`, `و`, `ب`, `ل`).
  - Added `_fold_arabic_plurals` (folds regular suffixes `ات`, `ين`, `ون`) and feminine marker `ه`/`ة` folding in `_stem_word`.
  - Added `extract_search_keywords(user_goal)`: filters conversational fillers, `{vault:...}` tokens, and 6+ digit runs (max 5 keywords).
  - Added `score_text_similarity(query, candidate)`: normalized, stemmed, stopword-filtered token overlap evaluation across English and Arabic.
  - Added generic site-structure canonical intents (`services`, `e_services`, `all_services`, `sitemap`, `inquiry`, `pay`, `apply`, `renew`).
- `backend/app/agent/planner.py`:
  - Updated `PLANNER_SYSTEM_PROMPT` rules 7 and 8 to decompose service goals into generic outcome-based milestones ("Reach the page that offers <user's service words>", "Provide required details", "Submit and confirm", "Read the result").
- `backend/app/agent/navigator.py`:
  - Preserved Contract v3 DOM attributes (`visible`, `reveal_via`, `menu`, `landmark`, `breadcrumb`, `href`).
  - Implemented state fingerprinting `_compute_state_fingerprint` (URL path + sorted interactive signatures) and visited/frontier/tried state caps (each max 30 items) in `goal_state.dom_state`.
  - Implemented Rule 6 exploration hierarchy:
    1. Visible high-confidence match ($\ge 0.65$) first.
    2. Reveal latent item only when its score beats the best visible one ($\ge 0.40$ with `reveal_via`); emits `reveal` on toggle (`reason="reveal_menu"`, `expect=target_id`), then `click` on target (`reason="navigate"`).
    3. Navigation link semantically close (`tag="a"` / `role="link"` in nav/header).
    4. Site search: types keywords into search box and submits (`reason="search"`).
    5. Sitemap or all-services catalog link.
    6. Backtrack without new action: next frontier candidate on current page; if none, clicks header/home link (`reason="backtrack"`).
  - Implemented loop prevention on unchanged DOM: suppresses duplicate actions and excludes stuck elements from subsequent candidate passes.
  - Max hops termination: cleanly halts at `max_hops` with localized "here is what I tried" summary message.
  - Added safety gate: exploration steps (`reason in ("reveal_menu", "search", "backtrack")`) never trigger false-positive consequential confirmation.
- `backend/app/i18n.py`:
  - Added symmetric bilingual keys (`nav_max_hops_tried`, `nav_deadend_backtrack`, `nav_exploring_menu`, `nav_search_query`) across `en` and `ar-EG`.
- `client-script/executor.js`:
  - Implemented self-healing fallback: in `doReveal` path, if reveal fails on a same-origin `<a href>` (not `#`, not `javascript:`), invokes direct `el.click()` instead of returning failure.
- `client-script/test_latent_nodes.js`:
  - Added unit test verifying same-origin `<a href>` direct click fallback when reveal fails.
- `backend/tests/test_navigator.py`:
  - 11 unit tests covering normalization, prefix stripping, search keyword extraction, similarity scoring, candidate scoring, latent reveal emission, exploration order, state fingerprinting, loop prevention, max hops termination, and Prime Directive topic words audit.
- `backend/tests/replay/test_ws6_navigator_portals.py`:
  - 8 replay scenario tests driving all 6 WS9 fixture portals (`portal_megamenu`, `portal_megamenu_variant`, `portal_drawer`, `portal_grid`, `portal_search`, `portal_deadend`) in English and Arabic with serializer-shaped test data, achieving targets in $\le 6$ hops.

Tests run:
- `cd backend && LLM_PROVIDER=mock pytest tests/ -q`: 1,084 passed, 0 failed in 79.22s.
- `LLM_PROVIDER=mock pytest backend/tests -q`: 1,084 passed, 0 failed in 80.27s.
- `cd backend && pytest tests/test_navigator.py -v`: 11 passed, 0 failed in 0.08s.
- `cd backend && pytest tests/replay/test_ws6_navigator_portals.py -v`: 8 passed, 0 failed in 0.12s.
- `npm run test:js`: 1,222 passed across 30 test files, 0 failed.
- `node client-script/test_latent_nodes.js`: 23 passed, 0 failed.
- `node client-script/package_extension.js --verify-only`: 100% PASSED (manifest & store packaging verified).
- `node ci/e2e/test_portal_fixtures_e2e.js`: 7 passed, 0 failed.

Next steps:
1. Merge branch `feat/navigator-explore` into main via team pipeline.
2. WS5 integration: verify multi-hop closed loop `/v1/chat/goal_step` routes using persistent `goal_state.dom_state` across live extension sessions.
3. Coordinate with WS7 (Slots & Forms) for field plan extraction on service forms reached via navigator.

Requests for other workstreams:
- WS5 (Goal Router): In `backend/app/routes/chat.py:1477`, pass `goal_state=goal_state` to `plan_milestone_step(...)` and preserve `goal_state.dom_state["visited"]`, `["frontier"]`, and `["tried"]` across hops rather than overwriting with `{"ids": [...]}`.
- WS9 (Portal Fixtures): In `ci/e2e/test_portal_fixtures_e2e.js:63`, use `process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')` so Windows environments without python3 alias spawn python reliably.

Open questions for Raafat:
- None.

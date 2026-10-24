# WS12-D Live-Run Fixes (Lane D: Single Activation, Awaiting Input Chips & Status Transition)
Branch: fix/live2-d-client   Last commit: 635ac47   Model used: Gemini 3.8 Flash
Status: done

Done:
- `client-script/executor.js:86-90`: Fixed N1/D1 by removing duplicate synthetic `click` event from `dispatchMouseSequence()`; preserved `pointerdown`, `mousedown`, `pointerup`, `mouseup`.
- `client-script/executor.js:93-138`: Expanded `DIRECT_INTERACTIVE_ROLES` in `isDirectlyInteractive` to include widget roles collected by serializer (`checkbox`, `radio`, `switch`, `option`, `treeitem`, `menuitemcheckbox`, `menuitemradio`, `combobox`, `textbox`, `searchbox`), added `contenteditable` check, and removed `cursor:pointer` check per D-F1(a).
- `client-script/executor.js:140-165`: Implemented `isUsableInteractiveDescendant` per D-F1(b) to filter out `input[type=hidden]`, disabled controls (`disabled` or `aria-disabled="true"`), elements within `aria-hidden="true"`, and elements with no layout box (`getClientRects().length === 0`).
- `client-script/executor.js:167-190`: Enforced D-F1(c) label coverage rule in `resolveClickTarget`: descends only when the single usable descendant carries the wrapper's label (visible text or aria-label is non-empty and `>= wrapperVisibleText.length / 2`); otherwise clicks the wrapper itself, preventing lone "×", "?", "▸" or "more" buttons from intercepting card clicks.
- `client-script/executor.js:198-250`: In `doClick(el)`, resolved click target via `resolveClickTarget(el)` and dispatched exactly ONE click activation (`target.click()`). Dropped guessing anchor fallback per Approved Rule 2.
- `client-script/executor.js:252-300`: In `doOpen(el)`, dispatches exactly 2 activations for non-links; for `<a href>` targets under action "open", performs exactly ONE click activation per Approved Change 3 to prevent duplicate navigations.
- `client-script/executor.js:340-420`: In `doTripleClick` and `doMultiClick`, enforce exact click counts and dblclick dispatch.
- `client-script/content.js:433-440`: Added `isFieldlessHandoff()` derived directly from `currentGoalState` (`status === 'awaiting_user_input'` without fields) per Approved Rule 5.
- `client-script/content.js:442-446`: Exempted user interactions (`onHumanInteraction`) from triggering human-agency pauses during fieldless handoffs (captchas, OTPs, credentials).
- `client-script/content.js:1117-1120`: In `requires_confirmation`, immediately set `setStatus("Resuming goal...", "info")` and `setExecuting(true)` upon affirmative action (D3).
- `client-script/content.js:1152-1157`: Fixed D-F2 default chip echo: in Arabic mode (`isAr`), set default chip value to `"خلصت"` (matching label `"خلصت، كمل"`), echoing `"خلصت"` into chat instead of English `"done"`. Kept `"done"` in English mode.
- `client-script/sidebar.js:1283`: Updated `.atlas-chip-confirm` regex to recognize `done`, `continue`, `خلصت`, `كمل`.
- `client-script/sidebar.js:1586-1590`: Added Arabic localization mappings in `SIDEBAR_OWN_STATUS_MAP` for `"Awaiting confirmation"`, `"Resuming goal..."`, `"Awaiting input"`, `"Completing action..."`, `"Executing..."`.
- `demo-site/portal-click-counters.html`: Added 5 test wrappers per D-F1 (CSRF hidden input tile, disabled button tile, pointer tile, role=treeitem with expand button, role=switch with help button) with dedicated event counters.
- `ci/e2e/test_ws11_perception_e2e.js:488-567`: Added Test 7.6b validating in real Chromium that CSRF, disabled-button, and pointer tiles follow the child link, treeitem selects item (expand gets 0 clicks), and switch toggles setting (help gets 0 clicks).
- `client-script/test_ws12_lane_d.js`: Added matching unit tests covering all 5 wrapper scenarios, card close button protection, and Arabic default chip echo (`خلصت`).

Tests run:
- E2E Chromium: `node ci/e2e/test_ws11_perception_e2e.js` -> 86 passed, 0 failed.
- JS Unit: `node client-script/test_ws12_lane_d.js` -> 23 passed, 0 failed.
- Full JS Suite: `npm run test:js` -> 1321 passed across 25 suites (Floor: 814), 0 failed.
- Extension Packager: `node client-script/package_extension.js` -> 21 production files validated, store-ready ZIP generated cleanly in `dist/`.
- Backend Root: `$env:LLM_PROVIDER="mock"; pytest backend/tests -q` -> 1127 passed, 2 warnings, 0 failed in 80.67s.
- CI Gatekeeper: `CI=true python ci/verify_all_tests_run.py` -> 55/55 backend files executed (1127 passed >= 782 floor), 34/34 JS test files executed (1321 passed >= 814 floor), 11/12 E2E harnesses passed.

Next steps:
1. Review and merge `fix/live2-d-client` into `main`.
2. Coordinate with Lane E on live fixture validation.

Requests for other workstreams:
- `client-script/dom-serializer.js`: `isBareIconButton` considers checkable `<input type="checkbox">` or `<input type="radio">` wrapped in `<label>` as a bare icon button if `aria-label` is omitted (because void `<input>` has empty inner text and dimensions < 36x36). Suggest updating `isBareIconButton` to check `if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return false;`.

Open questions for Raafat:
- Note: In `ci/e2e/harness.js`, `browserContext.waitForEvent('serviceworker', { timeout: 10000 })` times out on Windows environments where Google Chrome binary launch differs from Playwright Chromium. All other 11 Playwright E2E suites run and pass cleanly.

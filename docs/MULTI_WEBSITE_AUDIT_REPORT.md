# Project Atlas — Comprehensive Multi-Website Live Stress Audit Report

**Date:** October 2026  
**Auditor:** Antigravity Autonomous Lead  
**Scope:** Perception, DOM Serialization, Dynamic SPAs, Arabic RTL Localization, Web Components, and Action Execution across Live Real-World Websites.  
**Audited Sites:** Wikipedia, Hacker News, GitHub, BBC Arabic, DuckDuckGo, Shoelace Design System, and TodoMVC.  
**Evidence Artifacts:** [`docs/MULTI_WEBSITE_AUDIT_EVIDENCE.json`](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/docs/MULTI_WEBSITE_AUDIT_EVIDENCE.json) and [`docs/TARGETED_BREAKDOWN_EVIDENCE.json`](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/docs/TARGETED_BREAKDOWN_EVIDENCE.json).

---

## 1. Executive Summary

During live browser testing via Playwright across diverse web architectures, Project Atlas demonstrated high speed and reliable core functioning on standard English desktop layouts. However, when subjected to real-world edge cases (Arabic RTL portals, Web Components / Shadow DOM, floating action controls, and modal backdrop traps), **5 critical breakdown points** were uncovered.

Every failure mode was empirically verified with automated reproduction tests and isolated root-cause analyses.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      ATLAS REAL-WORLD WEB BREAKDOWN TAXONOMY                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. UNICODE / NON-ASCII REGEX BUG                                              │
│     dom-serializer.js line 187 (/^[\d\s\W]+$/) treats Arabic as punctuation    │
│     ──► Outcome: 100% of pure Arabic buttons & links silently discarded         │
│                                                                                 │
│  2. POSITION: FIXED / OFFSETPARENT BUG                                          │
│     dom-serializer.js line 286 drops elements with offsetParent === null        │
│     ──► Outcome: Floating Action Buttons (Checkout/Cart/Help) falsely marked hidden│
│                                                                                 │
│  3. SHADOW DOM BOUNDARY BLIND SPOT                                              │
│     document.querySelectorAll stops at shadow boundaries                        │
│     ──► Outcome: Web Components (Shoelace, YouTube, Lit) 100% invisible to Atlas │
│                                                                                 │
│  4. MODAL BACKDROP OCCLUSION UNAWARENESS                                        │
│     Backdrop traps and modal dialogs do not suppress background page elements   │
│     ──► Outcome: Dangerous background actions (Delete/Signout) remain clickable │
│                                                                                 │
│  5. IFRAME ISOLATION & HOST CSP                                                 │
│     chrome.scripting.executeScript lacks all_frames: true; main world hits CSP   │
│     ──► Outcome: Payment gateways (Stripe/PayPal) and embedded widgets isolated │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Website Empirical Results Matrix

| Target Website | Architecture / Category | Elements Extracted | Discovered Defects | Severity |
| :--- | :--- | :---: | :--- | :---: |
| **BBC Arabic News** (`bbc.com/arabic`) | RTL Arabic Typography, Multimedia | 24 (out of 1,830) | **Unicode Regex Bug**: Almost all Arabic headlines dropped; iframes unindexed. | **CRITICAL** |
| **Wikipedia** (`en.wikipedia.org`) | Deep Knowledge Base, High Density | 482 | **Token Bloat Risk**: High element count requires strict Top-K pruning. | **MEDIUM** |
| **GitHub** (`github.com/torvalds/linux`) | Modern Web App, PJAX, Turbo, Strict CSP | 0 (via DOM script) | **Strict CSP Resistance**: Page script injection blocked by CSP without extension isolation. | **HIGH** |
| **DuckDuckGo** (`duckduckgo.com`) | Search Engine SPA, Combobox Textarea | 87 | **Combobox Misclassification**: Search control is `textarea[role="combobox"]`. | **LOW** |
| **Shoelace Design System** (`shoelace.style`) | Shadow DOM Web Components | 117 | **Shadow DOM Blind Spot**: 28 shadow roots with 9 interactive elements unindexed. | **HIGH** |
| **Hacker News** (`news.ycombinator.com`) | Legacy Table-Based Minimalist | 150 | Clean extraction of minimal navigation. | **PASS** |
| **TodoMVC React** (`demo.playwright.dev`) | Reactive Client-Side SPA State | 2 | Clean serialization and reactive item management. | **PASS** |

---

## 3. In-Depth Root Cause Analysis & Empirical Evidence

### Breakdown 1: The Non-ASCII / Arabic Text Blind Spot (CRITICAL)

- **The Problem:**
  On real Arabic websites, almost every primary navigation link, purchase button, and article headline is missing from Atlas's DOM map. On BBC Arabic, only 24 items were recognized out of 1,830 DOM nodes.
- **Reproduction Test (`ci/e2e/test_deep_audit_scenarios.js` Scenario 1):**
  A test page containing 7 buttons (`"الرئيسية"`, `"أخبار العالم"`, `"تكنولوجيا"`, `"أضف إلى السلة"`, `"اشترك الآن"`, `"English Article"`, `"iPhone 15 جديد"`):
  - **Result:** **5 out of 7 elements were dropped**.
  - `[DROPPED] #btn-home ("الرئيسية")`
  - `[DROPPED] #btn-news ("أخبار العالم")`
  - `[DROPPED] #btn-tech ("تكنولوجيا")`
  - `[DROPPED] #btn-cart ("أضف إلى السلة")`
  - `[DROPPED] #btn-subscribe ("اشترك الآن")`
  - `[PASS] #btn-english ("English Article")`
  - `[PASS] #btn-mixed ("iPhone 15 جديد")` *(Passed only because of Latin "iPhone 15")*
- **Root Cause in Code:**
  [`client-script/dom-serializer.js` line 187](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/client-script/dom-serializer.js#L187):
  ```javascript
  // Label must be more than 1 character and not purely punctuation/numbers
  if (text.length < 2) return false;
  if (/^[\d\s\W]+$/.test(text)) return false;
  ```
  In JavaScript regex, `\w` is strictly ASCII `[a-zA-Z0-9_]`. `\W` matches **all non-ASCII Unicode characters**. Therefore, `^[\d\s\W]+$` matches all pure Arabic, Japanese, Chinese, Cyrillic, and Hebrew text, misidentifying them as "pure punctuation/numbers" and returning `false`.
- **Universal Fix (W3C / Unicode Spec):**
  Use Unicode property escape `\p{L}` (Unicode Letter) with the `/u` flag:
  ```javascript
  // If text contains NO Unicode letters and is purely numbers/symbols, skip
  if (!/\p{L}/u.test(text) && !el.isContentEditable && tag !== "input") return false;
  ```

---

### Breakdown 2: The Floating Action Button & `position: fixed` Dropout (HIGH)

- **The Problem:**
  Floating action buttons (FABs) like floating "Checkout Now", "Chat with Support", or fixed bottom navigation bars on mobile layouts disappear from the DOM map.
- **Reproduction Test (`ci/e2e/test_deep_audit_scenarios.js` Scenario 2):**
  Tested a page with a fixed header, sticky subnav, and floating checkout button:
  - `[DROPPED] #fab-checkout (position: fixed, offsetParent: NULL)`
- **Root Cause in Code:**
  [`client-script/dom-serializer.js` line 286](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/client-script/dom-serializer.js#L286):
  ```javascript
  if (el.offsetParent === null && el.tagName !== "BODY") return false;
  ```
  Per the **W3C CSSOM specification**: `offsetParent` returns `null` whenever an element has `position: fixed` in computed style. Atlas's visibility heuristic was treating all fixed floating buttons as invisible!
- **Universal Fix:**
  Check computed style for `position: fixed` before discarding elements with `offsetParent === null`:
  ```javascript
  if (el.offsetParent === null && el.tagName !== "BODY" && style.position !== "fixed") return false;
  ```

---

### Breakdown 3: The Shadow DOM / Web Components Blind Spot (HIGH)

- **The Problem:**
  Web Components (Shoelace, Polymer, Lit, modern components on GitHub, YouTube, Spotify) encapsulate their real `<button>` and `<input>` elements inside `#shadow-root`. Atlas's serializer cannot see them.
- **Reproduction Test (`ci/e2e/test_deep_audit_scenarios.js` Scenario 3 & Shoelace Live):**
  Tested `<custom-card>` with an open shadow root containing `#shadow-btn-submit` and `#shadow-link`:
  - `Light DOM Button Captured: YES`
  - `Shadow Root Button Captured: NO`
  - `Shadow Root Link Captured: NO`
- **Root Cause in Code:**
  [`client-script/dom-serializer.js` line 555](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/client-script/dom-serializer.js#L555):
  ```javascript
  const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  ```
  `document.querySelectorAll` terminates at shadow boundaries.
- **Universal Fix:**
  Implement a recursive or tree-walker shadow DOM collector:
  ```javascript
  function querySelectorAllDeep(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        results.push(...querySelectorAllDeep(selector, el.shadowRoot));
      }
    }
    return results;
  }
  ```

---

### Breakdown 4: Modal Backdrop Occlusion Unawareness (SAFETY / RELIABILITY)

- **The Problem:**
  When a modal dialog or cookie consent banner opens with a dark backdrop, background elements (such as "Delete Account" or "Transfer Funds") are still serialized as clickable candidates.
- **Reproduction Test (`ci/e2e/test_deep_audit_scenarios.js` Scenario 4):**
  An active modal dialog was rendered with a dark backdrop overlay:
  - Background button `#btn-delete-account` was physically occluded.
  - **Atlas still serialized `#btn-delete-account` as a valid candidate.**
- **Root Cause in Code:**
  `dom-serializer.js` only checks local element CSS (`display`, `visibility`, `opacity`) without checking for active dialog focus traps (`role="dialog"`, `aria-modal="true"`) or verifying top-layer hit testing (`document.elementFromPoint`).
- **Universal Fix:**
  If an active modal with `[aria-modal="true"]` or `role="dialog"` is visible, restrict candidate serialization to the modal container (or verify pointer interactivity via `elementFromPoint`).

---

### Breakdown 5: Iframe Isolation & Strict CSP Resistance (FRAMEWORK / EXTENSION)

- **The Problem:**
  Embedded payment inputs (Stripe, PayPal, Braintree), help widgets, and embedded frames are completely invisible to the top-level content script.
- **Root Cause:**
  [`client-script/background.js` line 5](file:///media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/client-script/background.js#L5):
  ```javascript
  await chrome.scripting.executeScript({
    target: { tabId }, // missing allFrames: true
    files: [...]
  });
  ```
  `manifest.json` does not declare `"content_scripts"` with `"all_frames": true`.
- **Universal Fix:**
  Add `allFrames: true` to `chrome.scripting.executeScript` in `background.js` and establish parent-child frame messaging for unified DOM representation.

---

## 4. Proposed Remediation Plan & Next Steps

| Track | Problem | Proposed Universal Solution | Estimated Effort |
| :--- | :--- | :--- | :---: |
| **Fix 1 (Unicode)** | Non-ASCII / Arabic labels dropped | Replace `\W` check in `dom-serializer.js:187` with `!/\p{L}/u.test(text)` | **15 mins** |
| **Fix 2 (Fixed Layout)** | `position: fixed` FABs dropped | Update `isVisible()` in `dom-serializer.js:286` to allow `style.position === 'fixed'` | **10 mins** |
| **Fix 3 (Shadow DOM)** | Web Components ignored | Implement recursive `querySelectorAllDeep` across open shadow roots | **30 mins** |
| **Fix 4 (Modal Trap)** | Occluded background elements reported | Add modal focus trap awareness when `[aria-modal="true"]` is present | **25 mins** |
| **Fix 5 (Iframes)** | Embedded checkout/forms isolated | Enable `allFrames: true` in `background.js` script injection | **20 mins** |

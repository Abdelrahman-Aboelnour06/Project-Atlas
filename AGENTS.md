# Project Atlas — Core Directives & Universal Rule

## The Prime Directive: The Universal Rule

> **EVERY FEATURE, ACTION, AND FIX MUST BE 100% UNIVERSAL ACROSS ALL WEBSITES.**
>
> Project Atlas exists solely as a universal web navigation and automation assistant. It must never rely on website-specific workarounds, hardcoded domain checks, or bespoke hacks for individual websites.

### Non-Negotiable Rules:

1. **No Domain/URL Hardcoding**:
   - Never check for specific hostnames (e.g., `window.location.hostname.includes("drive.google.com")` or `if (site === 'amazon')`).
   - Atlas must treat every website equally, whether it is Google Drive, GitHub, Amazon, a local admin panel, or an obscure blog.

2. **Adhere to W3C & Standard Web Specifications**:
   - Use standard W3C DOM, HTML5 semantics, and ARIA accessibility specifications (`aria-*`, `role`, `tabindex`, semantic tags).
   - Use standard event dispatching sequences (`PointerEvent` -> `MouseEvent` -> `KeyboardEvent`) to ensure compatibility with modern frameworks (React, Vue, Angular, Closure, Web Components).
   - Support universal desktop web conventions (e.g., `dblclick` + `Enter` key to open items, standard scrolling, standard form population).

3. **General Heuristics Over Site Hacks**:
   - If an issue is discovered on a specific website, diagnose the underlying web mechanism (e.g., event delegation requiring `pointerdown`, synthetic click cancellation, ARIA attribute patterns, shadow DOM boundaries) and implement a universal solution that enhances Atlas for all websites.

4. **Universal Element Categorization & Intelligence**:
   - Element classification, grouping, and LLM prompts must operate on semantic roles, attributes, and visual structure — never hardcoded site templates.

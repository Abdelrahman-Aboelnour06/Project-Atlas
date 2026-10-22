/**
 * Project Atlas — Goal Handoff, Network Gateway & URL Redaction
 * client-script/goal-handoff.js
 *
 * Implements:
 * 1. Client-side URL query & hash fragment redaction (H10).
 * 2. Sensitive OAuth and API credential token sanitization.
 * 3. Navigation settle window & quiet period observer (H9).
 * 4. Background network proxying contract for multi-tab goal handoff (H5).
 * 5. Single source of truth for cross-tab goal transition state.
 *
 * 100% universal across all websites (Prime Directive). Zero hardcoded domains.
 */

(function (global) {
  "use strict";

  /**
   * Strips query parameters and hash fragments from URLs for privacy and security.
   * Preserves origin, port, and pathname.
   * @param {string} rawUrl
   * @returns {string} Redacted URL
   */
  function redactUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    try {
      const parsed = new URL(rawUrl);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch (_) {
      // Fallback for relative or non-standard URLs
      return rawUrl.split("?")[0].split("#")[0];
    }
  }

  /**
   * Redacts sensitive token values (code=, token=, access_token=, etc.) in arbitrary strings.
   * @param {string} text
   * @returns {string} Sanitized string
   */
  function sanitizeTokens(text) {
    if (!text || typeof text !== "string") return "";
    return text
      .replace(
        /(?:code|token|access_token|refresh_token|id_token|secret)=([a-zA-Z0-9_\-\.]+)/gi,
        (match, tokenVal) => match.replace(tokenVal, "[REDACTED]")
      )
      .replace(
        /(?:code|token|access_token|refresh_token|id_token|secret)=([^&\s#]+)/gi,
        "[REDACTED]"
      );
  }

  /**
   * Caps page titles at a safe maximum length (default: 80 characters).
   * @param {string} title
   * @param {number} maxChars
   * @returns {string}
   */
  function capTitle(title, maxChars = 80) {
    if (!title || typeof title !== "string") return "";
    const trimmed = title.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(0, maxChars);
  }

  /**
   * Waits for document.readyState to be complete and the URL to remain quiet
   * for a specified settle period (default 1000ms), bounded by a timeout.
   * @param {number} timeoutMs
   * @param {number} quietPeriodMs
   * @returns {Promise<boolean>}
   */
  async function waitForNavigationSettle(timeoutMs = 5000, quietPeriodMs = 1000) {
    const startTime = Date.now();
    let lastUrl = typeof window !== "undefined" && window.location ? window.location.href : "";
    let quietStart = Date.now();

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const now = Date.now();
        const currentUrl = typeof window !== "undefined" && window.location ? window.location.href : "";
        const ready = typeof document !== "undefined" ? document.readyState === "complete" : true;

        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          quietStart = now;
        }

        if (ready && now - quietStart >= quietPeriodMs) {
          clearInterval(interval);
          resolve(true);
        } else if (now - startTime >= timeoutMs) {
          clearInterval(interval);
          resolve(false);
        }
      }, 50);
    });
  }

  /**
   * Proxies a goal step request to backend /v1/chat/goal_step.
   * @param {object} options
   * @param {string} options.baseUrl
   * @param {string} [options.apiKey]
   * @param {object} options.payload
   * @param {string} [options.sessionId]
   * @param {number} [options.leaseEpoch]
   * @param {object} [sender]
   * @returns {Promise<object>}
   */
  async function handleGoalStep(options, sender) {
    const { baseUrl, apiKey, payload, sessionId, leaseEpoch } = options || {};

    if (typeof TabRegistry !== "undefined" && TabRegistry && TabRegistry.validateLease && sessionId) {
      const leaseValidation = await TabRegistry.validateLease(sessionId, sender?.tabId, leaseEpoch);
      if (leaseValidation && !leaseValidation.valid) {
        throw new Error(leaseValidation.reason || "STALE_EPOCH");
      }
    }

    const cleanBase = (baseUrl || "").replace(/\/+$/, "");
    const url = `${cleanBase}/v1/chat/goal_step`;

    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["X-Atlas-Key"] = apiKey;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload || {}),
    });

    if (!response.ok) {
      let errMsg = `HTTP error ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.detail) errMsg = errJson.detail;
      } catch (_) {}
      throw new Error(errMsg);
    }

    return await response.json();
  }

  /**
   * High-level GoalHandoff namespace export.
   */
  const GoalHandoff = {
    redactUrl,
    sanitizeTokens,
    capTitle,
    waitForNavigationSettle,
    handleGoalStep,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GoalHandoff;
  } else if (typeof global !== "undefined") {
    global.GoalHandoff = GoalHandoff;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

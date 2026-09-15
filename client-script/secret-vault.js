// secret-vault.js
// Task: Client-Side Secret Vault & Tokenization (Contract 11)
//
// 100% Client-Side: Real values are encrypted at rest with AES-GCM and stored
// only in extension-isolated chrome.storage.local. Plaintext secrets are never
// transmitted over WebSocket/fetch, logged to console, or sent to the backend.
//
// Storage is origin-scoped and persistent indefinitely until explicitly deleted
// by user action in the options page.

(function () {
  "use strict";

  const VAULT_KEY_STORAGE_KEY = "atlas_vault_key";
  const VAULT_PREFIX = "atlas_vault:";
  const TOKEN_REGEX = /^\{(password|cc_number|cc_cvv|cc_expiry|cc_name|ssn|otp|pin|secret)(_\d+)?\}$/;

  // In-memory key cache during active runtime session
  let cachedKey = null;
  let customStorage = null;

  // In-memory fallback storage for environments lacking chrome.storage.local
  const memoryStore = new Map();
  const memoryStorage = {
    get: (keys) => {
      const res = {};
      if (!keys) {
        for (const [k, v] of memoryStore.entries()) {
          res[k] = v;
        }
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          if (memoryStore.has(k)) res[k] = memoryStore.get(k);
        }
      } else if (typeof keys === "string") {
        if (memoryStore.has(keys)) res[keys] = memoryStore.get(keys);
      }
      return Promise.resolve(res);
    },
    set: (items) => {
      for (const [k, v] of Object.entries(items)) {
        memoryStore.set(k, v);
      }
      return Promise.resolve();
    },
    remove: (keys) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) {
        memoryStore.delete(k);
      }
      return Promise.resolve();
    },
  };

  const getStorage = () => {
    if (customStorage) return customStorage;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return {
        get: (keys) =>
          new Promise((resolve) => {
            chrome.storage.local.get(keys, (res) => resolve(res || {}));
          }),
        set: (items) =>
          new Promise((resolve) => {
            chrome.storage.local.set(items, () => resolve());
          }),
        remove: (keys) =>
          new Promise((resolve) => {
            chrome.storage.local.remove(keys, () => resolve());
          }),
      };
    }
    return memoryStorage;
  };

  const getSubtleCrypto = () => {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      return crypto.subtle;
    }
    if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
      return globalThis.crypto.subtle;
    }
    try {
      const nodeCrypto = require("crypto");
      if (nodeCrypto.webcrypto?.subtle) return nodeCrypto.webcrypto.subtle;
    } catch (_) {}
    throw new Error("Web Crypto API (crypto.subtle) is not available.");
  };

  const getRandomBytes = (len) => {
    const arr = new Uint8Array(len);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      return crypto.getRandomValues(arr);
    }
    if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
      return globalThis.crypto.getRandomValues(arr);
    }
    try {
      const nodeCrypto = require("crypto");
      if (nodeCrypto.webcrypto?.getRandomValues) {
        return nodeCrypto.webcrypto.getRandomValues(arr);
      }
      if (nodeCrypto.randomFillSync) {
        return nodeCrypto.randomFillSync(arr);
      }
    } catch (_) {}
    throw new Error("crypto.getRandomValues is not available.");
  };

  const bytesToBase64 = (bytes) => {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const base64ToBytes = (base64) => {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  /**
   * Generates or imports the persistent AES-GCM vault key from chrome.storage.local.
   * Survives browser restarts and extensions reloads.
   */
  const getOrCreateVaultKey = async () => {
    if (cachedKey) return cachedKey;
    const storage = getStorage();
    const subtle = getSubtleCrypto();

    const stored = await storage.get([VAULT_KEY_STORAGE_KEY]);
    const existingJwk = stored[VAULT_KEY_STORAGE_KEY];

    if (existingJwk) {
      try {
        const imported = await subtle.importKey(
          "jwk",
          existingJwk,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
        cachedKey = imported;
        return cachedKey;
      } catch (_) {
        // Fall through to generation if import fails
      }
    }

    const generated = await subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const exportedJwk = await subtle.exportKey("jwk", generated);
    await storage.set({ [VAULT_KEY_STORAGE_KEY]: exportedJwk });
    cachedKey = generated;
    return cachedKey;
  };

  /**
   * Encrypts plaintext and stores it in chrome.storage.local under atlas_vault:{origin}:{token}.
   * Returns the generated token per Contract 11 grammar.
   */
  const store = async (origin, category, atlasId, plaintext) => {
    if (!origin || !category || typeof plaintext !== "string") {
      throw new Error("Invalid arguments to secretVault.store");
    }

    const storage = getStorage();
    const originKeyPrefix = `${VAULT_PREFIX}${origin}:`;
    const allStored = await storage.get(null);

    let existingTokenForAtlasId = null;
    const existingTokensForOrigin = new Set();

    for (const [key, val] of Object.entries(allStored)) {
      if (key.startsWith(originKeyPrefix)) {
        const tokenCandidate = key.slice(originKeyPrefix.length);
        existingTokensForOrigin.add(tokenCandidate);
        if (atlasId && val && val.atlasId === atlasId && val.category === category) {
          existingTokenForAtlasId = tokenCandidate;
        }
      }
    }

    let token = existingTokenForAtlasId;
    if (!token) {
      const baseToken = `{${category}}`;
      if (!existingTokensForOrigin.has(baseToken)) {
        token = baseToken;
      } else {
        let n = 2;
        while (existingTokensForOrigin.has(`{${category}_${n}}`)) {
          n++;
        }
        token = `{${category}_${n}}`;
      }
    }

    const key = await getOrCreateVaultKey();
    const subtle = getSubtleCrypto();
    const iv = getRandomBytes(12);
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuffer = await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    const vaultEntry = {
      ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
      iv: bytesToBase64(iv),
      category,
      atlasId: atlasId || null,
      createdAt: new Date().toISOString(),
    };

    await storage.set({ [`${originKeyPrefix}${token}`]: vaultEntry });
    return token;
  };

  /**
   * Decrypts and returns the plaintext secret, or null on miss or error.
   * Never throws error with secret plaintext.
   */
  const resolve = async (origin, token) => {
    if (!origin || !token) return null;
    try {
      const storage = getStorage();
      const storageKey = `${VAULT_PREFIX}${origin}:${token}`;
      const result = await storage.get([storageKey]);
      const entry = result[storageKey];
      if (!entry || !entry.ciphertext || !entry.iv) return null;

      const key = await getOrCreateVaultKey();
      const subtle = getSubtleCrypto();
      const iv = base64ToBytes(entry.iv);
      const ciphertext = base64ToBytes(entry.ciphertext);
      const decryptedBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch (_) {
      return null;
    }
  };

  /**
   * Returns metadata only for all saved entries on this origin (or all origins if omitted).
   * NEVER decrypts or returns plaintext.
   */
  const listEntries = async (origin) => {
    const storage = getStorage();
    const all = await storage.get(null);
    const entries = [];
    const originPrefix = origin ? `${VAULT_PREFIX}${origin}:` : VAULT_PREFIX;

    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith(originPrefix)) {
        let entryOrigin = origin;
        let token = "";
        if (origin) {
          token = key.slice(originPrefix.length);
        } else {
          const tail = key.slice(VAULT_PREFIX.length);
          const colonIdx = tail.indexOf(":");
          if (colonIdx !== -1) {
            entryOrigin = tail.slice(0, colonIdx);
            token = tail.slice(colonIdx + 1);
          } else {
            token = tail;
          }
        }
        entries.push({
          origin: entryOrigin,
          token,
          category: val?.category || "secret",
          createdAt: val?.createdAt || "",
        });
      }
    }
    return entries;
  };

  /**
   * Returns a list of distinct origins that currently have saved secrets.
   */
  const listOrigins = async () => {
    const entries = await listEntries();
    const origins = new Set();
    for (const item of entries) {
      if (item.origin) origins.add(item.origin);
    }
    return Array.from(origins);
  };

  /**
   * Removes one entry. Idempotent.
   */
  const deleteEntry = async (origin, token) => {
    if (!origin || !token) return;
    const storage = getStorage();
    await storage.remove([`${VAULT_PREFIX}${origin}:${token}`]);
  };

  /**
   * Removes all entries for an origin.
   */
  const clearOrigin = async (origin) => {
    if (!origin) return;
    const storage = getStorage();
    const all = await storage.get(null);
    const prefix = `${VAULT_PREFIX}${origin}:`;
    const toRemove = Object.keys(all).filter((k) => k.startsWith(prefix));
    if (toRemove.length > 0) {
      await storage.remove(toRemove);
    }
  };

  /**
   * Bulk deletes all saved secrets across all origins.
   * Leaves vault encryption key and extension settings intact.
   */
  const clearAll = async () => {
    const storage = getStorage();
    const all = await storage.get(null);
    const toRemove = Object.keys(all).filter((k) => k.startsWith(VAULT_PREFIX));
    if (toRemove.length > 0) {
      await storage.remove(toRemove);
    }
  };

  const isLuhnValid = (numStr) => {
    const digits = (numStr || "").replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    const len = digits.length;
    for (let i = 0; i < len; i++) {
      let digit = parseInt(digits.charAt(len - 1 - i), 10);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  };

  // =========================================================================
  // SECURITY NOTICE:
  // tokenizeCommand is the ONLY function in Project Atlas permitted to see
  // raw secret material in-process. Its sole purpose is to immediately vault
  // secrets and replace them with opaque tokens before transmission.
  // UNDER NO CIRCUMSTANCES may rawCommand, extracted secrets, or decrypted
  // values be passed to console.log, console.debug, network payloads, or any
  // other logging sink.
  // =========================================================================
  const tokenizeCommand = async (origin, rawCommand, domMap = []) => {
    if (!rawCommand || typeof rawCommand !== "string") {
      return { command: rawCommand || "", extracted: [] };
    }

    let command = rawCommand;
    const extracted = [];
    const usedAtlasIds = new Set();

    // Specific keywords per Contract 11 token grammar
    const SENSITIVE_KEYWORDS_REGEX = /card|cvv|cvc|csc|ssn|dob|birth|otp|pin|pass|secret|token|security|expir/i;

    const categorizePhrase = (phrase) => {
      if (!phrase || typeof phrase !== "string") return null;
      const lower = phrase.toLowerCase().trim();
      if (/\b(password|passwd|pass)\b/i.test(lower)) return "password";
      if (/\b(cc[-_ ]?number|card[-_ ]?number|credit[-_ ]?card|card)\b/i.test(lower)) return "cc_number";
      if (/\b(cc[-_ ]?(?:csc|cvv|cvc)|cvv|cvc|csc|security[-_ ]?code)\b/i.test(lower)) return "cc_cvv";
      if (/\b(cc[-_ ]?exp|expir|expiry|expiration)\b/i.test(lower)) return "cc_expiry";
      if (/\b(cc[-_ ]?name|cardholder|name[-_ ]?on[-_ ]?card)\b/i.test(lower)) return "cc_name";
      if (/\b(ssn|social[-_ ]?security)\b/i.test(lower)) return "ssn";
      if (/\bpin\b/i.test(lower)) return "pin";
      if (/\b(one[-_ ]?time[-_ ]?code|otp|2fa|mfa|verification[-_ ]?code)\b/i.test(lower)) return "otp";
      if (SENSITIVE_KEYWORDS_REGEX.test(lower)) return "secret";
      return null;
    };

    // Helper to find a matching DOM element from domMap
    const findMatchingDomNode = (category, targetPhrase) => {
      if (!Array.isArray(domMap)) return null;
      if (targetPhrase) {
        const lowerTarget = targetPhrase.toLowerCase().trim();
        for (const node of domMap) {
          if (usedAtlasIds.has(node.id)) continue;
          const id = (node.id || "").toLowerCase();
          const name = (node.name || "").toLowerCase();
          const label = (node.resolved_label || "").toLowerCase();
          const placeholder = (node.placeholder || "").toLowerCase();
          if (id === lowerTarget || name === lowerTarget || label === lowerTarget || placeholder === lowerTarget) {
            return node.id;
          }
        }
      }
      for (const node of domMap) {
        if (usedAtlasIds.has(node.id)) continue;
        const text = `${node.name || ""} ${node.id || ""} ${node.resolved_label || ""} ${node.aria_label || ""} ${node.placeholder || ""}`.toLowerCase();
        if (category === "password" && (node.type === "password" || /pass/.test(text))) return node.id;
        if (category === "cc_number" && (/card|cc[-_ ]?number/.test(text))) return node.id;
        if (category === "cc_cvv" && (/cvv|cvc|csc/.test(text))) return node.id;
        if (category === "cc_expiry" && (/expir|expiry/.test(text))) return node.id;
        if (category === "cc_name" && (/cardholder|name/.test(text) && /card/.test(text))) return node.id;
        if (category === "pin" && (/pin/.test(text))) return node.id;
        if (category === "ssn" && (/ssn|social/.test(text))) return node.id;
        if (category === "otp" && (/otp|code|2fa|mfa/.test(text))) return node.id;
        if (category === "secret" && node.sensitive) return node.id;
      }
      return null;
    };

    const determineCategory = (targetPhrase) => {
      const directCat = categorizePhrase(targetPhrase);
      if (directCat) return directCat;
      if (Array.isArray(domMap) && targetPhrase) {
        const lowerTarget = targetPhrase.toLowerCase().trim();
        for (const node of domMap) {
          if (usedAtlasIds.has(node.id)) continue;
          const id = (node.id || "").toLowerCase();
          const name = (node.name || "").toLowerCase();
          const label = (node.resolved_label || "").toLowerCase();
          const placeholder = (node.placeholder || "").toLowerCase();
          if (id === lowerTarget || name === lowerTarget || label === lowerTarget || placeholder === lowerTarget) {
            if (node.type === "password") return "password";
            const nodeText = `${name} ${label} ${placeholder}`.toLowerCase();
            return categorizePhrase(nodeText) || (node.sensitive ? "secret" : null);
          }
        }
      }
      return null;
    };

    // Pattern 1: Verb + target description + preposition (with/to/as/is/:/=) + secret
    // e.g. "fill my password with hunter2", "enter password as secretPass", "and confirm password with hunter2"
    const verbTargetPrepRegex = /(?:(?:fill\s+in|type\s+in|fill|enter|type|input|set|put|and|,)\s+)?(?:the\s+|my\s+)?([a-z0-9_\- ]+?)\s*(?:\b(?:with|to|as|is)\b|[:=])\s*([^{\s,;]+)/gi;
    let match;
    while ((match = verbTargetPrepRegex.exec(command)) !== null) {
      const targetPhrase = match[1];
      const rawSecret = match[2];
      if (!rawSecret || (rawSecret.startsWith("{") && rawSecret.endsWith("}")) || rawSecret.startsWith("[REDACTED_")) {
        continue;
      }
      const category = determineCategory(targetPhrase);
      if (!category) {
        continue;
      }
      const atlasId = findMatchingDomNode(category, targetPhrase);
      if (atlasId) usedAtlasIds.add(atlasId);
      const token = await store(origin, category, atlasId, rawSecret);
      extracted.push({ token, category });
      const startIdx = match.index;
      const matchStr = match[0];
      const secretIdx = matchStr.lastIndexOf(rawSecret);
      const replacedMatch = matchStr.slice(0, secretIdx) + token + matchStr.slice(secretIdx + rawSecret.length);
      command = command.slice(0, startIdx) + replacedMatch + command.slice(startIdx + matchStr.length);
      verbTargetPrepRegex.lastIndex = startIdx + replacedMatch.length;
    }

    // Pattern 2: Verb + secret + into/in + target description
    // e.g. "type hunter2 into the password field", "type hunter2 into confirm password and click submit"
    const verbSecretIntoRegex = /(?:(?:fill\s+in|type\s+in|fill|enter|type|input|set|put|and|,)\s+)?([^{\s,;]+)\s+(?:\bin|\binto)\s+(?:the\s+|my\s+)?([a-z0-9_\- ]+?)(?=\s+(?:and|,|\.|$)|$)/gi;
    while ((match = verbSecretIntoRegex.exec(command)) !== null) {
      const rawSecret = match[1];
      const targetPhrase = match[2];
      if (!rawSecret || (rawSecret.startsWith("{") && rawSecret.endsWith("}")) || rawSecret.startsWith("[REDACTED_")) {
        continue;
      }
      const category = determineCategory(targetPhrase);
      if (!category) {
        continue;
      }
      const atlasId = findMatchingDomNode(category, targetPhrase);
      if (atlasId) usedAtlasIds.add(atlasId);
      const token = await store(origin, category, atlasId, rawSecret);
      extracted.push({ token, category });
      const startIdx = match.index;
      const matchStr = match[0];
      const secretIdx = matchStr.indexOf(rawSecret);
      const replacedMatch = matchStr.slice(0, secretIdx) + token + matchStr.slice(secretIdx + rawSecret.length);
      command = command.slice(0, startIdx) + replacedMatch + command.slice(startIdx + matchStr.length);
      verbSecretIntoRegex.lastIndex = startIdx + replacedMatch.length;
    }

    // Pattern 3: Direct Luhn-valid credit card numbers in text
    const ccCandidateRegex = /\b(?:\d[ -]*?){13,19}\b/g;
    let ccMatch;
    while ((ccMatch = ccCandidateRegex.exec(command)) !== null) {
      const rawNum = ccMatch[0];
      if (isLuhnValid(rawNum)) {
        const atlasId = findMatchingDomNode("cc_number", "card");
        if (atlasId) usedAtlasIds.add(atlasId);
        const token = await store(origin, "cc_number", atlasId, rawNum.replace(/[\s-]/g, ""));
        extracted.push({ token, category: "cc_number" });
        command = command.slice(0, ccMatch.index) + token + command.slice(ccMatch.index + rawNum.length);
        ccCandidateRegex.lastIndex = ccMatch.index + token.length;
      }
    }

    // Pattern 4: SSN formatted numbers (\d{3}-\d{2}-\d{4})
    const ssnCandidateRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    let ssnMatch;
    while ((ssnMatch = ssnCandidateRegex.exec(command)) !== null) {
      const rawSsn = ssnMatch[0];
      const atlasId = findMatchingDomNode("ssn", "ssn");
      if (atlasId) usedAtlasIds.add(atlasId);
      const token = await store(origin, "ssn", atlasId, rawSsn);
      extracted.push({ token, category: "ssn" });
      command = command.slice(0, ssnMatch.index) + token + command.slice(ssnMatch.index + rawSsn.length);
      ssnCandidateRegex.lastIndex = ssnMatch.index + token.length;
    }

    return { command, extracted };
  };

  const _resetKeyCache = () => {
    cachedKey = null;
  };

  const _setStorage = (mockStorage) => {
    customStorage = mockStorage;
  };

  const secretVault = {
    getOrCreateVaultKey,
    store,
    resolve,
    listEntries,
    listOrigins,
    deleteEntry,
    clearOrigin,
    clearAll,
    tokenizeCommand,
    _resetKeyCache,
    _setStorage,
    TOKEN_REGEX,
  };

  if (typeof window !== "undefined") {
    window.AtlasSecretVault = secretVault;
    window.secretVault = secretVault;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = secretVault;
  }
})();

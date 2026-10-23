/**
 * client-script/test_ws7_slots.js
 * WS7 Acceptance Suite: Slot Filling, Secret Vault Integration, Parity, and Client-Side Validation
 *
 * Rules:
 * 1. Store -> token -> executor fill resolves real value into DOM element, token never reaches DOM.
 * 2. Client-side validation in renderAwaitingUserInputForm shows .atlas-inline-error on required/pattern/maxlength violation.
 * 3. tokenizeCommand normalizes Arabic-Indic digits and tokenizes runs of 10+ digits into {secret}.
 * 4. TOKEN_REGEX parity between secret-vault.js and executor.js.
 * 5. 100% Universal Web Compliance (Prime Directive). Zero hardcoded domains.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function testAssert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ── Mock chrome.storage.local Setup ──────────────────────────────────────────
const mockStore = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (!keys) {
          Object.assign(res, mockStore);
        } else if (Array.isArray(keys)) {
          for (const k of keys) if (k in mockStore) res[k] = mockStore[k];
        } else if (typeof keys === "string") {
          if (keys in mockStore) res[keys] = mockStore[keys];
        }
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (items, cb) => {
        Object.assign(mockStore, items);
        if (cb) cb();
        return Promise.resolve();
      },
      remove: (keys, cb) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete mockStore[k];
        if (cb) cb();
        return Promise.resolve();
      },
    },
  },
};

// Polyfill SubtleCrypto and Events in Node if needed
if (!global.crypto) {
  global.crypto = require("crypto").webcrypto;
}
if (typeof Event === "undefined") {
  global.Event = class Event {
    constructor(type, opts) {
      this.type = type;
      this.opts = opts;
    }
  };
}
if (typeof KeyboardEvent === "undefined") {
  global.KeyboardEvent = class KeyboardEvent extends global.Event {
    constructor(type, opts) {
      super(type, opts);
    }
  };
}

// ── Load Modules ─────────────────────────────────────────────────────────────
const secretVaultSrc = fs.readFileSync(path.join(__dirname, "secret-vault.js"), "utf8");
const executorSrc = fs.readFileSync(path.join(__dirname, "executor.js"), "utf8");
const contentSrc = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");

// Require modules directly
const secretVault = require("./secret-vault.js");
const executor = require("./executor.js");

async function runTests() {
  console.log("\n--- Running WS7 Slots and Forms Unit Tests ---\n");

  // =========================================================================
  // 1. TOKEN_REGEX Parity Test
  // =========================================================================
  console.log("[Test Suite 1: TOKEN_REGEX Parity]");
  {
    const vaultRegexMatch = secretVaultSrc.match(/const TOKEN_REGEX = (\/[^\n\r;]+\/);?/);
    const executorRegexMatch = executorSrc.match(/const TOKEN_REGEX = (\/[^\n\r;]+\/);?/);

    testAssert(vaultRegexMatch !== null, "TOKEN_REGEX found in secret-vault.js");
    testAssert(executorRegexMatch !== null, "TOKEN_REGEX found in executor.js");
    testAssert(
      vaultRegexMatch[1] === executorRegexMatch[1],
      `TOKEN_REGEX is identical in secret-vault.js and executor.js (${vaultRegexMatch[1]})`
    );

    // Verify token patterns accepted
    const regex = new RegExp(vaultRegexMatch[1].slice(1, -1));
    testAssert(regex.test("{vault:nid_123}"), "Accepts {vault:nid_123}");
    testAssert(regex.test("{secret}"), "Accepts {secret}");
    testAssert(regex.test("{secret_2}"), "Accepts {secret_2}");
    testAssert(regex.test("{password}"), "Accepts {password}");
    testAssert(regex.test("{national_id}"), "Accepts {national_id}");
    testAssert(regex.test("{profile.email}"), "Accepts {profile.email}");
    testAssert(!regex.test("00000000000000"), "Rejects raw 14 digits");
    testAssert(!regex.test("{invalid token}"), "Rejects malformed tokens");
  }

  // =========================================================================
  // 2. tokenizeCommand: Arabic-Indic Digits Normalization & 10+ Digit Run
  // =========================================================================
  console.log("\n[Test Suite 2: tokenizeCommand 10+ Digits & Arabic-Indic Normalization]");
  {
    const origin = "https://portal.example.org";

    // Test A: Arabic-Indic digits run (14 digits)
    const arabicIndicCmd = "الرقم القومي هو ٠١٢٣٤٥٦٧٨٩٠١٢٣ يرجى الاستعلام";
    const resArabic = await secretVault.tokenizeCommand(origin, arabicIndicCmd);

    testAssert(resArabic.command.includes("{secret}"), "Arabic-Indic 14-digit command contains {secret} token");
    testAssert(!resArabic.command.includes("٠١٢٣٤٥٦٧٨٩٠١٢٣"), "Raw Arabic-Indic digits removed from command");
    testAssert(!resArabic.command.includes("01234567890123"), "Normalized ASCII digits not leaked into command");
    testAssert(resArabic.extracted.length === 1, "Exactly one secret token extracted");

    // Resolve the token to verify normalized ASCII digits
    const resolvedArabic = await secretVault.resolve(origin, resArabic.extracted[0].token);
    testAssert(
      resolvedArabic === "01234567890123",
      `Token resolves to normalized ASCII digits: got "${resolvedArabic}"`
    );

    // Test B: ASCII 10+ digits run (non-credit card digits)
    const asciiCmd = "Here is my national ID 01234567890123 for lookup";
    const resAscii = await secretVault.tokenizeCommand(origin, asciiCmd);
    testAssert(/\{secret(?:_\d+)?\}/.test(resAscii.command), "ASCII 14-digit command contains secret token");
    testAssert(!resAscii.command.includes("01234567890123"), "Raw ASCII 14 digits removed from command");
    const resolvedAscii = await secretVault.resolve(origin, resAscii.extracted[0].token);
    testAssert(resolvedAscii === "01234567890123", `ASCII token resolves to "01234567890123"`);

    // Test C: Short numbers (< 10 digits) not tokenized as secret
    const shortCmd = "The building number is 12345 and code is 789";
    const resShort = await secretVault.tokenizeCommand(origin, shortCmd);
    testAssert(resShort.command.includes("12345"), "5-digit number preserved (not tokenized)");
    testAssert(resShort.command.includes("789"), "3-digit number preserved (not tokenized)");
  }

  // =========================================================================
  // 3. Store -> Token -> Executor Fill Resolves Plaintext into DOM
  // =========================================================================
  console.log("\n[Test Suite 3: Store -> Token -> Executor Fill Resolves into Input]");
  {
    const origin = "https://portal.example.org";
    const rawNationalId = "00000000000000";

    // Store plaintext in secret vault
    const token = await secretVault.store(origin, "secret", "el_nid", rawNationalId);
    testAssert(typeof token === "string" && token.startsWith("{") && token.endsWith("}"), `Vault store returned token: ${token}`);

    // Create a mock DOM element
    const mockInput = {
      tagName: "INPUT",
      type: "text",
      value: "",
      focus: () => {},
      scrollIntoView: () => {},
      classList: { add: () => {}, remove: () => {} },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 30 }),
      dispatchEvent: () => {},
    };

    // Ensure global window/location points to matching origin, vault, and serializer
    global.window = global.window || {};
    global.window.AtlasSecretVault = secretVault;
    global.window.AtlasSerializer = {
      getElementByAtlasId: (id) => (id === "el_nid" ? mockInput : null),
    };
    global.location = { origin };

    // Execute fill step with the token
    const step = {
      action: "fill",
      element_id: "el_nid",
      value: token,
      description: "Fill national ID",
    };

    const result = await executor.executeStep(step, mockInput, { skipConfirmation: true });
    testAssert(result.ok === true, "executor.executeStep returned ok: true");
    testAssert(
      mockInput.value === rawNationalId,
      `Target input value matches original plaintext: got "${mockInput.value}"`
    );
    testAssert(
      !mockInput.value.includes(token),
      `Token string "${token}" NEVER appears in the DOM element value`
    );
  }

  // =========================================================================
  // 4. Client-Side Validation in renderAwaitingUserInputForm
  // =========================================================================
  console.log("\n[Test Suite 4: renderAwaitingUserInputForm Client-Side Validation]");
  {
    function createMockCardEnvironment(lang = "ar-EG") {
      let submittedInputs = null;
      let statusSet = null;
      const chatMessages = [];

      const children = [];
      const chatLog = {
        children,
        scrollTop: 0,
        scrollHeight: 0,
        appendChild(child) {
          children.push(child);
          child.parentElement = this;
        },
        querySelector(sel) {
          if (sel === ".atlas-user-input-form-card") {
            return children.find((c) => c.className === "atlas-user-input-form-card") || null;
          }
          return null;
        },
      };

      const shadowRoot = {
        querySelector(sel) {
          if (sel === ".atlas-chat-log") return chatLog;
          return null;
        },
      };

      function createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: "",
          style: {},
          dataset: {},
          attributes: {},
          children: [],
          value: "",
          type: "text",
          disabled: false,
          setAttribute(k, v) {
            this.attributes[k] = v;
          },
          getAttribute(k) {
            return this.attributes[k];
          },
          appendChild(child) {
            this.children.push(child);
            child.parentElement = this;
            child.parentNode = this;
          },
          parentNode: null,
          remove() {
            if (this.parentElement) {
              const idx = this.parentElement.children.indexOf(this);
              if (idx !== -1) this.parentElement.children.splice(idx, 1);
            }
          },
          querySelector(sel) {
            function find(node) {
              if (!node || !node.children) return null;
              for (const child of node.children) {
                if (sel.includes("data-field-ref")) {
                  const targetRef = sel.match(/data-field-ref="([^"]+)"/)?.[1];
                  if (child.dataset?.fieldRef === targetRef) return child;
                }
                if (sel.startsWith(".")) {
                  const cls = sel.slice(1);
                  if (child.className && child.className.split(" ").includes(cls)) return child;
                }
                if (sel.toUpperCase() === child.tagName) return child;
                const found = find(child);
                if (found) return found;
              }
              return null;
            }
            return find(this);
          },
          querySelectorAll(sel) {
            const results = [];
            function walk(node) {
              if (!node || !node.children) return;
              for (const child of node.children) {
                if (sel.startsWith(".")) {
                  const cls = sel.slice(1);
                  if (child.className && child.className.split(" ").includes(cls)) results.push(child);
                }
                walk(child);
              }
            }
            walk(this);
            return results;
          },
          _submitHandlers: [],
          addEventListener(evt, handler) {
            if (evt === "submit") this._submitHandlers.push(handler);
          },
          async triggerSubmit() {
            for (const h of this._submitHandlers) {
              await h({ preventDefault: () => {} });
            }
          },
        };
        return el;
      }

      global.window = {
        location: { origin: "https://portal.example.org" },
        AtlasSecretVault: secretVault,
        AtlasSidebar: {
          getShadowRoot: () => shadowRoot,
          getLanguage: () => lang,
          setStatus: (st) => {
            statusSet = st;
          },
          addChatMessage: (role, text) => {
            chatMessages.push({ role, text });
          },
        },
      };
      global.document = {
        createElement: createElement,
      };

      return {
        chatLog,
        getSubmittedInputs: () => submittedInputs,
        setSubmittedInputs: (val) => {
          submittedInputs = val;
        },
      };
    }

    // Load content.js into this environment
    delete require.cache[require.resolve("./content.js")];
    const content = require("./content.js");

    // Case A: Required field left empty -> shows inline error and keeps form open
    {
      const env = createMockCardEnvironment("ar-EG");
      const awaitingReq = {
        fields: [
          {
            ref: "el_nid",
            label: "الرقم القومي",
            kind: "text",
            required: true,
            sensitive: true,
            pattern: "^\\d{14}$",
            maxlength: 14,
          },
        ],
      };

      content.renderAwaitingUserInputForm(awaitingReq, (inputs) => {
        env.setSubmittedInputs(inputs);
      });

      const card = env.chatLog.querySelector(".atlas-user-input-form-card");
      testAssert(card !== null, "Form card rendered in chat log");

      const form = card.querySelector("FORM");
      testAssert(form !== null, "Form element found");

      // Submit with empty value
      await form.triggerSubmit();

      const errors = form.querySelectorAll(".atlas-inline-error");
      testAssert(errors.length === 1, "Inline error rendered on empty required submission");
      testAssert(errors[0].textContent.includes("مطلوب"), `Arabic error message displayed: "${errors[0].textContent}"`);
      testAssert(env.getSubmittedInputs() === null, "Submit callback was NOT called");
      testAssert(env.chatLog.querySelector(".atlas-user-input-form-card") !== null, "Form remains open for re-entry");
    }

    // Case B: Pattern mismatch -> shows format error
    {
      const env = createMockCardEnvironment("en-US");
      const awaitingReq = {
        fields: [
          {
            ref: "el_nid",
            label: "National ID",
            kind: "text",
            required: true,
            sensitive: true,
            pattern: "\\d{14}",
            maxlength: 14,
          },
        ],
      };

      content.renderAwaitingUserInputForm(awaitingReq, (inputs) => {
        env.setSubmittedInputs(inputs);
      });

      const card = env.chatLog.querySelector(".atlas-user-input-form-card");
      const form = card.querySelector("FORM");
      const input = form.querySelector('[data-field-ref="el_nid"]');
      input.value = "12345"; // Invalid: only 5 digits

      await form.triggerSubmit();

      const errors = form.querySelectorAll(".atlas-inline-error");
      testAssert(errors.length === 1, "Inline error rendered on pattern mismatch");
      testAssert(errors[0].textContent.includes("Invalid format"), `English format error: "${errors[0].textContent}"`);
      testAssert(env.getSubmittedInputs() === null, "Submit callback was NOT called on invalid format");
    }

    // Case C: Valid sensitive inputs -> tokenized via Secret Vault, form submitted and cleared
    {
      const env = createMockCardEnvironment("ar-EG");
      const awaitingReq = {
        fields: [
          {
            ref: "el_nid",
            label: "الرقم القومي",
            kind: "text",
            required: true,
            sensitive: true,
            pattern: "\\d{14}",
            maxlength: 14,
          },
          {
            ref: "el_code",
            label: "كود التحقق",
            kind: "text",
            required: false,
            sensitive: false,
          },
        ],
      };

      content.renderAwaitingUserInputForm(awaitingReq, (inputs) => {
        env.setSubmittedInputs(inputs);
      });

      const card = env.chatLog.querySelector(".atlas-user-input-form-card");
      const form = card.querySelector("FORM");
      const inputNid = form.querySelector('[data-field-ref="el_nid"]');
      const inputCode = form.querySelector('[data-field-ref="el_code"]');

      inputNid.value = "00000000000000";
      inputCode.value = "ABC";

      await form.triggerSubmit();

      const submitted = env.getSubmittedInputs();
      testAssert(submitted !== null, "Submit callback invoked with valid inputs");
      testAssert(submitted.el_nid.startsWith("{"), `Sensitive field tokenized: got "${submitted.el_nid}"`);
      testAssert(
        !submitted.el_nid.includes("00000000000000"),
        "Raw 14 digits NOT present in submitted object"
      );
      testAssert(submitted.el_code === "ABC", "Non-sensitive field passed through directly");
      testAssert(card.parentElement === null || env.chatLog.children.indexOf(card) === -1, "Form card removed upon valid submission");
    }
  }

  console.log(`\nWS7 Slots and Forms Tests Complete: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Unhandled error during WS7 tests:", err);
  process.exit(1);
});

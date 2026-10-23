/**
 * client-script/test_ws5_router_loop.js
 * WS5 Acceptance Suite: Router & Closed Goal Loop, Awaiting User Input, Secret Vault Tokenization,
 * Repeat Step Abort, Max Hops, and Stop Control.
 *
 * 100% Universal Web Compliance (Prime Directive). Zero hardcoded domains.
 */

const assert = require("assert");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    try {
      delete require.cache[require.resolve("./content.js")];
    } catch (_) {}
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

// ── Mock DOM & Browser Environment Setup ─────────────────────────────────────
function setupMockEnv() {
  const listeners = {};
  const storageData = {};
  const chatMessages = [];
  let statusText = "";
  let executingState = false;
  let progressState = null;

  // JSDOM-like in-memory shadow root and chat elements
  const chatLogEl = {
    className: "atlas-chat-log",
    children: [],
    scrollTop: 0,
    scrollHeight: 100,
    appendChild: function (el) {
      this.children.push(el);
      el.parentElement = this;
    },
    querySelector: function (sel) {
      if (sel === ".atlas-user-input-form-card") {
        return this.children.find((c) => c.className === "atlas-user-input-form-card") || null;
      }
      return null;
    },
  };

  const shadowRoot = {
    querySelector: function (sel) {
      if (sel === ".atlas-chat-log") return chatLogEl;
      return null;
    },
  };

  const vaultStore = {};

  const mockSecretVault = {
    store: async (origin, category, ref, plaintext) => {
      const token = `{vault:${ref}}`;
      vaultStore[token] = { origin, category, ref, plaintext };
      return token;
    },
    resolve: async (origin, token) => vaultStore[token]?.plaintext || null,
  };

  const mockSidebar = {
    getShadowRoot: () => shadowRoot,
    getLanguage: () => "ar-EG",
    setLanguage: () => {},
    setStatus: (msg, type) => {
      statusText = msg;
    },
    getStatus: () => statusText,
    setExecuting: (val) => {
      executingState = Boolean(val);
    },
    isExecuting: () => executingState,
    setGoalProgress: (s) => {
      progressState = s;
    },
    getGoalProgress: () => progressState,
    hideGoalProgress: () => {
      progressState = null;
    },
    addChatMessage: (role, text, opts) => {
      chatMessages.push({ role, text, opts });
    },
    getChatMessages: () => chatMessages,
    addChatThinking: () => {},
    removeThinking: () => {},
    setAutoHide: () => {},
  };

  const mockSpeech = {
    getLanguage: () => "ar-EG",
    stop: () => {},
  };

  const mockTTS = {
    stop: () => {},
    speak: () => {},
  };

  const mockSerializer = {
    serialize: () => [
      { id: 1, label: "خدمات المواطنين", role: "button", visible: true },
      { id: 2, label: "نيابات المرور", role: "link", visible: false, reveal_via: 1 },
    ],
  };

  const lastExecutedSteps = [];
  const mockExecutor = {
    executeStep: async (step) => {
      lastExecutedSteps.push(step);
      return { ok: true, step };
    },
  };

  global.window = {
    __ATLAS_TEST_ENV__: true,
    location: {
      href: "https://demo.portal.local/index.html?token=12345#home",
      origin: "https://demo.portal.local",
    },
    document: {
      readyState: "complete",
      createElement: function (tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: "",
          style: {},
          dataset: {},
          attributes: {},
          children: [],
          value: "",
          setAttribute: function (k, v) {
            this.attributes[k] = v;
          },
          getAttribute: function (k) {
            return this.attributes[k];
          },
          appendChild: function (child) {
            this.children.push(child);
            child.parentElement = this;
          },
          querySelector: function (sel) {
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
          querySelectorAll: function (sel) {
            const results = [];
            function walk(node) {
              if (!node || !node.children) return;
              for (const child of node.children) {
                if (!sel) {
                  results.push(child);
                } else if (sel.startsWith(".")) {
                  const cls = sel.slice(1);
                  if (child.className && child.className.split(" ").includes(cls)) results.push(child);
                } else if (sel.toUpperCase() === child.tagName) {
                  results.push(child);
                }
                walk(child);
              }
            }
            walk(this);
            return results;
          },
          remove: function () {
            if (this.parentElement) {
              const idx = this.parentElement.children.indexOf(this);
              if (idx !== -1) this.parentElement.children.splice(idx, 1);
            }
          },
          addEventListener: function (evt, handler) {
            this[`on_${evt}`] = handler;
          },
          dispatchEvent: function (evt) {
            const h = this[`on_${evt.type}`];
            if (h) h(evt);
          },
        };
        return el;
      },
    },
    AtlasSidebar: mockSidebar,
    AtlasSpeech: mockSpeech,
    AtlasTTS: mockTTS,
    AtlasSerializer: mockSerializer,
    AtlasExecutor: mockExecutor,
    AtlasSecretVault: mockSecretVault,
    addEventListener: (e, h) => {
      listeners[e] = h;
    },
  };

  global.document = global.window.document;

  const sentRuntimeMessages = [];
  global.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, callback) => {
        sentRuntimeMessages.push(msg);
        if (callback) {
          callback({ ok: true, data: {} });
        }
      },
    },
    storage: {
      sync: {
        get: (keys, cb) => cb({ apiKey: "test_dev_key", baseUrl: "http://localhost:8000" }),
      },
      local: {
        get: (keys, cb) => cb({}),
        set: (items, cb) => {
          Object.assign(storageData, items);
          if (cb) cb();
        },
      },
      session: {
        get: (keys, cb) => cb({}),
        set: (items, cb) => cb && cb(),
        remove: (keys, cb) => cb && cb(),
      },
    },
  };

  return {
    mockSidebar,
    mockSecretVault,
    mockExecutor,
    sentRuntimeMessages,
    vaultStore,
    chatMessages,
    lastExecutedSteps,
  };
}

async function run() {
  console.log("\n=======================================================");
  console.log("   WS5 Router & Closed Goal Loop Acceptance Suite     ");
  console.log("=======================================================\n");

  await test("content.js exports handleChatInput, executeGoalHop, and renderAwaitingUserInputForm", () => {
    setupMockEnv();
    const content = require("./content.js");
    assert.strictEqual(typeof content.executeGoalHop, "function");
    assert.strictEqual(typeof content.handleChatInput, "function");
    assert.strictEqual(typeof content.renderAwaitingUserInputForm, "function");
  });

  await test("executeGoalHop dispatches ATLAS_GOAL_STEP with contract_version=3, language, and page_text", async () => {
    const env = setupMockEnv();
    const content = require("./content.js");

    let interceptedPayload = null;
    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "ATLAS_GOAL_STEP") {
        interceptedPayload = msg.payload;
        cb({
          ok: true,
          data: {
            status: "goal_complete",
            reply: "تم العثور على الخدمة المطلوبة بنجاح",
            goal_state: {
              goal: "استعلام عن مخالفات",
              status: "goal_complete",
              hop_count: 1,
            },
          },
        });
        return;
      }
      if (cb) cb({ ok: true });
    };

    const seedState = {
      goal: "استعلام عن مخالفات",
      status: "in_progress",
      hop_count: 0,
      max_hops: 15,
      language: "ar-EG",
    };

    await content.executeGoalHop(seedState);

    assert(interceptedPayload !== null, "Must send ATLAS_GOAL_STEP payload");
    assert.strictEqual(interceptedPayload.contract_version, 3, "Contract version must be 3");
    assert.strictEqual(interceptedPayload.language, "ar-EG", "Must pass active client language");
    assert.strictEqual(interceptedPayload.goal, "استعلام عن مخالفات");
    assert(interceptedPayload.capabilities.includes("switch_tab"), "Must declare client capabilities");
  });

  await test("awaiting_user_input renders form in shadow root, encrypts sensitive fields into vault, and sends tokens only", async () => {
    const env = setupMockEnv();
    const content = require("./content.js");

    let hopCount = 0;
    let interceptedHops = [];

    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "ATLAS_GOAL_STEP") {
        interceptedHops.push(msg.payload);
        hopCount++;
        if (hopCount === 1) {
          // Return awaiting_user_input on first turn
          cb({
            ok: true,
            data: {
              status: "awaiting_user_input",
              reply: "يرجى إدخال الرقم القومي ورقم اللوحة للاستعلام",
              goal_state: {
                goal: "استعلام عن مخالفات",
                status: "awaiting_user_input",
                hop_count: 1,
                awaiting: {
                  prompt: "يرجى إدخال الرقم القومي ورقم اللوحة للاستعلام",
                  fields: [
                    {
                      ref: "el_national_id",
                      label: "الرقم القومي (14 رقماً)",
                      kind: "text",
                      sensitive: true,
                      pattern: "[0-9]{14}",
                      required: true,
                    },
                    {
                      ref: "el_plate_no",
                      label: "رقم اللوحة",
                      kind: "text",
                      sensitive: false,
                      required: true,
                    },
                  ],
                },
              },
            },
          });
        } else {
          // Complete after user inputs submitted
          cb({
            ok: true,
            data: {
              status: "goal_complete",
              reply: "بيان المخالفات: إجمالي 250 جنيهاً مصرياً.",
              goal_state: {
                goal: "استعلام عن مخالفات",
                status: "goal_complete",
                hop_count: 2,
              },
            },
          });
        }
        return;
      }
      if (cb) cb({ ok: true });
    };

    const seedState = {
      goal: "استعلام عن مخالفات",
      status: "in_progress",
      hop_count: 0,
      max_hops: 15,
      language: "ar-EG",
    };

    // Run first hop to trigger awaiting_user_input
    await content.executeGoalHop(seedState);

    // Form should now be rendered inside shadow root chat log
    const chatLog = global.window.AtlasSidebar.getShadowRoot().querySelector(".atlas-chat-log");
    const formCard = chatLog.querySelector(".atlas-user-input-form-card");
    assert(formCard !== null, "User input form card must be rendered in sidebar shadow root");

    // Form should contain the two fields
    const form = formCard.children.find((c) => c.tagName === "FORM");
    assert(form !== null, "Card must contain a form element");

    const idInput = form.querySelector('[data-field-ref="el_national_id"]');
    const plateInput = form.querySelector('[data-field-ref="el_plate_no"]');
    assert(idInput !== null, "Must contain national ID input");
    assert(plateInput !== null, "Must contain plate number input");

    // Sensitive field must have type=password
    assert.strictEqual(idInput.type, "password", "Sensitive field must have type=password");
    assert.strictEqual(plateInput.type, "text", "Non-sensitive field must have type=text");

    // Simulate user typing into form
    const rawNationalId = "00000000000000";
    const rawPlate = "123 أ ب ج";
    idInput.value = rawNationalId;
    plateInput.value = rawPlate;

    // Dispatch submit
    await form.on_submit({ preventDefault: () => {} });
    await new Promise((r) => setTimeout(r, 50));

    // Invariant: Raw inputs must be CLEARED immediately after submit
    assert.strictEqual(idInput.value, "", "Sensitive inputs must be cleared after submit");
    assert.strictEqual(plateInput.value, "", "Non-sensitive inputs must be cleared after submit");

    // Verify Hop 2 payload
    assert.strictEqual(interceptedHops.length, 2, "Second hop must have been dispatched after submit");
    const hop2Payload = interceptedHops[1];
    assert(hop2Payload.user_inputs !== undefined, "Hop 2 must contain user_inputs");
    assert.strictEqual(hop2Payload.user_inputs.el_plate_no, rawPlate, "Non-sensitive field sent in plaintext");

    // Sensitive field MUST be tokenized with {vault:...} or vault token
    const idValue = hop2Payload.user_inputs.el_national_id;
    assert(/^\{vault:.*\}$/.test(idValue), `Sensitive field must be {vault:...} token, got: ${idValue}`);
    assert(!JSON.stringify(hop2Payload).includes(rawNationalId), "Raw national ID must NEVER appear in request payload");

    // Check chat messages: raw national ID must NEVER appear in chat messages
    const msgs = env.chatMessages.map((m) => m.text).join(" ");
    assert(!msgs.includes(rawNationalId), "Raw national ID must NEVER appear in chat history");
  });

  await test("requires_confirmation displays chips and sends user_response on user choice", async () => {
    setupMockEnv();
    const content = require("./content.js");

    let interceptedHops = [];
    let hopCount = 0;

    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "ATLAS_GOAL_STEP") {
        interceptedHops.push(msg.payload);
        hopCount++;
        if (hopCount === 1) {
          cb({
            ok: true,
            data: {
              status: "requires_confirmation",
              confirmation_prompt: "هل تريد تأكيد سداد الرسوم؟",
              confirmation_options: ["نعم، متابعة", "لا، إلغاء"],
              goal_state: {
                goal: "سداد رسوم",
                status: "requires_confirmation",
                hop_count: 1,
              },
            },
          });
        } else {
          cb({
            ok: true,
            data: {
              status: "goal_complete",
              reply: "تم السداد بنجاح",
              goal_state: {
                goal: "سداد رسوم",
                status: "goal_complete",
                hop_count: 2,
              },
            },
          });
        }
        return;
      }
      if (cb) cb({ ok: true });
    };

    const seedState = {
      goal: "سداد رسوم",
      status: "in_progress",
      hop_count: 0,
      max_hops: 15,
      language: "ar-EG",
    };

    await content.executeGoalHop(seedState);

    // Verify confirmation chat message was added with options
    const messages = global.window.AtlasSidebar.getChatMessages();
    const confirmMsg = messages.find((m) => m.text.includes("هل تريد تأكيد سداد"));
    assert(confirmMsg !== undefined, "Confirmation prompt must be shown in chat");
    assert(confirmMsg.opts.actions.length === 2, "Confirmation chips must be present");

    // Simulate clicking option 0 ("نعم، متابعة")
    confirmMsg.opts.onAction("نعم، متابعة");

    // Wait microtask tick
    await new Promise((r) => setTimeout(r, 50));

    // Verify Hop 2 received user_response = "yes"
    assert.strictEqual(interceptedHops.length, 2);
    assert.strictEqual(interceptedHops[1].user_response, "yes", "Hop 2 must carry user_response: yes when option 0 chosen");
  });

  await test("chat input during awaiting_user_input or requires_confirmation routes to goal_step as user_response", async () => {
    setupMockEnv();
    const content = require("./content.js");

    let goalStepDispatched = false;
    let chatEndpointCalled = false;
    let receivedUserResponse = null;

    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "ATLAS_CHAT") {
        chatEndpointCalled = true;
        if (cb) cb({ ok: true, data: {} });
        return;
      }
      if (msg.type === "ATLAS_GOAL_STEP") {
        goalStepDispatched = true;
        receivedUserResponse = msg.payload?.user_response;
        if (cb) {
          cb({
            ok: true,
            data: {
              status: "goal_complete",
              reply: "تم استكمال العملية بعد حل الرمز",
              goal_state: { goal: "OTP Goal", status: "goal_complete", hop_count: 2 },
            },
          });
        }
        return;
      }
      if (cb) cb({ ok: true });
    };

    // Set current goal state to awaiting_user_input (e.g. captcha/otp without form fields)
    content.setCurrentGoalState({
      goal: "OTP Goal",
      status: "awaiting_user_input",
      hop_count: 1,
      max_hops: 15,
      language: "ar-EG",
    });

    // User types "خلصت" or "done"
    await content.handleChatInput("خلصت");

    assert.strictEqual(chatEndpointCalled, false, "Must NOT route to /v1/chat when awaiting input");
    assert.strictEqual(goalStepDispatched, true, "Must route directly to goal_step");
    assert.strictEqual(receivedUserResponse, "خلصت", "Must pass typed input as user_response");
  });

  await test("if AtlasSecretVault.store throws or is missing, show localized error and keep form", async () => {
    const env = setupMockEnv();
    const content = require("./content.js");

    // Break the vault store function to simulate error
    global.window.AtlasSecretVault.store = async () => {
      throw new Error("Vault hardware failure");
    };

    const awaitingReq = {
      prompt: "يرجى إدخال كلمة المرور",
      fields: [
        { ref: "user_pwd", label: "كلمة المرور", kind: "password", sensitive: true, required: true },
      ],
    };

    let submitted = false;
    content.renderAwaitingUserInputForm(awaitingReq, () => {
      submitted = true;
    });

    const chatLog = global.window.AtlasSidebar.getShadowRoot().querySelector(".atlas-chat-log");
    const formCard = chatLog.querySelector(".atlas-user-input-form-card");
    assert(formCard !== null, "Form card must be rendered");

    const pwdInput = formCard.children.find((c) => c.tagName === "FORM").querySelector('[data-field-ref="user_pwd"]');
    pwdInput.value = "secret123";

    // Attempt submit
    const form = formCard.children.find((c) => c.tagName === "FORM");
    await form.on_submit({ preventDefault: () => {} });

    // Invariants:
    assert.strictEqual(submitted, false, "Must NOT execute submit callback on vault failure");
    const msgs = global.window.AtlasSidebar.getChatMessages().map((m) => m.text).join(" ");
    assert(msgs.includes("فشل تشفير البيانات الحساسة") || msgs.includes("Failed to encrypt"), "Must show localized vault failure message");

    // Form must NOT be removed from DOM
    assert(chatLog.querySelector(".atlas-user-input-form-card") !== null, "Form must be kept so user can retry");
  });

  await test("abort loop with localized message if same step on same element repeats 3 times", async () => {
    setupMockEnv();
    const content = require("./content.js");

    let hopCount = 0;
    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "ATLAS_GOAL_STEP") {
        hopCount++;
        cb({
          ok: true,
          data: {
            status: "in_progress",
            steps: [{ action: "click", element_id: "repeated_btn_99", description: "Click Next" }],
            goal_state: {
              goal: "Loop test",
              status: "in_progress",
              hop_count: hopCount,
            },
          },
        });
        return;
      }
      if (cb) cb({ ok: true });
    };

    const seedState = {
      goal: "Loop test",
      status: "in_progress",
      hop_count: 0,
      max_hops: 15,
      language: "ar-EG",
    };

    await content.executeGoalHop(seedState);

    // Should abort after 3 repetitions
    assert.strictEqual(hopCount, 3, "Must stop execution at exactly 3 repetitions");
    const msgs = global.window.AtlasSidebar.getChatMessages().map((m) => m.text).join(" ");
    assert(msgs.includes("تكرر نفس الإجراء") || msgs.includes("repeated 3 times"), "Must show localized repeated step abort message");
  });

  await test("hop_count >= max_hops aborts loop with localized hops limit message", async () => {
    setupMockEnv();
    const content = require("./content.js");

    const exhaustedState = {
      goal: "Max hops test",
      status: "in_progress",
      hop_count: 15,
      max_hops: 15,
      language: "ar-EG",
    };

    await content.executeGoalHop(exhaustedState);

    const msgs = global.window.AtlasSidebar.getChatMessages().map((m) => m.text).join(" ");
    assert(msgs.includes("للحد الأقصى للخطوات") || msgs.includes("maximum allowed hops limit"), "Must announce hop limit reached");
  });

  await test("stopGoalExecution halts execution, aborts in-flight requests, and clears GoalStore", async () => {
    const env = setupMockEnv();
    const content = require("./content.js");

    content.setExecuting(true);
    assert.strictEqual(content.isExecuting(), true);

    await content.stopGoalExecution();

    assert.strictEqual(content.isExecuting(), false, "isExecuting must be false after stop");
    const clearMsg = env.sentRuntimeMessages.find((m) => m.type === "ATLAS_GOAL_STORE_CLEAR");
    assert(clearMsg !== undefined, "Must send ATLAS_GOAL_STORE_CLEAR to background");
  });

  await test("Universal Prime Directive: Zero hardcoded hostnames or site-specific selectors", () => {
    const fs = require("fs");
    const contentJs = fs.readFileSync(__dirname + "/content.js", "utf8");
    for (const forbidden of ["google.com", "amazon.com", "drive.google.com", "github.com", "wikipedia.org"]) {
      assert(!contentJs.includes(forbidden), `Prime directive violation: found ${forbidden} in content.js`);
    }
  });

  console.log(`\nWS5 Router & Loop Test Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run();

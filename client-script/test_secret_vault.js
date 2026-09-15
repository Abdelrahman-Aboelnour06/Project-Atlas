/**
 * Unit Test Suite for Client-Side Secret Vault & Tokenization (Contract 11)
 * Run with: node client-script/test_secret_vault.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failures = 0;

function testAssert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ── Mock chrome.storage.local ────────────────────────────────────────────────
const mockStore = {};
const mockChromeStorage = {
  get: (keys, cb) => {
    const res = {};
    if (!keys) {
      Object.assign(res, mockStore);
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (k in mockStore) res[k] = mockStore[k];
      }
    } else if (typeof keys === 'string') {
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
    for (const k of arr) {
      delete mockStore[k];
    }
    if (cb) cb();
    return Promise.resolve();
  },
};

global.chrome = {
  storage: {
    local: mockChromeStorage,
  },
};

// Provide a window shim for client scripts
global.window = global;
global.location = { origin: 'https://demo-bank.example.com' };

// Load modules
const serializer = require('./dom-serializer.js');
const secretVault = require('./secret-vault.js');

async function runTests() {
  console.log('\n--- Running Secret Vault & Tokenization Unit Tests ---');

  // 1. classifySensitiveField unit tests
  console.log('\n[Unit: classifySensitiveField Categorization]');
  {
    // Test 1: Password field
    const passField = {
      getAttribute: (attr) => (attr === 'type' ? 'password' : null),
      id: 'pwd-input',
    };
    testAssert(
      serializer.classifySensitiveField(passField) === 'password',
      'classifySensitiveField identifies password field as "password"'
    );

    // Test 2: cc-number
    const ccField = {
      getAttribute: (attr) => (attr === 'autocomplete' ? 'cc-number' : 'text'),
      name: 'cardNumber',
    };
    testAssert(
      serializer.classifySensitiveField(ccField) === 'cc_number',
      'classifySensitiveField identifies autocomplete="cc-number" as "cc_number"'
    );

    // Test 3: name="cvv"
    const cvvField = {
      getAttribute: (attr) => (attr === 'type' ? 'text' : null),
      name: 'cvv',
    };
    testAssert(
      serializer.classifySensitiveField(cvvField) === 'cc_cvv',
      'classifySensitiveField identifies name="cvv" as "cc_cvv"'
    );

    // Test 4: autocomplete="one-time-code"
    const otpField = {
      getAttribute: (attr) => (attr === 'autocomplete' ? 'one-time-code' : null),
    };
    testAssert(
      serializer.classifySensitiveField(otpField) === 'otp',
      'classifySensitiveField identifies autocomplete="one-time-code" as "otp"'
    );

    // Test 5: Ordinary text field -> null
    const regularField = {
      getAttribute: (attr) => (attr === 'type' ? 'text' : null),
      name: 'search_query',
      id: 'search-box',
    };
    testAssert(
      serializer.classifySensitiveField(regularField) === null,
      'classifySensitiveField returns null for ordinary non-sensitive field'
    );

    // Test 6: email field -> null (PII for serializer, not a secret token)
    const emailField = {
      getAttribute: (attr) => (attr === 'type' ? 'email' : null),
      name: 'user_email',
    };
    testAssert(
      serializer.classifySensitiveField(emailField) === null,
      'classifySensitiveField returns null for email field'
    );

    // Test 7: pin field -> "pin"
    const pinField = {
      getAttribute: (attr) => (attr === 'type' ? 'text' : null),
      name: 'user_pin',
    };
    testAssert(
      serializer.classifySensitiveField(pinField) === 'pin',
      'classifySensitiveField identifies name="user_pin" as "pin"'
    );
  }

  // 2. secret-vault.js cryptographic & storage operations
  console.log('\n[Unit: Secret Vault Store, Resolve, and Persistence]');
  {
    const origin = 'https://portal.bank.com';
    const testSecret = 'hunter2_super_secret_password_123';

    // Store -> Resolve round trip
    const token1 = await secretVault.store(origin, 'password', 'atlas-101', testSecret);
    testAssert(token1 === '{password}', `First password store produces token "{password}" (got "${token1}")`);

    const resolved = await secretVault.resolve(origin, token1);
    testAssert(resolved === testSecret, 'Round-trip resolve recovers original plaintext secret');

    // Two stores of same category produce {category} then {category_2}
    const token2 = await secretVault.store(origin, 'password', 'atlas-102', 'another_pass_456');
    testAssert(token2 === '{password_2}', `Second password store on same origin produces "{password_2}" (got "${token2}")`);

    const resolved2 = await secretVault.resolve(origin, token2);
    testAssert(resolved2 === 'another_pass_456', 'Second token resolves correctly');

    // Verify stored blob in storage NEVER contains plaintext
    const storageDump = JSON.stringify(mockStore);
    testAssert(
      !storageDump.includes(testSecret) && !storageDump.includes('another_pass_456'),
      'Storage never contains plaintext or substring of plaintext'
    );

    // Test persistence across simulated extension restart:
    // Clear in-memory cached key, re-call getOrCreateVaultKey() to re-import existing key
    secretVault._resetKeyCache();
    const keyAfterRestart = await secretVault.getOrCreateVaultKey();
    testAssert(Boolean(keyAfterRestart), 'Vault key successfully re-imported after simulated extension restart');

    const resolvedAfterRestart = await secretVault.resolve(origin, token1);
    testAssert(
      resolvedAfterRestart === testSecret,
      'Stored secret remains decryptable after simulated extension restart (key persistence verified)'
    );

    // listEntries metadata check (never includes plaintext)
    const entries = await secretVault.listEntries(origin);
    testAssert(entries.length >= 2, 'listEntries returns all saved tokens for origin');
    testAssert(
      entries.every((e) => e.token && e.category && !e.ciphertext && !e.plaintext && !('value' in e)),
      'listEntries returns metadata only and never includes plaintext or ciphertext'
    );

    // Test deleteEntry
    await secretVault.deleteEntry(origin, token1);
    const resolvedAfterDelete = await secretVault.resolve(origin, token1);
    testAssert(resolvedAfterDelete === null, 'resolve returns null after deleteEntry');

    // Test clearOrigin
    await secretVault.clearOrigin(origin);
    const resolvedAfterClear = await secretVault.resolve(origin, token2);
    testAssert(resolvedAfterClear === null, 'resolve returns null after clearOrigin');
    const remainingForOrigin = await secretVault.listEntries(origin);
    testAssert(remainingForOrigin.length === 0, 'Origin entries list is empty after clearOrigin');
  }

  // 3. tokenizeCommand unit tests
  console.log('\n[Unit: Client-Side tokenizeCommand Invariant]');
  {
    const origin = 'https://login.example.com';
    const sampleCommand = 'fill my password with hunter2';
    const domMap = [{ id: 'atlas-p1', tag: 'input', type: 'password', name: 'password' }];

    const result = await secretVault.tokenizeCommand(origin, sampleCommand, domMap);
    testAssert(result.command.includes('{password}'), 'tokenized command contains "{password}"');
    testAssert(!result.command.includes('hunter2'), 'tokenized command NEVER contains "hunter2"');
    testAssert(result.extracted.length === 1, 'Extracted array records 1 secret token');
    testAssert(result.extracted[0].token === '{password}', 'Extracted item has token {password}');

    // Test resolve of the token produced by tokenizeCommand
    const resolvedFromVault = await secretVault.resolve(origin, result.extracted[0].token);
    testAssert(resolvedFromVault === 'hunter2', 'Token stored by tokenizeCommand resolves to real secret locally');

    // Test 3b: Non-sensitive command is NOT tokenized
    const nonSensResult = await secretVault.tokenizeCommand(origin, 'fill search with shoes');
    testAssert(nonSensResult.command === 'fill search with shoes', 'Non-sensitive command remains untouched');
    testAssert(nonSensResult.extracted.length === 0, 'No secrets extracted for non-sensitive command');

    // Test 3c: Compound command tokenizes ONLY the sensitive field
    const compoundResult = await secretVault.tokenizeCommand(
      origin,
      'fill username with alice and password with hunter2',
      domMap
    );
    testAssert(compoundResult.command.includes('alice'), 'Username "alice" preserved in compound command');
    testAssert(compoundResult.command.includes('{password}'), 'Password replaced with token in compound command');
    testAssert(!compoundResult.command.includes('hunter2'), 'Password "hunter2" removed from compound command');
    testAssert(compoundResult.extracted.length === 1, 'Only 1 secret extracted from compound command');

    // Test 3d: Multiple fields of same category generate distinct tokens ({password}, {password_2})
    await secretVault.clearOrigin('https://registration.example.com');
    const multiDomMap = [
      { id: 'atlas-reg-p1', tag: 'input', type: 'password', name: 'password' },
      { id: 'atlas-reg-p2', tag: 'input', type: 'password', name: 'confirm_password' },
    ];
    const doubleResult = await secretVault.tokenizeCommand(
      'https://registration.example.com',
      'fill password with hunter2 and confirm password with hunter2',
      multiDomMap
    );
    testAssert(doubleResult.command.includes('{password}'), 'First password has {password}');
    testAssert(doubleResult.command.includes('{password_2}'), 'Second password has {password_2}');
    testAssert(doubleResult.extracted.length === 2, 'Two distinct tokens extracted for password and confirm password');

    // Test 3e: Pattern 2 compound command ("type X into Y")
    const pattern2Result = await secretVault.tokenizeCommand(
      origin,
      'type alice into username and hunter2 into password',
      domMap
    );
    testAssert(pattern2Result.command.includes('alice'), 'Pattern 2 preserves "alice"');
    testAssert(pattern2Result.command.includes('{password}'), 'Pattern 2 tokenizes password');
    testAssert(!pattern2Result.command.includes('hunter2'), 'Pattern 2 removes "hunter2"');
  }

  // 4. Options UI saved secrets management
  console.log('\n[Unit: Options Page Saved Secrets UI Security]');
  {
    // Clear storage and seed a couple of entries
    await secretVault.clearAll();
    await secretVault.store('https://alpha.org', 'password', 'a1', 'secret_alpha');
    await secretVault.store('https://beta.org', 'cc_number', 'b1', '4532015112830366');

    // Verify spy on resolve: rendering must NEVER call resolve
    let resolveCalls = 0;
    const originalResolve = secretVault.resolve;
    secretVault.resolve = async (...args) => {
      resolveCalls++;
      return originalResolve.apply(secretVault, args);
    };

    // Mock minimal DOM for options.js
    const createdElements = [];
    const container = {
      textContent: '',
      children: [],
      appendChild: (el) => {
        container.children.push(el);
      },
    };

    // Create a mock document with element factory
    global.document = {
      getElementById: (id) => {
        if (id === 'secrets-container') return container;
        if (id === 'clear-all-secrets-btn') return { style: {}, addEventListener: () => {} };
        if (id === 'secrets-status') return { textContent: '', dataset: {} };
        if (id === 'atlas-options-form') return { addEventListener: () => {} };
        if (id === 'api-key') return { value: '', type: 'password' };
        if (id === 'base-url') return { value: '' };
        if (id === 'toggle-visibility') return { textContent: '', setAttribute: () => {}, addEventListener: () => {} };
        if (id === 'clear-btn') return { addEventListener: () => {} };
        if (id === 'atlas-status') return { textContent: '', dataset: {} };
        return null;
      },
      createElement: (tag) => {
        const el = {
          tag,
          className: '',
          textContent: '',
          children: [],
          attrs: {},
          style: {},
          listeners: {},
          appendChild: (c) => el.children.push(c),
          setAttribute: (k, v) => { el.attrs[k] = v; },
          addEventListener: (event, handler) => { el.listeners[event] = handler; },
        };
        createdElements.push(el);
        return el;
      },
    };

    global.confirm = () => true;

    // Load options.js
    delete require.cache[require.resolve('./options.js')];
    const optionsModule = require('./options.js');

    await optionsModule.renderSecrets();

    testAssert(
      resolveCalls === 0,
      'options.js renderSecrets() NEVER calls secretVault.resolve() (decryption prevented)'
    );

    testAssert(
      container.children.length === 2,
      'options.js renders groups for each origin in listEntries'
    );

    // Restore resolve
    secretVault.resolve = originalResolve;
  }

  console.log(`\nSecret Vault Tests Complete: ${passed} passed, ${failures} failed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Unhandled error during tests:', err);
  process.exit(1);
});

// client-script/test_goal_store.js
// Acceptance test suite for Track 1g & Track L1-lite: background.js GoalStore, DNR & Manifest

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log('\n--- Running Track 1g & L1-lite GoalStore / DNR Tests ---\n');

  const manifestPath = path.join(__dirname, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  await test('manifest.json permissions include webNavigation, downloads, tabs', () => {
    assert(manifest.permissions.includes('webNavigation'), 'Must include webNavigation permission');
    assert(manifest.permissions.includes('downloads'), 'Must include downloads permission');
    assert(manifest.permissions.includes('tabs'), 'Must include tabs permission');
    assert(manifest.version !== '0.1.0', `Version must be bumped, got ${manifest.version}`);
  });

  await test('manifest.json permissions include declarativeNetRequest', () => {
    assert(manifest.permissions.includes('declarativeNetRequest'), 'Must include declarativeNetRequest permission');
  });

  const bgSrc = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

  await test('background.js defines GoalStore with get, put, clear, setExecuting', () => {
    assert(/const GoalStore\s*=\s*\{/.test(bgSrc) || /GoalStore\s*=\s*\{/.test(bgSrc), 'Must define GoalStore object');
    assert(/async\s+get\s*\(/.test(bgSrc) || /get:\s*async/.test(bgSrc), 'GoalStore must define get');
    assert(/async\s+put\s*\(/.test(bgSrc) || /put:\s*async/.test(bgSrc), 'GoalStore must define put');
    assert(/async\s+clear\s*\(/.test(bgSrc) || /clear:\s*async/.test(bgSrc), 'GoalStore must define clear');
    assert(/async\s+setExecuting\s*\(/.test(bgSrc) || /setExecuting:\s*async/.test(bgSrc), 'GoalStore must define setExecuting');
  });

  await test('background.js wires webNavigation.onCompleted and downloads.onChanged', () => {
    assert(/chrome\.webNavigation\.onCompleted\.addListener/.test(bgSrc), 'Must attach webNavigation.onCompleted listener');
    assert(/chrome\.downloads\.onChanged\.addListener/.test(bgSrc), 'Must attach downloads.onChanged listener');
  });

  await test('background.js exports applyDnrLanguageRule and clearDnrLanguageRule', () => {
    const bg = require('./background.js');
    assert(typeof bg.applyDnrLanguageRule === 'function', 'applyDnrLanguageRule must be exported function');
    assert(typeof bg.clearDnrLanguageRule === 'function', 'clearDnrLanguageRule must be exported function');
  });

  await test('applyDnrLanguageRule and clearDnrLanguageRule update session rules correctly', async () => {
    const bg = require('./background.js');
    let updatedCalls = [];

    global.chrome = {
      declarativeNetRequest: {
        updateSessionRules: async (opts) => {
          updatedCalls.push(opts);
        },
      },
    };

    await bg.applyDnrLanguageRule(42, 'ar-EG');
    assert.strictEqual(updatedCalls.length, 1);
    const call1 = updatedCalls[0];
    assert.deepStrictEqual(call1.removeRuleIds, [42]);
    assert.strictEqual(call1.addRules.length, 1);
    const rule = call1.addRules[0];
    assert.strictEqual(rule.id, 42);
    assert.strictEqual(rule.priority, 1);
    assert.strictEqual(rule.action.type, 'modifyHeaders');
    assert.deepStrictEqual(rule.condition.tabIds, [42]);
    const header = rule.action.requestHeaders[0];
    assert.strictEqual(header.header, 'Accept-Language');
    assert.strictEqual(header.value, 'ar-EG;q=0.9, en;q=0.5');

    await bg.clearDnrLanguageRule(42);
    assert.strictEqual(updatedCalls.length, 2);
    const call2 = updatedCalls[1];
    assert.deepStrictEqual(call2.removeRuleIds, [42]);

    delete global.chrome;
  });

  await test('GoalStore.put applies DNR rule when goalState has language and clear removes it', async () => {
    const bg = require('./background.js');
    let dnrCalls = [];
    const sessionData = {};

    global.chrome = {
      declarativeNetRequest: {
        updateSessionRules: async (opts) => {
          dnrCalls.push(opts);
        },
      },
      storage: {
        session: {
          get: async (key) => ({ [key]: sessionData[key] }),
          set: async (obj) => Object.assign(sessionData, obj),
          remove: async (key) => delete sessionData[key],
        },
      },
    };

    const state = await bg.GoalStore.put(99, { goal: 'test goal', language: 'ar-EG' });
    assert.strictEqual(state.language, 'ar-EG');
    assert.strictEqual(dnrCalls.length, 1);
    assert.strictEqual(dnrCalls[0].addRules[0].id, 99);
    assert.strictEqual(dnrCalls[0].addRules[0].action.requestHeaders[0].value, 'ar-EG;q=0.9, en;q=0.5');

    await bg.GoalStore.clear(99);
    assert.strictEqual(dnrCalls.length, 2);
    assert.deepStrictEqual(dnrCalls[1].removeRuleIds, [99]);

    delete global.chrome;
  });

  await test('background.js attaches tabs.onRemoved listener for session cleanup', () => {
    assert(/chrome\.tabs\.onRemoved\.addListener/.test(bgSrc), 'Must attach tabs.onRemoved listener');
  });

  await test('applyDnrLanguageRule and clearDnrLanguageRule handle non-chrome environment safely', async () => {
    const bg = require('./background.js');
    await bg.applyDnrLanguageRule(123, 'ar-EG');
    await bg.clearDnrLanguageRule(123);
  });

  console.log(`\nTrack 1g & L1-lite Test Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run();

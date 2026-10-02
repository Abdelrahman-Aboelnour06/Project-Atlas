// client-script/test_goal_store.js
// Acceptance test suite for Track 1g: background.js GoalStore & Manifest

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('\n--- Running Track 1g GoalStore Tests ---\n');

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('manifest.json permissions include webNavigation, downloads, tabs', () => {
  assert(manifest.permissions.includes('webNavigation'), 'Must include webNavigation permission');
  assert(manifest.permissions.includes('downloads'), 'Must include downloads permission');
  assert(manifest.permissions.includes('tabs'), 'Must include tabs permission');
  assert(manifest.version !== '0.1.0', `Version must be bumped, got ${manifest.version}`);
});

const bgSrc = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

test('background.js defines GoalStore with get, put, clear, setExecuting', () => {
  assert(/const GoalStore\s*=\s*\{/.test(bgSrc) || /GoalStore\s*=\s*\{/.test(bgSrc), 'Must define GoalStore object');
  assert(/async\s+get\s*\(/.test(bgSrc) || /get:\s*async/.test(bgSrc), 'GoalStore must define get');
  assert(/async\s+put\s*\(/.test(bgSrc) || /put:\s*async/.test(bgSrc), 'GoalStore must define put');
  assert(/async\s+clear\s*\(/.test(bgSrc) || /clear:\s*async/.test(bgSrc), 'GoalStore must define clear');
  assert(/async\s+setExecuting\s*\(/.test(bgSrc) || /setExecuting:\s*async/.test(bgSrc), 'GoalStore must define setExecuting');
});

test('background.js wires webNavigation.onCompleted and downloads.onChanged', () => {
  assert(/chrome\.webNavigation\.onCompleted\.addListener/.test(bgSrc), 'Must attach webNavigation.onCompleted listener');
  assert(/chrome\.downloads\.onChanged\.addListener/.test(bgSrc), 'Must attach downloads.onChanged listener');
});

console.log(`\nTrack 1g Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

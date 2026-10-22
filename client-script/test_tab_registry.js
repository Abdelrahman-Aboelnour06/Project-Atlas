/**
 * Test Suite: TabRegistry, Causal Adoption & Fenced Leases (Milestone 1 / Track R1)
 * File: client-script/test_tab_registry.js
 *
 * Suites:
 * 1. Concurrent CAS writes with AsyncMutex (no lost updates, CAS conflict handling)
 * 2. Causal window adoption (3s window, opener matching, unadopted notification)
 * 3. Fenced execution lease & monotonic epoch (grant increments, stale rejected)
 * 4. Heartbeat tracking & 20s TTL stale lease reclamation
 * 5. Opener health check & discarded tab reload
 * 6. Prerender / tab replacement ID remapping (tabs.onReplaced)
 * 7. Service Worker restart recovery from chrome.storage.session
 * 8. Universal Prime Directive compliance (0 domain hardcoding)
 *
 * Run with: node client-script/test_tab_registry.js
 */

const fs = require('fs');
const path = require('path');
const { TabRegistry, TabRegistryImpl, AsyncMutex } = require('./tab-registry.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ── Mock Storage Engine for Simulating chrome.storage.session ────────────────
class MockStorageSession {
  constructor(initialData = {}) {
    this._data = new Map(Object.entries(initialData));
  }

  async get(keys) {
    const res = {};
    const keyArr = Array.isArray(keys)
      ? keys
      : typeof keys === 'string'
      ? [keys]
      : Object.keys(keys || {});
    for (const k of keyArr) {
      if (this._data.has(k)) {
        res[k] = JSON.parse(JSON.stringify(this._data.get(k)));
      }
    }
    return res;
  }

  async set(items) {
    for (const [k, v] of Object.entries(items)) {
      this._data.set(k, JSON.parse(JSON.stringify(v)));
    }
  }

  async remove(keys) {
    const keyArr = Array.isArray(keys) ? keys : [keys];
    for (const k of keyArr) {
      this._data.delete(k);
    }
  }

  dump() {
    const obj = {};
    for (const [k, v] of this._data.entries()) {
      obj[k] = JSON.parse(JSON.stringify(v));
    }
    return obj;
  }
}

// ── Mock Chrome API Environment ──────────────────────────────────────────────
function setupMockChrome(storageInstance) {
  const tabsStore = new Map();
  const reloadedTabs = [];

  global.chrome = {
    storage: {
      session: storageInstance,
    },
    tabs: {
      _tabs: tabsStore,
      _reloaded: reloadedTabs,
      async get(tabId) {
        if (!tabsStore.has(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        return tabsStore.get(tabId);
      },
      async reload(tabId) {
        reloadedTabs.push(tabId);
        if (tabsStore.has(tabId)) {
          tabsStore.get(tabId).discarded = false;
        }
      },
    },
  };

  return { tabsStore, reloadedTabs };
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  Project Atlas — Tab Registry Unit & Integration Tests');
  console.log('======================================================\n');

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 1: Concurrent CAS Writes with AsyncMutex
  // ───────────────────────────────────────────────────────────────────────────
  console.log('[Suite 1: Concurrent CAS Writes with AsyncMutex]');
  {
    // Test 1.1: AsyncMutex serializes async calls
    const mutex = new AsyncMutex();
    const executionOrder = [];
    const task = async (id, delayMs) => {
      await mutex.runExclusive(async () => {
        executionOrder.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, delayMs));
        executionOrder.push(`end_${id}`);
      });
    };

    await Promise.all([task(1, 20), task(2, 5), task(3, 10)]);
    assert(
      executionOrder[0] === 'start_1' &&
        executionOrder[1] === 'end_1' &&
        executionOrder[2] === 'start_2' &&
        executionOrder[3] === 'end_2' &&
        executionOrder[4] === 'start_3' &&
        executionOrder[5] === 'end_3',
      'AsyncMutex strictly serializes asynchronous critical sections without overlap'
    );

    // Test 1.2: Concurrent updates to session without lost updates
    const mockStorage = new MockStorageSession();
    setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    const session = await registry.createSession({
      rootTabId: 101,
      goalState: { status: 'in_progress', count: 0 },
      initialUrl: 'https://example.com/checkout',
      title: 'Checkout Page',
    });

    assert(session && session.rev === 1, 'Initial session created with rev: 1');

    // Launch 20 concurrent updates
    const updatePromises = [];
    for (let i = 1; i <= 20; i++) {
      updatePromises.push(
        registry.updateGoalState(session.sessionId, {
          status: 'in_progress',
          count: i,
        })
      );
    }
    await Promise.all(updatePromises);

    const updatedSession = await registry.getSession(session.sessionId);
    assert(
      updatedSession.rev === 21,
      `20 concurrent updates increment rev monotonically to 21 (actual rev: ${updatedSession.rev})`
    );
    assert(
      updatedSession.goalState && updatedSession.goalState.status === 'in_progress',
      'Goal state preserved across all 20 concurrent CAS operations'
    );

    // Test 1.3: Dirty write rejected by CAS Revision Guard
    let casErrorThrown = false;
    try {
      // Pass an outdated expectedRev (e.g. 5 when current is 21)
      await registry._setSessionDoc(
        session.sessionId,
        { ...updatedSession, status: 'corrupted' },
        5
      );
    } catch (err) {
      if (err.code === 'CAS_CONFLICT' || err.message.includes('CAS_CONFLICT')) {
        casErrorThrown = true;
      }
    }
    assert(casErrorThrown, 'Outdated expectedRev is rejected with CAS_CONFLICT error');

    // Test 1.4: Valid CAS write succeeds
    const validWrite = await registry._setSessionDoc(
      session.sessionId,
      { ...updatedSession, customField: 'verified' },
      21
    );
    assert(
      validWrite && validWrite.rev === 22,
      'Valid expectedRev succeeds and advances rev to 22'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 2: Causal Window Adoption (H7)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 2: Causal Window Adoption]');
  {
    const mockStorage = new MockStorageSession();
    setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    const session = await registry.createSession({
      rootTabId: 201,
      goalState: { status: 'in_progress' },
      initialUrl: 'https://app.universal.org',
    });

    // Test 2.1: Arming causal window
    const armed = await registry.armCausalWindow(session.sessionId, 201, 3000);
    assert(
      armed.armed && armed.expectChildUntil > Date.now(),
      'armCausalWindow sets 3000ms expiration window'
    );

    // Test 2.2: Tab created within window with matching opener is adopted
    const adoptedRes = await registry.handleTabCreated({
      id: 202,
      openerTabId: 201,
      url: 'https://auth.universal.org/login',
      title: 'Login Window',
    });
    assert(
      adoptedRes.adopted === true &&
        adoptedRes.sessionId === session.sessionId &&
        adoptedRes.tabId === 202 &&
        adoptedRes.role === 'child',
      'Child popup created within causal window is adopted into active session'
    );

    const sAfterAdopt = await registry.getSession(session.sessionId);
    assert(
      sAfterAdopt.tabs.some((t) => t.tabId === 202 && t.role === 'child'),
      'Adopted child tab is recorded in session.tabs'
    );
    assert(
      sAfterAdopt.expectChildUntil === 0,
      'Causal window is consumed immediately upon successful child adoption'
    );

    // Test 2.3: Tab created outside/after causal window is rejected
    const unadoptedOutside = await registry.handleTabCreated({
      id: 203,
      openerTabId: 201,
      url: 'https://news.universal.org',
      title: 'News Tab',
    });
    assert(
      unadoptedOutside.adopted === false &&
        unadoptedOutside.reason === 'outside_window_or_unrelated',
      'Tab created after causal window consumption is NOT adopted'
    );

    // Test 2.4: Tab created with unrelated opener ID is rejected
    await registry.armCausalWindow(session.sessionId, 201, 3000);
    const unadoptedWrongOpener = await registry.handleTabCreated({
      id: 204,
      openerTabId: 99999, // Unrelated opener
      url: 'https://unrelated.com',
      title: 'Unrelated Site',
    });
    assert(
      unadoptedWrongOpener.adopted === false,
      'Tab created with unrelated opener ID is NOT adopted'
    );

    // Test 2.5: Navigation target adoption (webNavigation.onCreatedNavigationTarget)
    const navAdoptRes = await registry.handleNavigationTarget({
      sourceTabId: 201,
      tabId: 205,
      url: 'https://app.universal.org/docs',
    });
    assert(
      navAdoptRes.adopted === true && navAdoptRes.tabId === 205,
      'handleNavigationTarget adopts child tab opened via link navigation'
    );

    // Test 2.6: Unadopted tab does not receive execution lease
    const helloUnadopted = await registry.handleHello({ tabId: 203 });
    assert(
      helloUnadopted.ok === true && helloUnadopted.active === false,
      'Unadopted tab receives active: false on ATLAS_HELLO handshake'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 3: Fenced Execution Lease & Monotonic Epoch (H2 / H3)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 3: Fenced Execution Lease & Monotonic Epoch]');
  {
    const mockStorage = new MockStorageSession();
    setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    const session = await registry.createSession({
      rootTabId: 301,
      goalState: { status: 'in_progress' },
    });

    // Test 3.1: Initial lease holder and epoch
    assert(
      session.currentLeaseTabId === 301 && session.leaseEpoch === 1,
      'Session initializes with lease assigned to rootTabId and leaseEpoch = 1'
    );

    // Adopt child tab
    await registry.armCausalWindow(session.sessionId, 301, 3000);
    await registry.handleTabCreated({ id: 302, openerTabId: 301 });

    // Test 3.2: Transfer lease to child tab
    const grantRes = await registry.grantLease(session.sessionId, 302);
    assert(
      grantRes.ok === true &&
        grantRes.leaseEpoch === 2 &&
        grantRes.currentLeaseTabId === 302,
      'grantLease transfers execution lease to child tab and increments leaseEpoch to 2'
    );

    // Test 3.3: Validate valid lease
    const validLease = await registry.validateLease(session.sessionId, 302, 2);
    assert(
      validLease.valid === true && validLease.leaseEpoch === 2,
      'validateLease accepts current lease holder with valid epoch'
    );

    // Test 3.4: Stale epoch rejected
    const staleEpoch = await registry.validateLease(session.sessionId, 302, 1);
    assert(
      staleEpoch.valid === false &&
        staleEpoch.error === 'STALE_EPOCH' &&
        staleEpoch.currentEpoch === 2,
      'validateLease rejects request with STALE_EPOCH when epoch is outdated'
    );

    // Test 3.5: Non-lease holder rejected
    const notHolder = await registry.validateLease(session.sessionId, 301, 2);
    assert(
      notHolder.valid === false && notHolder.error === 'NOT_LEASE_HOLDER',
      'validateLease rejects request from tab that is not the active lease holder'
    );

    // Test 3.6: Subsequent grant increments epoch further
    const grantAgain = await registry.grantLease(session.sessionId, 301);
    assert(
      grantAgain.leaseEpoch === 3,
      'Subsequent lease grant advances leaseEpoch to 3'
    );
    const oldChildCheck = await registry.validateLease(session.sessionId, 302, 2);
    assert(
      oldChildCheck.valid === false && oldChildCheck.error === 'NOT_LEASE_HOLDER',
      'Previous lease holder is invalidated once lease is transferred'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 4: Heartbeat Tracking & 20s TTL Stale Lease Reclamation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 4: Heartbeat Tracking & 20s TTL Stale Lease Reclamation]');
  {
    const mockStorage = new MockStorageSession();
    setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    const session = await registry.createSession({
      rootTabId: 401,
      goalState: { status: 'in_progress' },
    });
    await registry.armCausalWindow(session.sessionId, 401, 3000);
    await registry.handleTabCreated({ id: 402, openerTabId: 401 });
    await registry.grantLease(session.sessionId, 402); // epoch is 2

    // Test 4.1: Record heartbeat
    const hbRes = await registry.recordHeartbeat(session.sessionId, 402, 2);
    assert(
      hbRes.ok === true && typeof hbRes.timestamp === 'number',
      'recordHeartbeat records timestamp for active lease holder'
    );

    // Test 4.2: Record heartbeat with stale epoch rejected
    const staleHb = await registry.recordHeartbeat(session.sessionId, 402, 1);
    assert(
      staleHb.valid === false && staleHb.error === 'STALE_EPOCH',
      'recordHeartbeat rejects heartbeat with stale epoch'
    );

    // Test 4.3: Fresh heartbeat is NOT reclaimed
    const reclaimedFresh = await registry.checkAndReclaimStaleLeases(20000);
    assert(
      reclaimedFresh.length === 0,
      'Active lease holder with fresh heartbeat within 20s is NOT reclaimed'
    );

    // Test 4.4: Stale lease reclamation after 20s TTL
    // Artificially age the heartbeat to 25 seconds ago
    await registry._setSessionDoc(
      session.sessionId,
      {
        ...(await registry.getSession(session.sessionId)),
        leaseHeartbeat: Date.now() - 25000,
      },
      (await registry.getSession(session.sessionId)).rev
    );

    const reclaimedStale = await registry.checkAndReclaimStaleLeases(20000);
    assert(
      reclaimedStale.length === 1 &&
        reclaimedStale[0].sessionId === session.sessionId &&
        reclaimedStale[0].reclaimedFromTabId === 402 &&
        reclaimedStale[0].newLeaseTabId === 401 &&
        reclaimedStale[0].newEpoch === 3,
      'Stale lease (>20s TTL) is automatically reclaimed back to rootTabId with incremented epoch'
    );

    const sessionAfterReclaim = await registry.getSession(session.sessionId);
    assert(
      sessionAfterReclaim.currentLeaseTabId === 401 &&
        sessionAfterReclaim.leaseEpoch === 3,
      'Session document state reflects reclaimed lease on rootTabId with epoch 3'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 5: Opener Health Check & Discarded Tab Reload (H12)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 5: Opener Health Check & Discarded Tab Reload]');
  {
    const mockStorage = new MockStorageSession();
    const { tabsStore, reloadedTabs } = setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    // Populate mock tabs
    tabsStore.set(501, { id: 501, discarded: false, url: 'https://example.com' });
    tabsStore.set(502, { id: 502, discarded: true, url: 'https://example.com/discarded' });

    // Test 5.1: Healthy opener check
    const healthyCheck = await registry.validateOpenerHealth(501);
    assert(
      healthyCheck.status === 'healthy',
      'validateOpenerHealth identifies active, non-discarded opener as healthy'
    );

    // Test 5.2: Discarded opener reload
    const discardedCheck = await registry.validateOpenerHealth(502);
    assert(
      discardedCheck.status === 'reloaded' && reloadedTabs.includes(502),
      'validateOpenerHealth detects tab.discarded === true and triggers chrome.tabs.reload'
    );

    // Test 5.3: Closed/missing opener check
    const closedCheck = await registry.validateOpenerHealth(999);
    assert(
      closedCheck.status === 'closed',
      'validateOpenerHealth gracefully identifies non-existent/closed opener'
    );

    // Test 5.4: Tab removal transfers lease and validates opener health
    const session = await registry.createSession({ rootTabId: 501 });
    await registry.armCausalWindow(session.sessionId, 501, 3000);
    await registry.handleTabCreated({ id: 503, openerTabId: 501 });
    await registry.grantLease(session.sessionId, 503); // child 503 has lease

    const removeRes = await registry.handleTabRemoved(503);
    assert(
      removeRes.handled === true &&
        removeRes.leaseTransferred === true &&
        removeRes.newLeaseTabId === 501 &&
        removeRes.openerHealth === 'healthy',
      'handleTabRemoved reclaims execution lease back to healthy opener tab'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 6: Prerender / Tab Replacement ID Remapping (tabs.onReplaced)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 6: Prerender / Tab Replacement ID Remapping]');
  {
    const mockStorage = new MockStorageSession();
    setupMockChrome(mockStorage);
    const registry = new TabRegistryImpl();
    registry.setStorage(mockStorage);

    const session = await registry.createSession({
      rootTabId: 601,
      goalState: { status: 'in_progress' },
    });
    await registry.armCausalWindow(session.sessionId, 601, 3000);
    await registry.handleTabCreated({ id: 602, openerTabId: 601 });
    await registry.grantLease(session.sessionId, 602); // 602 is lease holder

    // Test 6.1: Remap lease tab 602 -> 699 (e.g. prerender swap)
    const remapRes = await registry.remapTabId(602, 699);
    assert(
      remapRes.remapped === true &&
        remapRes.removedTabId === 602 &&
        remapRes.addedTabId === 699,
      'remapTabId successfully processes tab replacement'
    );

    const sAfterRemap = await registry.getSession(session.sessionId);
    assert(
      sAfterRemap.currentLeaseTabId === 699,
      'session.currentLeaseTabId is remapped to new tab ID (699)'
    );
    assert(
      sAfterRemap.tabs.some((t) => t.tabId === 699) &&
        !sAfterRemap.tabs.some((t) => t.tabId === 602),
      'session.tabs entries are updated with remapped tab ID'
    );

    // Test 6.2: Lookup index remapped
    const sessionForNewTab = await registry.getSessionForTab(699);
    const sessionForOldTab = await registry.getSessionForTab(602);
    assert(
      sessionForNewTab && sessionForNewTab.sessionId === session.sessionId,
      'getSessionForTab finds session via newly remapped tab ID'
    );
    assert(
      sessionForOldTab === null,
      'getSessionForTab returns null for removed tab ID'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 7: Service Worker Restart Recovery from chrome.storage.session (H4)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 7: Service Worker Restart Recovery]');
  {
    const sharedStorage = new MockStorageSession();
    setupMockChrome(sharedStorage);

    // Instance 1 creates a session and state
    const worker1 = new TabRegistryImpl();
    worker1.setStorage(sharedStorage);

    const originalSession = await worker1.createSession({
      rootTabId: 701,
      goalState: { status: 'in_progress', stepIndex: 3, plan: ['Step 1', 'Step 2'] },
      initialUrl: 'https://example.com/app',
      title: 'App Main',
    });
    await worker1.armCausalWindow(originalSession.sessionId, 701, 3000);
    await worker1.handleTabCreated({
      id: 702,
      openerTabId: 701,
      url: 'https://example.com/popup',
      title: 'OAuth Auth',
    });
    await worker1.grantLease(originalSession.sessionId, 702); // lease on 702, epoch 2

    // Test 7.1: Simulate Service Worker suspension / restart by dropping worker1
    // and initializing a brand new TabRegistry instance connected to same storage
    const worker2 = new TabRegistryImpl();
    worker2.setStorage(sharedStorage);

    // Test 7.2: Recover session from persistent storage
    const recoveredSession = await worker2.getSession(originalSession.sessionId);
    assert(
      recoveredSession &&
        recoveredSession.sessionId === originalSession.sessionId &&
        recoveredSession.rev === 4 &&
        recoveredSession.rootTabId === 701 &&
        recoveredSession.currentLeaseTabId === 702 &&
        recoveredSession.leaseEpoch === 2,
      'SW restart recovers complete session metadata, revision, and lease epoch from storage'
    );

    assert(
      recoveredSession.tabs.length === 2 &&
        recoveredSession.tabs.some((t) => t.tabId === 702 && t.role === 'child'),
      'SW restart recovers child tabs and roles'
    );

    // Test 7.3: Injected content script pull-based ATLAS_HELLO handshake on recovered SW
    const helloHandshake = await worker2.handleHello({
      tabId: 702,
      url: 'https://example.com/popup#logged_in',
      title: 'OAuth Auth Success',
    });
    assert(
      helloHandshake.ok === true &&
        helloHandshake.active === true &&
        helloHandshake.isLeaseHolder === true &&
        helloHandshake.leaseEpoch === 2 &&
        helloHandshake.pendingResume === true &&
        helloHandshake.goalState.status === 'in_progress',
      'ATLAS_HELLO handshake restores execution context after Service Worker restart'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suite 8: Universal Prime Directive Compliance
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Suite 8: Universal Prime Directive Compliance]');
  {
    const tabRegistryCode = fs.readFileSync(
      path.join(__dirname, 'tab-registry.js'),
      'utf8'
    );

    // Test 8.1: Zero domain hardcoding
    const forbiddenDomains = [
      'google.com',
      'amazon.com',
      'github.com',
      'auth0.com',
      'facebook.com',
      'apple.com',
      'microsoft.com',
      'wikipedia.org',
    ];

    let foundDomain = false;
    for (const domain of forbiddenDomains) {
      if (tabRegistryCode.includes(domain)) {
        foundDomain = true;
        console.error(`  Found hardcoded domain: ${domain}`);
      }
    }
    assert(
      !foundDomain,
      'tab-registry.js contains strictly ZERO hardcoded domains (Prime Directive)'
    );

    // Test 8.2: Pure generic semantic logic
    assert(
      !tabRegistryCode.includes('window.location.hostname'),
      'tab-registry.js contains zero window.location.hostname checks'
    );
    assert(
      tabRegistryCode.includes('AsyncMutex') &&
        tabRegistryCode.includes('CAS_CONFLICT') &&
        tabRegistryCode.includes('STALE_EPOCH'),
      'tab-registry.js implements standard AsyncMutex, CAS revision guards, and epoch fencing'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log(`Tab Registry Tests Complete: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});

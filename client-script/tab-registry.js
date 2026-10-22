/**
 * TabRegistry — Multi-Tab Session Lifecycle & Fenced Lease Manager
 * File: client-script/tab-registry.js
 *
 * Architecture:
 * - AsyncMutex: In-memory Promise-queue mutual exclusion lock serializing read-modify-write transactions.
 * - CAS Revision Guards: Monotonic integer `rev` counter on session records in chrome.storage.session.
 * - Causal Window Adoption: 3-second temporal window (`expectChildUntil`) for adopting child tabs/popups
 *   spawned by Atlas actions or user gestures.
 * - Pull-Based Resume (ATLAS_HELLO): Content scripts handshake on boot to eliminate push race conditions.
 * - Fenced Execution Lease: Single execution lease holder per session with monotonic `leaseEpoch` counter,
 *   rejecting split-brain requests with STALE_EPOCH.
 * - Opener Health & Reconnect: Discarded opener reload detection and chrome.tabs.onReplaced tab ID remapping.
 *
 * Universal Directive:
 * - 100% universal across all websites. Strictly ZERO domain/host hardcoding or vendor-specific selectors.
 */

// ── Async Mutex ─────────────────────────────────────────────────────────────
class AsyncMutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  /**
   * Run an asynchronous function exclusively within the lock queue.
   * @template T
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  async runExclusive(fn) {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const prev = this._queue;
    this._queue = next;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// ── Tab Registry Implementation ─────────────────────────────────────────────
class TabRegistryImpl {
  constructor() {
    this._mutex = new AsyncMutex();
    this._customStorage = null;
    this._memoryStorage = new Map();
  }

  /**
   * Allow injecting custom storage mock for isolated testing.
   * @param {{ get: (k: any) => Promise<any>, set: (items: any) => Promise<void>, remove: (k: any) => Promise<void> } | null} storage
   */
  setStorage(storage) {
    this._customStorage = storage;
  }

  /**
   * Reset in-memory storage fallback.
   */
  resetMemoryStorage() {
    this._memoryStorage = new Map();
  }

  /**
   * Internal storage accessor (chrome.storage.session with in-memory fallback).
   */
  _getStorage() {
    if (this._customStorage) return this._customStorage;
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      return {
        async get(keys) {
          return await chrome.storage.session.get(keys);
        },
        async set(items) {
          return await chrome.storage.session.set(items);
        },
        async remove(keys) {
          return await chrome.storage.session.remove(keys);
        },
      };
    }
    const mem = this._memoryStorage;
    return {
      async get(keys) {
        const res = {};
        const keyArr = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
          ? [keys]
          : Object.keys(keys || {});
        for (const k of keyArr) {
          if (mem.has(k)) {
            res[k] = JSON.parse(JSON.stringify(mem.get(k)));
          }
        }
        return res;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) {
          mem.set(k, JSON.parse(JSON.stringify(v)));
        }
      },
      async remove(keys) {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          mem.delete(k);
        }
      },
    };
  }

  // ── Low-Level Session Document Accessors with CAS ──────────────────────────

  async _getSessionDoc(sessionId) {
    if (!sessionId) return null;
    const storage = this._getStorage();
    const key = `atlas_session_${sessionId}`;
    const res = await storage.get(key);
    return res ? res[key] || null : null;
  }

  async _setSessionDoc(sessionId, doc, expectedRev) {
    const storage = this._getStorage();
    const key = `atlas_session_${sessionId}`;
    const current = await this._getSessionDoc(sessionId);

    if (expectedRev !== undefined && expectedRev !== null) {
      if (current && current.rev !== expectedRev) {
        const err = new Error(
          `CAS_CONFLICT: expected rev ${expectedRev}, found ${current.rev}`
        );
        err.code = "CAS_CONFLICT";
        err.currentRev = current.rev;
        throw err;
      }
      if (!current && expectedRev !== 0) {
        const err = new Error(
          `CAS_CONFLICT: session does not exist, expected rev ${expectedRev}`
        );
        err.code = "CAS_CONFLICT";
        throw err;
      }
    }

    const nextRev =
      (current && typeof current.rev === "number" ? current.rev : 0) + 1;
    const toSave = {
      ...doc,
      sessionId,
      rev: nextRev,
      updated_at: Date.now(),
    };

    await storage.set({ [key]: toSave });
    return toSave;
  }

  async _getTabToSessionMapping(tabId) {
    if (!tabId) return null;
    const storage = this._getStorage();
    const key = `atlas_tab_to_session_${tabId}`;
    const res = await storage.get(key);
    return res ? res[key] || null : null;
  }

  async _setTabToSessionMapping(tabId, sessionId) {
    const storage = this._getStorage();
    const key = `atlas_tab_to_session_${tabId}`;
    await storage.set({ [key]: sessionId });
  }

  async _removeTabToSessionMapping(tabId) {
    const storage = this._getStorage();
    const key = `atlas_tab_to_session_${tabId}`;
    await storage.remove(key);
  }

  async _addActiveSessionId(sessionId) {
    const storage = this._getStorage();
    const key = "atlas_active_sessions";
    const res = await storage.get(key);
    const list = res && Array.isArray(res[key]) ? res[key] : [];
    if (!list.includes(sessionId)) {
      list.push(sessionId);
      await storage.set({ [key]: list });
    }
  }

  async _removeActiveSessionId(sessionId) {
    const storage = this._getStorage();
    const key = "atlas_active_sessions";
    const res = await storage.get(key);
    const list = res && Array.isArray(res[key]) ? res[key] : [];
    const nextList = list.filter((id) => id !== sessionId);
    await storage.set({ [key]: nextList });
  }

  // ── Session Lifecycle API ──────────────────────────────────────────────────

  /**
   * Create and persist a new multi-tab session.
   * @param {{ rootTabId: number, goalState?: any, initialUrl?: string, title?: string }} options
   */
  async createSession({ rootTabId, goalState = null, initialUrl = "", title = "" }) {
    if (!rootTabId) throw new Error("rootTabId is required to create a session");

    return await this._mutex.runExclusive(async () => {
      const sessionId = `session_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const now = Date.now();

      const doc = {
        sessionId,
        rev: 1,
        rootTabId,
        currentLeaseTabId: rootTabId,
        leaseEpoch: 1,
        leaseGrantedAt: now,
        leaseHeartbeat: now,
        expectChildUntil: 0,
        expectedOpenerTabId: null,
        status: "active",
        goalState: goalState || null,
        tabs: [
          {
            tabId: rootTabId,
            role: "opener",
            openerTabId: null,
            url: (initialUrl || "").slice(0, 2048),
            title: (title || "").slice(0, 80),
            status: "active",
            adoptedAt: now,
          },
        ],
        created_at: now,
        updated_at: now,
      };

      const storage = this._getStorage();
      await storage.set({ [`atlas_session_${sessionId}`]: doc });
      await this._setTabToSessionMapping(rootTabId, sessionId);
      await this._addActiveSessionId(sessionId);

      return doc;
    });
  }

  /**
   * Retrieve session document by ID.
   * @param {string} sessionId
   */
  async getSession(sessionId) {
    return await this._getSessionDoc(sessionId);
  }

  /**
   * Retrieve session for a given tab ID.
   * @param {number} tabId
   */
  async getSessionForTab(tabId) {
    const sessionId = await this._getTabToSessionMapping(tabId);
    if (!sessionId) return null;
    return await this.getSession(sessionId);
  }

  /**
   * Retrieve all currently active sessions.
   */
  async getActiveSessions() {
    const storage = this._getStorage();
    const key = "atlas_active_sessions";
    const res = await storage.get(key);
    const ids = res && Array.isArray(res[key]) ? res[key] : [];
    const sessions = [];
    for (const id of ids) {
      const doc = await this._getSessionDoc(id);
      if (doc && doc.status === "active") {
        sessions.push(doc);
      }
    }
    return sessions;
  }

  /**
   * Update goal state associated with a session.
   * @param {string} sessionId
   * @param {any} goalState
   */
  async updateGoalState(sessionId, goalState) {
    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session) return null;
      session.goalState = goalState;
      return await this._setSessionDoc(sessionId, session, session.rev);
    });
  }

  /**
   * Close a session and clean up tab mappings.
   * @param {string} sessionId
   * @param {string} status
   */
  async closeSession(sessionId, status = "completed") {
    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session) return { closed: false, reason: "not_found" };

      session.status = status;
      await this._setSessionDoc(sessionId, session, session.rev);

      if (Array.isArray(session.tabs)) {
        for (const t of session.tabs) {
          await this._removeTabToSessionMapping(t.tabId);
        }
      }

      await this._removeActiveSessionId(sessionId);
      return { closed: true, sessionId, status };
    });
  }

  // ── Causal Window Adoption (H7) ───────────────────────────────────────────

  /**
   * Arm a 3-second causal window expecting child tabs from an Atlas action or user click.
   * @param {string} sessionId
   * @param {number} openerTabId
   * @param {number} windowMs
   */
  async armCausalWindow(sessionId, openerTabId, windowMs = 3000) {
    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session || session.status !== "active") {
        return { armed: false, error: "SESSION_NOT_ACTIVE" };
      }

      const duration = Number(windowMs) > 0 ? Number(windowMs) : 3000;
      session.expectChildUntil = Date.now() + duration;
      session.expectedOpenerTabId = openerTabId || session.currentLeaseTabId;

      await this._setSessionDoc(sessionId, session, session.rev);
      return {
        armed: true,
        sessionId,
        openerTabId: session.expectedOpenerTabId,
        expectChildUntil: session.expectChildUntil,
      };
    });
  }

  /**
   * Handle chrome.tabs.onCreated event. Adopts tab if within causal window.
   * @param {{ id: number, openerTabId?: number, url?: string, pendingUrl?: string, title?: string }} tab
   */
  async handleTabCreated(tab) {
    if (!tab || !tab.id) return { adopted: false, reason: "invalid_tab" };

    return await this._mutex.runExclusive(async () => {
      const now = Date.now();
      const activeSessions = await this.getActiveSessions();

      for (const session of activeSessions) {
        if (session.status !== "active") continue;

        const isWindowOpen =
          Boolean(session.expectChildUntil) && now <= session.expectChildUntil;

        const openerMatches =
          Boolean(tab.openerTabId) &&
          (tab.openerTabId === session.currentLeaseTabId ||
            tab.openerTabId === session.expectedOpenerTabId ||
            tab.openerTabId === session.rootTabId);

        // Fallback for rel="noopener" where openerTabId is omitted by Chrome
        const armedWithoutOpener =
          !tab.openerTabId && isWindowOpen && Boolean(session.expectedOpenerTabId);

        if (isWindowOpen && (openerMatches || armedWithoutOpener)) {
          const existing = (session.tabs || []).find((t) => t.tabId === tab.id);
          if (existing) {
            return {
              adopted: true,
              sessionId: session.sessionId,
              tabId: tab.id,
              duplicate: true,
            };
          }

          const childRecord = {
            tabId: tab.id,
            role: "child",
            openerTabId:
              tab.openerTabId ||
              session.expectedOpenerTabId ||
              session.currentLeaseTabId,
            url: (tab.url || tab.pendingUrl || "").slice(0, 2048),
            title: (tab.title || "").slice(0, 80),
            status: "active",
            adoptedAt: now,
          };

          session.tabs = session.tabs || [];
          session.tabs.push(childRecord);
          // Consume causal window
          session.expectChildUntil = 0;
          session.expectedOpenerTabId = null;

          await this._setSessionDoc(session.sessionId, session, session.rev);
          await this._setTabToSessionMapping(tab.id, session.sessionId);

          return {
            adopted: true,
            sessionId: session.sessionId,
            tabId: tab.id,
            role: "child",
            openerTabId: childRecord.openerTabId,
          };
        }
      }

      return {
        adopted: false,
        reason: "outside_window_or_unrelated",
        tabId: tab.id,
      };
    });
  }

  /**
   * Handle chrome.webNavigation.onCreatedNavigationTarget event.
   * @param {{ sourceTabId: number, tabId: number, url?: string }} details
   */
  async handleNavigationTarget(details) {
    if (!details || !details.tabId) return { adopted: false };

    return await this._mutex.runExclusive(async () => {
      const sourceTabId = details.sourceTabId;
      if (!sourceTabId) return { adopted: false, reason: "no_source" };

      const sessionId = await this._getTabToSessionMapping(sourceTabId);
      if (!sessionId) return { adopted: false, reason: "untracked_source" };

      const session = await this._getSessionDoc(sessionId);
      if (!session || session.status !== "active") {
        return { adopted: false, reason: "session_inactive" };
      }

      const now = Date.now();
      const isWindowOpen =
        Boolean(session.expectChildUntil) && now <= session.expectChildUntil;
      const isLeaseHolder = session.currentLeaseTabId === sourceTabId;

      if (isWindowOpen || isLeaseHolder) {
        const existing = (session.tabs || []).find((t) => t.tabId === details.tabId);
        if (existing) {
          return {
            adopted: true,
            sessionId: session.sessionId,
            tabId: details.tabId,
            duplicate: true,
          };
        }

        const childRecord = {
          tabId: details.tabId,
          role: "child",
          openerTabId: sourceTabId,
          url: (details.url || "").slice(0, 2048),
          title: "",
          status: "active",
          adoptedAt: now,
        };

        session.tabs = session.tabs || [];
        session.tabs.push(childRecord);
        session.expectChildUntil = 0;
        session.expectedOpenerTabId = null;

        await this._setSessionDoc(session.sessionId, session, session.rev);
        await this._setTabToSessionMapping(details.tabId, session.sessionId);

        return {
          adopted: true,
          sessionId: session.sessionId,
          tabId: details.tabId,
          role: "child",
          openerTabId: sourceTabId,
        };
      }

      return { adopted: false, reason: "outside_window", tabId: details.tabId };
    });
  }

  // ── Pull-Based Handshake (ATLAS_HELLO) (H1) ───────────────────────────────

  /**
   * Handle pull-based ATLAS_HELLO handshake sent by content script on ready.
   * @param {{ tabId: number, url?: string, title?: string }} options
   */
  async handleHello({ tabId, url = "", title = "" }) {
    if (!tabId) return { ok: false, error: "MISSING_TAB_ID" };

    const sessionId = await this._getTabToSessionMapping(tabId);
    if (!sessionId) {
      return { ok: true, active: false };
    }

    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session || session.status !== "active") {
        return { ok: true, active: false };
      }

      const tabRecord = (session.tabs || []).find((t) => t.tabId === tabId);
      if (tabRecord) {
        if (url) tabRecord.url = String(url).slice(0, 2048);
        if (title) tabRecord.title = String(title).slice(0, 80);
        tabRecord.status = "active";
      }

      const isLeaseHolder = session.currentLeaseTabId === tabId;
      const pendingResume = Boolean(
        isLeaseHolder &&
          session.goalState &&
          session.goalState.status === "in_progress"
      );

      await this._setSessionDoc(session.sessionId, session, session.rev);

      return {
        ok: true,
        active: true,
        sessionId: session.sessionId,
        isLeaseHolder,
        leaseEpoch: session.leaseEpoch,
        pendingResume,
        goalState: session.goalState,
        openerTabId: session.rootTabId,
        role: tabRecord
          ? tabRecord.role
          : tabId === session.rootTabId
          ? "opener"
          : "child",
      };
    });
  }

  // ── Fenced Execution Lease & Epoch Fencing (H2 / H3) ───────────────────────

  /**
   * Grant execution lease to a designated tab and increment leaseEpoch.
   * @param {string} sessionId
   * @param {number} newTabId
   */
  async grantLease(sessionId, newTabId) {
    if (!sessionId || !newTabId) {
      throw new Error("sessionId and newTabId are required to grant lease");
    }

    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      if (session.status !== "active") {
        throw new Error(`Session ${sessionId} is not active`);
      }

      session.leaseEpoch = (session.leaseEpoch || 0) + 1;
      session.currentLeaseTabId = newTabId;
      session.leaseGrantedAt = Date.now();
      session.leaseHeartbeat = Date.now();

      const saved = await this._setSessionDoc(sessionId, session, session.rev);
      return {
        ok: true,
        sessionId,
        leaseEpoch: saved.leaseEpoch,
        currentLeaseTabId: newTabId,
      };
    });
  }

  /**
   * Validate that caller holds the active execution lease with a matching epoch.
   * @param {string} sessionId
   * @param {number} tabId
   * @param {number} epoch
   */
  async validateLease(sessionId, tabId, epoch) {
    const session = await this._getSessionDoc(sessionId);
    if (!session || session.status !== "active") {
      return { valid: false, error: "SESSION_NOT_ACTIVE" };
    }

    if (session.currentLeaseTabId !== tabId) {
      return {
        valid: false,
        error: "NOT_LEASE_HOLDER",
        currentEpoch: session.leaseEpoch,
        currentLeaseTabId: session.currentLeaseTabId,
      };
    }

    if (Number(epoch) !== Number(session.leaseEpoch)) {
      return {
        valid: false,
        error: "STALE_EPOCH",
        currentEpoch: session.leaseEpoch,
        currentLeaseTabId: session.currentLeaseTabId,
      };
    }

    return {
      valid: true,
      leaseEpoch: session.leaseEpoch,
      currentLeaseTabId: session.currentLeaseTabId,
    };
  }

  /**
   * Record periodic lease heartbeat (emitted by lease holder every 5s).
   * @param {string} sessionId
   * @param {number} tabId
   * @param {number} epoch
   */
  async recordHeartbeat(sessionId, tabId, epoch) {
    const validation = await this.validateLease(sessionId, tabId, epoch);
    if (!validation.valid) return validation;

    return await this._mutex.runExclusive(async () => {
      const session = await this._getSessionDoc(sessionId);
      if (!session || session.status !== "active") {
        return { valid: false, error: "SESSION_NOT_ACTIVE" };
      }
      if (
        session.currentLeaseTabId !== tabId ||
        Number(session.leaseEpoch) !== Number(epoch)
      ) {
        return {
          valid: false,
          error: "STALE_EPOCH",
          currentEpoch: session.leaseEpoch,
        };
      }

      session.leaseHeartbeat = Date.now();
      await this._setSessionDoc(sessionId, session, session.rev);
      return { ok: true, timestamp: session.leaseHeartbeat };
    });
  }

  /**
   * Check all active sessions for stale leases (> ttlMs, default 20s) and reclaim back to rootTabId.
   * @param {number} ttlMs
   */
  async checkAndReclaimStaleLeases(ttlMs = 20000) {
    return await this._mutex.runExclusive(async () => {
      const now = Date.now();
      const activeSessions = await this.getActiveSessions();
      const reclaimed = [];

      for (const session of activeSessions) {
        if (session.status !== "active") continue;
        // Only reclaim if the current lease is held by a child tab
        if (session.currentLeaseTabId !== session.rootTabId) {
          const lastHb =
            session.leaseHeartbeat || session.leaseGrantedAt || 0;
          if (now - lastHb > ttlMs) {
            const staleTabId = session.currentLeaseTabId;
            session.leaseEpoch = (session.leaseEpoch || 0) + 1;
            session.currentLeaseTabId = session.rootTabId;
            session.leaseGrantedAt = now;
            session.leaseHeartbeat = now;

            await this._setSessionDoc(session.sessionId, session, session.rev);
            reclaimed.push({
              sessionId: session.sessionId,
              reclaimedFromTabId: staleTabId,
              newLeaseTabId: session.rootTabId,
              newEpoch: session.leaseEpoch,
            });
          }
        }
      }

      return reclaimed;
    });
  }

  // ── Opener Health & Reconnect (H12) ───────────────────────────────────────

  /**
   * Validate health of opener tab via chrome.tabs.get; reload if discarded.
   * @param {number} openerTabId
   */
  async validateOpenerHealth(openerTabId) {
    if (!openerTabId) return { status: "invalid_id" };
    if (typeof chrome === "undefined" || !chrome.tabs?.get) {
      return { status: "healthy", tabId: openerTabId, mocked: true };
    }
    try {
      const tab = await chrome.tabs.get(openerTabId);
      if (!tab) return { status: "closed", tabId: openerTabId };
      if (tab.discarded) {
        if (chrome.tabs.reload) {
          await chrome.tabs.reload(openerTabId);
        }
        return { status: "reloaded", tabId: openerTabId };
      }
      return { status: "healthy", tabId: openerTabId };
    } catch (err) {
      return { status: "closed", tabId: openerTabId, error: err.message };
    }
  }

  /**
   * Remap tab ID when prerendering or instant navigation swaps a tab (chrome.tabs.onReplaced).
   * @param {number} removedTabId
   * @param {number} addedTabId
   */
  async remapTabId(removedTabId, addedTabId) {
    if (!removedTabId || !addedTabId) {
      return { remapped: false, reason: "invalid_tab_ids" };
    }

    return await this._mutex.runExclusive(async () => {
      const sessionId = await this._getTabToSessionMapping(removedTabId);
      if (!sessionId) return { remapped: false, reason: "session_not_found" };

      const session = await this._getSessionDoc(sessionId);
      if (!session) return { remapped: false, reason: "session_not_found" };

      if (session.rootTabId === removedTabId) {
        session.rootTabId = addedTabId;
      }
      if (session.currentLeaseTabId === removedTabId) {
        session.currentLeaseTabId = addedTabId;
      }
      if (session.expectedOpenerTabId === removedTabId) {
        session.expectedOpenerTabId = addedTabId;
      }
      if (Array.isArray(session.tabs)) {
        for (const t of session.tabs) {
          if (t.tabId === removedTabId) t.tabId = addedTabId;
          if (t.openerTabId === removedTabId) t.openerTabId = addedTabId;
        }
      }

      await this._setSessionDoc(session.sessionId, session, session.rev);
      await this._removeTabToSessionMapping(removedTabId);
      await this._setTabToSessionMapping(addedTabId, session.sessionId);

      return {
        remapped: true,
        sessionId: session.sessionId,
        removedTabId,
        addedTabId,
      };
    });
  }

  /**
   * Handle chrome.tabs.onRemoved event. Cleans up tab and transfers lease if closed tab held it.
   * @param {number} closedTabId
   */
  async handleTabRemoved(closedTabId) {
    return await this._mutex.runExclusive(async () => {
      const sessionId = await this._getTabToSessionMapping(closedTabId);
      if (!sessionId) return { handled: false, reason: "untracked_tab" };

      const session = await this._getSessionDoc(sessionId);
      if (!session) return { handled: false, reason: "session_not_found" };

      if (Array.isArray(session.tabs)) {
        for (const t of session.tabs) {
          if (t.tabId === closedTabId) {
            t.status = "closed";
            t.closedAt = Date.now();
          }
        }
      }

      await this._removeTabToSessionMapping(closedTabId);

      // Root tab closed -> abort session
      if (closedTabId === session.rootTabId) {
        session.status = "aborted";
        await this._setSessionDoc(session.sessionId, session, session.rev);
        await this._removeActiveSessionId(session.sessionId);
        return {
          handled: true,
          sessionAborted: true,
          sessionId: session.sessionId,
          closedTabId,
        };
      }

      // Lease holder closed -> reclaim lease to root tab
      if (closedTabId === session.currentLeaseTabId) {
        const openerHealth = await this.validateOpenerHealth(session.rootTabId);

        session.leaseEpoch = (session.leaseEpoch || 0) + 1;
        session.currentLeaseTabId = session.rootTabId;
        session.leaseGrantedAt = Date.now();
        session.leaseHeartbeat = Date.now();

        await this._setSessionDoc(session.sessionId, session, session.rev);

        return {
          handled: true,
          leaseTransferred: true,
          newLeaseTabId: session.rootTabId,
          newEpoch: session.leaseEpoch,
          openerHealth: openerHealth.status,
          sessionId: session.sessionId,
          closedTabId,
        };
      }

      await this._setSessionDoc(session.sessionId, session, session.rev);
      return {
        handled: true,
        leaseTransferred: false,
        sessionId: session.sessionId,
        closedTabId,
      };
    });
  }
}

// Singleton instance
const TabRegistry = new TabRegistryImpl();

// Export for Node.js, Service Worker, and Browser environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TabRegistry,
    TabRegistryImpl,
    AsyncMutex,
  };
}

if (typeof self !== "undefined") {
  self.TabRegistry = TabRegistry;
  self.TabRegistryImpl = TabRegistryImpl;
  self.AsyncMutex = AsyncMutex;
}

if (typeof window !== "undefined") {
  window.TabRegistry = TabRegistry;
  window.TabRegistryImpl = TabRegistryImpl;
  window.AsyncMutex = AsyncMutex;
}

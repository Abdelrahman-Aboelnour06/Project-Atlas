/**
 * connection-manager.js — Universal Connection Resilience & Backoff Manager
 * Project Atlas — Task U5
 *
 * Implements exponential backoff with jitter capped at 30 seconds,
 * dynamic countdown timers, accessible manual retry triggers,
 * browser online/offline lifecycle detection, and zero unhandled errors.
 *
 * 100% universal across all websites (Prime Directive).
 */

(function () {
  const STATE = {
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    RECONNECTING: 'RECONNECTING',
    OFFLINE: 'OFFLINE',
  };

  const BASE_DELAY_MS = 1000;
  const JITTER_MS = 1000;
  const MAX_DELAY_MS = 30000;

  class ConnectionManager {
    constructor(options = {}) {
      this.baseDelay = options.baseDelay || BASE_DELAY_MS;
      this.jitter = options.jitter || JITTER_MS;
      this.maxDelay = options.maxDelay || MAX_DELAY_MS;

      this.state = STATE.IDLE;
      this.attempt = 0;
      this.backoffTimer = null;
      this.countdownInterval = null;
      this.secondsRemaining = 0;
      this.currentDelayMs = 0;

      this.listeners = {
        stateChange: new Set(),
        countdown: new Set(),
      };

      this.connectFn = null;
      this._bindNetworkListeners();
    }

    _bindNetworkListeners() {
      if (typeof window !== 'undefined') {
        try {
          window.addEventListener('online', () => {
            if (this.state === STATE.OFFLINE || this.state === STATE.RECONNECTING) {
              this.retryNow();
            }
          });
          window.addEventListener('offline', () => {
            this.transitionToOffline();
          });
        } catch (_) {}
      }
    }

    setConnectHandler(fn) {
      this.connectFn = fn;
    }

    calculateDelay(attempt) {
      const exponential = this.baseDelay * Math.pow(2, attempt);
      const randomJitter = Math.random() * this.jitter;
      return Math.min(this.maxDelay, Math.floor(exponential + randomJitter));
    }

    onStateChange(fn) {
      this.listeners.stateChange.add(fn);
      return () => this.listeners.stateChange.delete(fn);
    }

    onCountdown(fn) {
      this.listeners.countdown.add(fn);
      return () => this.listeners.countdown.delete(fn);
    }

    _setState(newState, payload = {}) {
      this.state = newState;
      for (const fn of this.listeners.stateChange) {
        try {
          fn(newState, {
            attempt: this.attempt,
            secondsRemaining: this.secondsRemaining,
            delayMs: this.currentDelayMs,
            ...payload,
          });
        } catch (err) {
          console.error('Atlas ConnectionManager listener error:', err);
        }
      }
    }

    startConnecting() {
      this._clearTimers();
      this._setState(STATE.CONNECTING);
    }

    markConnected() {
      this._clearTimers();
      this.attempt = 0;
      this.secondsRemaining = 0;
      this.currentDelayMs = 0;
      this._setState(STATE.CONNECTED);
    }

    handleDisconnect(error) {
      this._clearTimers();

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.transitionToOffline();
        return;
      }

      this.currentDelayMs = this.calculateDelay(this.attempt);
      this.secondsRemaining = Math.max(1, Math.ceil(this.currentDelayMs / 1000));

      this._setState(STATE.RECONNECTING, {
        delayMs: this.currentDelayMs,
        secondsRemaining: this.secondsRemaining,
        error: error?.message || 'Disconnected',
      });

      this.countdownInterval = setInterval(() => {
        this.secondsRemaining -= 1;
        if (this.secondsRemaining > 0) {
          for (const fn of this.listeners.countdown) {
            try {
              fn(this.secondsRemaining);
            } catch (_) {}
          }
          this._setState(STATE.RECONNECTING, {
            delayMs: this.currentDelayMs,
            secondsRemaining: this.secondsRemaining,
          });
        } else {
          this._clearTimers();
          this.attempt += 1;
          this._triggerReconnect();
        }
      }, 1000);
    }

    transitionToOffline() {
      this._clearTimers();
      this.secondsRemaining = 0;
      this._setState(STATE.OFFLINE, { message: 'Network offline' });
    }

    retryNow() {
      this._clearTimers();
      this.attempt = 0;
      this.secondsRemaining = 0;
      this.startConnecting();
      return this._triggerReconnect();
    }

    async _triggerReconnect() {
      if (!this.connectFn) return;
      this._setState(STATE.CONNECTING);
      try {
        await this.connectFn();
        this.markConnected();
      } catch (err) {
        this.handleDisconnect(err);
      }
    }

    _clearTimers() {
      if (this.backoffTimer) {
        clearTimeout(this.backoffTimer);
        this.backoffTimer = null;
      }
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }

    getState() {
      return this.state;
    }

    getAttempt() {
      return this.attempt;
    }

    getSecondsRemaining() {
      return this.secondsRemaining;
    }

    destroy() {
      this._clearTimers();
      this.listeners.stateChange.clear();
      this.listeners.countdown.clear();
      this.state = STATE.IDLE;
      this.attempt = 0;
      this.secondsRemaining = 0;
    }
  }

  const AtlasConnectionManager = new ConnectionManager();

  if (typeof window !== 'undefined') {
    window.AtlasConnectionManager = AtlasConnectionManager;
    window.AtlasConnection = AtlasConnectionManager;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConnectionManager, AtlasConnectionManager, STATE };
  }
})();

/**
 * ws-client.js — Universal WebSocket Client Wrapper & Alias
 * Project Atlas
 */
(function () {
  if (typeof module !== 'undefined' && module.exports) {
    try {
      module.exports = require('./websocket-client.js');
    } catch (_) {}
  } else if (typeof window !== 'undefined') {
    window.AtlasWsClient = window.AtlasSocket;
  }
})();

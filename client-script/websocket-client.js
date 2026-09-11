(function () {
// websocket-client.js
// Task C — owns the socket only (per docs/conventions.md module boundaries).
// Talks to the backend per docs/contracts.md Contract 1 / Contract 2 and
// backend/app/models/request.py (AgentMessage: session_id, api_key, url,
// dom_map, command).
//
// Public API (window.AtlasSocket):
//   AtlasSocket.connect({ baseUrl, apiKey }) -> Promise<void>
//   AtlasSocket.sendCommand({ url, domMap, command }) -> Promise<ActionResponse>
//   AtlasSocket.onDisconnect(fn)
//   AtlasSocket.close()
//
// ActionResponse shape (Contract 2):
//   { status, action, element_id, value, message }

const DEFAULT_BASE_URL = 'http://localhost:8000'
const RECONNECT_DELAY_MS = 1500
const MAX_RECONNECT_ATTEMPTS = 5

let socket = null
let sessionId = null
let apiKey = null
let baseUrl = DEFAULT_BASE_URL
let reconnectAttempts = 0
let disconnectHandlers = []

// Requests are matched to responses by resolving the oldest pending
// promise in send order — the backend handles one message at a time per
// connection (see agent.py "one voice command per message").
let pendingQueue = []
// True once the backend has accepted our api_key on this connection
let authenticated = false

const wsUrl = () => `${baseUrl.replace(/^http/, 'ws')}/v1/agent`

const startSession = async () => {
  try {
    const res = await fetch(`${baseUrl}/v1/session/start`, {
      method: 'POST',
      headers: { 'X-Atlas-Key': apiKey },
    })
    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        detail = body.detail || body.message || ''
      } catch (_) {
        detail = await res.text().catch(() => '')
      }
      const msg = `session/start failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`
      console.error('Atlas:', msg)
      throw new Error(msg)
    }
    const data = await res.json()
    return data.session_id
  } catch (err) {
    console.error('Atlas: Error in startSession:', err)
    throw err
  }
}

const openSocket = () =>
  new Promise((resolve, reject) => {
    const targetUrl = wsUrl()
    try {
      socket = new WebSocket(targetUrl)
    } catch (err) {
      console.error('Atlas: WebSocket constructor failed for', targetUrl, err)
      return reject(err)
    }

    socket.onopen = () => {
      reconnectAttempts = 0
      resolve()
    }

    socket.onmessage = (event) => {
      const next = pendingQueue.shift()
      if (!next) return // unsolicited message — ignore
      try {
        next.resolve(JSON.parse(event.data))
      } catch (err) {
        next.reject(err)
      }
    }

    socket.onerror = (err) => {
      console.error('Atlas: WebSocket error on', targetUrl, err)
      reject(new Error(`WebSocket connection failed to ${targetUrl}`))
    }

    socket.onclose = (event) => {
      console.warn('Atlas: WebSocket closed', event.code, event.reason)
      pendingQueue.forEach((p) => p.reject(new Error('Socket closed')))
      pendingQueue = []
      disconnectHandlers.forEach((fn) => fn())
      maybeReconnect()
    }
  })

const maybeReconnect = () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
  reconnectAttempts += 1
  setTimeout(() => {
    openSocket()
      .then(() => authenticate())
      .catch((err) => {
        console.warn('Atlas: reconnect attempt failed', err)
      })
  }, RECONNECT_DELAY_MS)
}

const authenticate = () =>
  new Promise((resolve, reject) => {
    pendingQueue.push({
      resolve: (data) => {
        if (data.status === 'ok') {
          authenticated = true
          resolve()
        } else {
          const errMsg = data.message || 'Authentication failed'
          console.error('Atlas: Auth failed:', errMsg)
          reject(new Error(errMsg))
        }
      },
      reject,
    })
    socket.send(JSON.stringify({ type: 'auth', api_key: apiKey }))
  })


const hasBgProxy = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage

const connect = async ({ baseUrl: base, apiKey: key } = {}) => {
  if (base) baseUrl = base
  if (key) apiKey = key
  if (!apiKey) throw new Error('AtlasSocket.connect requires an apiKey')

  if (hasBgProxy()) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'ATLAS_SOCKET_CONNECT', baseUrl, apiKey },
        (res) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message))
          }
          if (!res || !res.ok) {
            return reject(new Error(res?.error || 'Failed to connect via background service worker'))
          }
          sessionId = res.data?.sessionId
          authenticated = true
          resolve()
        }
      )
    })
  }

  sessionId = await startSession()
  await openSocket()
  await authenticate()
}

const ensureConnected = async () => {
  if (hasBgProxy()) {
    return connect({ baseUrl, apiKey })
  }
  if (socket && socket.readyState === WebSocket.OPEN && authenticated) {
    return
  }
  if (apiKey) {
    await connect({ baseUrl, apiKey })
  }
}

const sendCommand = async ({ url, domMap, command }) => {
    if (hasBgProxy()) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'ATLAS_SOCKET_SEND',
                    payload: { url, dom_map: domMap, command, type: 'command' },
                },
                (res) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message))
                    }
                    if (!res || !res.ok) {
                        return reject(new Error(res?.error || 'Command failed'))
                    }
                    resolve(res.data)
                }
            )
        })
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated) {
        try {
            await ensureConnected()
        } catch (err) {
            console.error('Atlas: ensureConnected failed in sendCommand:', err)
            throw new Error(`Failed to connect to backend: ${err.message}`)
        }
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`Socket is not connected. Please check that backend is running at ${baseUrl}`))
    }
    if (!authenticated) {
        return Promise.reject(new Error('Not authenticated. Please check your Atlas API key.'))
    }

    return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject })
        socket.send(
            JSON.stringify({
                session_id: sessionId,
                url,
                dom_map: domMap,
                command,
                type: 'command',
            })
        )
    })
}

// Simplify pipeline (Contract 5) — same connection, same one-at-a-time
// request/response queue as sendCommand, just a different `type` and an
// empty `command`.
const sendSimplify = async ({ url, domMap }) => {
  if (hasBgProxy()) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'ATLAS_SOCKET_SEND',
          payload: { url, dom_map: domMap, command: '', type: 'simplify' },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message))
          }
          if (!res || !res.ok) {
            return reject(new Error(res?.error || 'Simplify failed'))
          }
          resolve(res.data)
        }
      )
    })
  }

  if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated) {
    try {
      await ensureConnected()
    } catch (err) {
      console.error('Atlas: ensureConnected failed in sendSimplify:', err)
      throw new Error(`Failed to connect to backend: ${err.message}`)
    }
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Socket is not connected. Please check that backend is running at ${baseUrl}`))
  }
  if (!authenticated) {
    return Promise.reject(new Error('Not authenticated. Please check your Atlas API key.'))
  }

  return new Promise((resolve, reject) => {
    pendingQueue.push({ resolve, reject })
    socket.send(
      JSON.stringify({
        session_id: sessionId,
        url,
        dom_map: domMap,
        command: '',
        type: 'simplify',
      })
    )
  })
}

const onDisconnect = (fn) => {
  disconnectHandlers.push(fn)
}

const close = () => {
  disconnectHandlers = []
  authenticated = false
  if (socket) socket.close()
  socket = null
}

window.AtlasSocket = { connect, sendCommand, sendSimplify, onDisconnect, close }
})();

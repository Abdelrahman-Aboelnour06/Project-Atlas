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

const wsUrl = () => `${baseUrl.replace(/^http/, 'ws')}/v1/agent`

const startSession = async () => {
  const res = await fetch(`${baseUrl}/v1/session/start`, {
    method: 'POST',
    headers: { 'X-Atlas-Key': apiKey },
  })
  if (!res.ok) {
    throw new Error(`session/start failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.session_id
}

const openSocket = () =>
  new Promise((resolve, reject) => {
    socket = new WebSocket(wsUrl())

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
      reject(err)
    }

    socket.onclose = () => {
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
    openSocket().catch(() => {
      /* onclose will retry again up to the cap */
    })
  }, RECONNECT_DELAY_MS)
}

const connect = async ({ baseUrl: base, apiKey: key } = {}) => {
  if (base) baseUrl = base
  if (key) apiKey = key
  if (!apiKey) throw new Error('AtlasSocket.connect requires an apiKey')

  sessionId = await startSession()
  await openSocket()
}

const sendCommand = ({ url, domMap, command }) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('Socket is not connected'))
    }

    return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject })
        socket.send(
            JSON.stringify({
                session_id: sessionId,
                api_key: apiKey,
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
const sendSimplify = ({ url, domMap }) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Socket is not connected'))
  }

  return new Promise((resolve, reject) => {
    pendingQueue.push({ resolve, reject })
    socket.send(
      JSON.stringify({
        session_id: sessionId,
        api_key: apiKey,
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
  if (socket) socket.close()
  socket = null
}

window.AtlasSocket = { connect, sendCommand, sendSimplify, onDisconnect, close }

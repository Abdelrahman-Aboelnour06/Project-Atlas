// content.js
// Orchestrator only — wires the other modules together. Owns no DOM
// reading/writing logic itself (that stays in dom-serializer.js /
// executor.js per docs/conventions.md module boundaries).

const API_KEY_STORAGE_KEY = 'atlasApiKey'
const BASE_URL_STORAGE_KEY = 'atlasBaseUrl'
const DEFAULT_BASE_URL = 'http://localhost:8000'

let active = false
let stopObserving = null

const getStoredSettings = () =>
  new Promise((resolve) => {
    chrome.storage.local.get(
      [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
      (result) => {
        resolve({
          apiKey: result[API_KEY_STORAGE_KEY] || null,
          baseUrl: result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL,
        })
      }
    )
  })

// First-run / missing-key flow now hands off to the extension's options
// page (options.html) instead of a raw window.prompt(). This keeps key
// entry, visibility toggling, and backend-URL overrides in one real UI
// that persists across sessions, rather than a one-shot native dialog.
const sendToOptionsPage = () => {
  window.AtlasSidebar.setStatus(
    'No API key saved yet. Opening Atlas settings — enter your key there, then click the toolbar icon again.',
    'error'
  )
  chrome.runtime.sendMessage({ type: 'ATLAS_OPEN_OPTIONS' })
}

// Prefers the backend's simplify pipeline (Contract 5) for plain-language
// labels; falls back to the local heuristic in sidebar.js if the call
// fails or comes back empty (e.g. LLM timeout) so the sidebar never goes
// blank just because simplify had a bad moment.
const renderSimplified = async (domMap) => {
  if (domMap.length === 0) {
    window.AtlasSidebar.renderElements([])
    return
  }

  try {
    const response = await window.AtlasSocket.sendSimplify({
      url: window.location.href,
      domMap,
    })
    if (response.status === 'success' && response.elements?.length) {
      const items = response.elements.map((el) => ({
        id: el.element_id,
        label: el.label,
        category: el.category,
      }))
      window.AtlasSidebar.renderElements(items)
      return
    }
  } catch (err) {
    // fall through to the local heuristic below
  }

  window.AtlasSidebar.renderElements(window.AtlasSidebar.deriveDisplayItems(domMap))
}

const runCommand = async (command) => {
  window.AtlasSidebar.setStatus('Thinking...', 'info')
  try {
    const domMap = window.AtlasSerializer.serialize()
    const response = await window.AtlasSocket.sendCommand({
      url: window.location.href,
      domMap,
      command,
    })
    const result = window.AtlasExecutor.execute(response)
    window.AtlasSidebar.setStatus(result.message, result.ok ? 'ok' : 'error')
  } catch (err) {
    window.AtlasSidebar.setStatus(
      `Connection issue: ${err.message}`,
      'error'
    )
  }
}

// Sidebar item click = direct action, no LLM round-trip needed since we
// already know exactly which element the user wants.
const handleElementClick = (atlasId) => {
  const result = window.AtlasExecutor.execute({
    status: 'ok',
    action: 'click',
    element_id: atlasId,
    value: null,
    message: 'Done.',
  })
  window.AtlasSidebar.setStatus(result.message, result.ok ? 'ok' : 'error')
}

const handleMicClick = () => {
  if (!window.AtlasSpeech.isSupported()) {
    window.AtlasSidebar.setStatus(
      'Voice input is not supported in this browser.',
      'error'
    )
    return
  }
  window.AtlasSidebar.setListening(true)
  window.AtlasSpeech.start({
    onResult: (transcript) => {
      window.AtlasSidebar.setStatus(`Heard: "${transcript}"`, 'info')
      runCommand(transcript)
    },
    onEnd: () => window.AtlasSidebar.setListening(false),
    onError: (err) => {
      window.AtlasSidebar.setListening(false)
      window.AtlasSidebar.setStatus(err.message, 'error')
    },
  })
}

const activate = async () => {
  if (active) return

  const { apiKey, baseUrl } = await getStoredSettings()

  window.AtlasSidebar.mount({
    onClose: deactivate,
    onElementClick: handleElementClick,
    onCommandSubmit: runCommand,
    onMicClick: handleMicClick,
  })

  if (!apiKey) {
    sendToOptionsPage()
    return
  }

  window.AtlasSidebar.setStatus('Connecting...', 'info')

  try {
    await window.AtlasSocket.connect({ baseUrl, apiKey })
    window.AtlasSocket.onDisconnect(() => {
      window.AtlasSidebar.setStatus('Disconnected — reconnecting...', 'error')
    })

    const domMap = window.AtlasSerializer.serialize()
    // Show the raw fallback immediately (instant, no round-trip), then
    // swap in the simplify pipeline's plain-language labels once they
    // arrive — avoids a blank sidebar while the LLM call is in flight.
    window.AtlasSidebar.renderElements(window.AtlasSidebar.deriveDisplayItems(domMap))
    window.AtlasSidebar.setStatus('Ready.', 'ok')
    renderSimplified(domMap)

    stopObserving = window.AtlasSerializer.observe((updatedMap) => {
      window.AtlasSidebar.renderElements(window.AtlasSidebar.deriveDisplayItems(updatedMap))
      renderSimplified(updatedMap)
    })

    active = true
  } catch (err) {
    window.AtlasSidebar.setStatus(`Couldn't connect: ${err.message}`, 'error')
  }
}

const deactivate = () => {
  if (!active) {
    window.AtlasSidebar.unmount()
    return
  }
  stopObserving?.()
  stopObserving = null
  window.AtlasSocket.close()
  window.AtlasSidebar.unmount()
  active = false
}

const toggle = () => (active ? deactivate() : activate())

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ATLAS_TOGGLE') toggle()
})

// content.js
// Orchestrator only — wires the other modules together. Owns no DOM
// reading/writing logic itself (that stays in dom-serializer.js /
// executor.js per docs/conventions.md module boundaries).

const STORAGE_KEY = 'atlasApiKey'
const DEFAULT_BASE_URL = 'http://localhost:8000'

let active = false
let stopObserving = null

const getApiKey = () =>
  new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || null)
    })
  })

const promptForApiKey = async () => {
  // Simple first-run flow — replace with the dashboard's copy-key button
  // once Task E ships.
  const key = window.prompt('Enter your Atlas API key (atlas_...):')
  if (key) {
    await new Promise((resolve) =>
      chrome.storage.local.set({ [STORAGE_KEY]: key }, resolve)
    )
  }
  return key
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

  let apiKey = await getApiKey()
  if (!apiKey) apiKey = await promptForApiKey()
  if (!apiKey) return // user cancelled

  window.AtlasSidebar.mount({
    onClose: deactivate,
    onElementClick: handleElementClick,
    onCommandSubmit: runCommand,
    onMicClick: handleMicClick,
  })
  window.AtlasSidebar.setStatus('Connecting...', 'info')

  try {
    await window.AtlasSocket.connect({ baseUrl: DEFAULT_BASE_URL, apiKey })
    window.AtlasSocket.onDisconnect(() => {
      window.AtlasSidebar.setStatus('Disconnected — reconnecting...', 'error')
    })

    const domMap = window.AtlasSerializer.serialize()
    window.AtlasSidebar.renderElements(domMap)
    window.AtlasSidebar.setStatus('Ready.', 'ok')

    stopObserving = window.AtlasSerializer.observe((updatedMap) => {
      window.AtlasSidebar.renderElements(updatedMap)
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

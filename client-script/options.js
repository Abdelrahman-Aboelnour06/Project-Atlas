// options.js
// Standalone settings page — no DOM-serializer/executor concerns here,
// this never runs inside a host page. Reads/writes the same
// chrome.storage.local keys content.js consumes.

const API_KEY_STORAGE_KEY = 'atlasApiKey'
const BASE_URL_STORAGE_KEY = 'atlasBaseUrl'
const DEFAULT_BASE_URL = 'http://localhost:8000'

const form = document.getElementById('atlas-options-form')
const apiKeyInput = document.getElementById('api-key')
const baseUrlInput = document.getElementById('base-url')
const toggleBtn = document.getElementById('toggle-visibility')
const clearBtn = document.getElementById('clear-btn')
const statusEl = document.getElementById('atlas-status')

const setStatus = (text, kind = 'info') => {
  statusEl.textContent = text
  statusEl.dataset.kind = kind
}

const load = () => {
  chrome.storage.local.get(
    [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
    (result) => {
      if (result[API_KEY_STORAGE_KEY]) {
        apiKeyInput.value = result[API_KEY_STORAGE_KEY]
      }
      baseUrlInput.value = result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL
    }
  )
}

const isPlausibleKey = (value) => value.trim().startsWith('atlas_')

form.addEventListener('submit', (e) => {
  e.preventDefault()

  const key = apiKeyInput.value.trim()
  const baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL

  if (key && !isPlausibleKey(key)) {
    setStatus("That doesn't look like an Atlas key — it should start with \"atlas_\".", 'error')
    return
  }

  chrome.storage.local.set(
    { [API_KEY_STORAGE_KEY]: key, [BASE_URL_STORAGE_KEY]: baseUrl },
    () => {
      setStatus('Saved. Reload any open tabs to pick up the change.', 'ok')
    }
  )
})

clearBtn.addEventListener('click', () => {
  chrome.storage.local.remove([API_KEY_STORAGE_KEY], () => {
    apiKeyInput.value = ''
    setStatus('API key cleared. You will be prompted again on next activation.', 'ok')
  })
})

toggleBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password'
  apiKeyInput.type = isPassword ? 'text' : 'password'
  toggleBtn.textContent = isPassword ? 'Hide' : 'Show'
  toggleBtn.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key')
})

load()

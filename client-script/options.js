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

// Saved Secrets UI Elements
const secretsContainer = document.getElementById('secrets-container')
const clearAllSecretsBtn = document.getElementById('clear-all-secrets-btn')
const secretsStatusEl = document.getElementById('secrets-status')

const setSecretsStatus = (text, kind = 'info') => {
  if (!secretsStatusEl) return
  secretsStatusEl.textContent = text
  secretsStatusEl.dataset.kind = kind
}

const getVault = () => {
  if (typeof window !== 'undefined' && window.AtlasSecretVault) {
    return window.AtlasSecretVault
  }
  if (typeof AtlasSecretVault !== 'undefined') {
    return AtlasSecretVault
  }
  return null
}

const renderSecrets = async () => {
  if (!secretsContainer) return
  secretsContainer.textContent = ''

  const vault = getVault()
  if (!vault) {
    const p = document.createElement('p')
    p.className = 'atlas-empty-secrets'
    p.textContent = 'Secret vault unavailable.'
    secretsContainer.appendChild(p)
    return
  }

  // listEntries returns metadata only: origin, token, category, createdAt. NEVER decrypts.
  const entries = await vault.listEntries()
  if (!entries || entries.length === 0) {
    const p = document.createElement('p')
    p.className = 'atlas-empty-secrets'
    p.textContent = 'No saved secrets found.'
    secretsContainer.appendChild(p)
    if (clearAllSecretsBtn) clearAllSecretsBtn.style.display = 'none'
    return
  }

  if (clearAllSecretsBtn) clearAllSecretsBtn.style.display = 'inline-block'

  // Group entries by origin
  const byOrigin = new Map()
  for (const item of entries) {
    const orig = item.origin || 'unknown'
    if (!byOrigin.has(orig)) byOrigin.set(orig, [])
    byOrigin.get(orig).push(item)
  }

  for (const [origin, items] of byOrigin.entries()) {
    const group = document.createElement('div')
    group.className = 'atlas-origin-group'

    const header = document.createElement('div')
    header.className = 'atlas-origin-header'

    const title = document.createElement('span')
    title.className = 'atlas-origin-title'
    title.textContent = origin

    const clearOriginBtn = document.createElement('button')
    clearOriginBtn.type = 'button'
    clearOriginBtn.className = 'atlas-item-delete-btn'
    clearOriginBtn.textContent = 'Clear site'
    clearOriginBtn.setAttribute('aria-label', `Clear all secrets for ${origin}`)
    clearOriginBtn.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to clear all saved secrets for ${origin}?`)) {
        return
      }
      await vault.clearOrigin(origin)
      setSecretsStatus(`Cleared all secrets for ${origin}.`, 'ok')
      await renderSecrets()
    })

    header.appendChild(title)
    header.appendChild(clearOriginBtn)
    group.appendChild(header)

    const list = document.createElement('ul')
    list.className = 'atlas-origin-items'

    for (const item of items) {
      const li = document.createElement('li')
      li.className = 'atlas-secret-row'

      const meta = document.createElement('div')
      meta.className = 'atlas-secret-meta'

      const tokenBadge = document.createElement('span')
      tokenBadge.className = 'atlas-badge'
      tokenBadge.textContent = item.token

      const categoryBadge = document.createElement('span')
      categoryBadge.className = 'atlas-category-badge'
      categoryBadge.textContent = item.category

      const dateSpan = document.createElement('span')
      dateSpan.className = 'atlas-date'
      if (item.createdAt) {
        try {
          dateSpan.textContent = new Date(item.createdAt).toLocaleDateString()
        } catch (_) {
          dateSpan.textContent = item.createdAt
        }
      }

      meta.appendChild(tokenBadge)
      meta.appendChild(categoryBadge)
      if (item.createdAt) meta.appendChild(dateSpan)

      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'atlas-item-delete-btn'
      deleteBtn.textContent = 'Delete'
      deleteBtn.setAttribute('aria-label', `Delete ${item.token} for ${origin}`)
      deleteBtn.addEventListener('click', async () => {
        await vault.deleteEntry(origin, item.token)
        setSecretsStatus(`Deleted ${item.token}.`, 'ok')
        await renderSecrets()
      })

      li.appendChild(meta)
      li.appendChild(deleteBtn)
      list.appendChild(li)
    }

    group.appendChild(list)
    secretsContainer.appendChild(group)
  }
}

if (clearAllSecretsBtn) {
  clearAllSecretsBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL saved secrets across ALL sites? This action cannot be undone.')) {
      return
    }
    const vault = getVault()
    if (vault) {
      await vault.clearAll()
      setSecretsStatus('All saved secrets have been cleared.', 'ok')
      await renderSecrets()
    }
  })
}

const load = () => {
  chrome.storage.local.get(
    [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
    (result) => {
      apiKeyInput.value = result[API_KEY_STORAGE_KEY] || ''
      baseUrlInput.value = result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL
    }
  )
  renderSecrets()
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
  if (!confirm('Are you sure you want to clear your stored Atlas API key?')) {
    return
  }
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    load,
    renderSecrets,
    getVault,
  }
}

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

const PROFILE_FIELDS = [
  'given_name',
  'family_name',
  'full_name',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'date_of_birth',
]

const profileForm = document.getElementById('atlas-profile-form')
const clearProfileBtn = document.getElementById('clear-profile-btn')
const profileStatusEl = document.getElementById('profile-status')

const setProfileStatus = (text, kind = 'info') => {
  if (!profileStatusEl) return
  profileStatusEl.textContent = text
  profileStatusEl.dataset.kind = kind
}

const renderProfile = async () => {
  if (!profileForm) return
  const vault = getVault()
  if (!vault || !vault.getProfile) return
  try {
    const profile = await vault.getProfile()
    for (const field of PROFILE_FIELDS) {
      const input = profileForm.elements[field]
      if (input && profile[field] !== undefined) {
        input.value = profile[field]
      }
    }
  } catch (err) {
    console.error('Failed to load profile:', err)
  }
}

if (profileForm) {
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const vault = getVault()
    if (!vault || !vault.saveProfileField) {
      setProfileStatus('Vault unavailable.', 'error')
      return
    }
    for (const field of PROFILE_FIELDS) {
      const input = profileForm.elements[field]
      if (input) {
        const val = input.value.trim()
        if (val) {
          await vault.saveProfileField(field, val)
        }
      }
    }
    setProfileStatus('Profile saved securely.', 'ok')
  })
}

if (clearProfileBtn) {
  clearProfileBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear your saved profile data?')) {
      return
    }
    const vault = getVault()
    if (vault && vault.clearProfile) {
      await vault.clearProfile()
      if (profileForm) {
        for (const field of PROFILE_FIELDS) {
          const input = profileForm.elements[field]
          if (input) input.value = ''
        }
      }
      setProfileStatus('Profile cleared.', 'ok')
    }
  })
}

const load = () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      [API_KEY_STORAGE_KEY, BASE_URL_STORAGE_KEY],
      (result) => {
        if (apiKeyInput) apiKeyInput.value = result[API_KEY_STORAGE_KEY] || ''
        if (baseUrlInput) baseUrlInput.value = result[BASE_URL_STORAGE_KEY] || DEFAULT_BASE_URL
      }
    )
  }
  renderSecrets()
  renderProfile()
  initWizard()
}

const isPlausibleKey = (value) => value.trim().startsWith('atlas_')

// ── Track U6: First-Run Setup Wizard Controller ──────────────────────────────
const initWizard = () => {
  const wizardContainer = document.getElementById('atlas-wizard-container')
  const standardSettings = document.getElementById('atlas-standard-settings')
  const launchWizardBtn = document.getElementById('launch-wizard-btn')

  if (!wizardContainer) return

  const step1Pane = document.getElementById('wizard-step-1')
  const step2Pane = document.getElementById('wizard-step-2')
  const step3Pane = document.getElementById('wizard-step-3')
  const completePane = document.getElementById('wizard-complete-view')

  const stepInd1 = document.getElementById('step-ind-1')
  const stepInd2 = document.getElementById('step-ind-2')
  const stepInd3 = document.getElementById('step-ind-3')

  const wizardBaseUrl = document.getElementById('wizard-base-url')
  const testBackendBtn = document.getElementById('wizard-test-backend-btn')
  const backendStatus = document.getElementById('wizard-backend-status')
  const step1NextBtn = document.getElementById('wizard-step1-next')
  const skipBtn = document.getElementById('wizard-skip-btn')

  const wizardApiKey = document.getElementById('wizard-api-key')
  const toggleKeyBtn = document.getElementById('wizard-toggle-key')
  const validateKeyBtn = document.getElementById('wizard-validate-key-btn')
  const keyStatus = document.getElementById('wizard-key-status')
  const step2PrevBtn = document.getElementById('wizard-step2-prev')
  const step2NextBtn = document.getElementById('wizard-step2-next')

  const ttsStatus = document.getElementById('wizard-tts-status')
  const step3PrevBtn = document.getElementById('wizard-step3-prev')
  const completeBtn = document.getElementById('wizard-complete-btn')

  const summaryBox = document.getElementById('wizard-summary-box')
  const finishBtn = document.getElementById('wizard-finish-btn')

  let verifiedUrl = DEFAULT_BASE_URL
  let verifiedKey = ''
  let selectedLang = 'en-US'

  const showWizard = (show) => {
    if (!wizardContainer) return
    if (show) {
      wizardContainer.style.display = 'block'
      if (standardSettings) standardSettings.style.display = 'none'
      goToStep(1)
    } else {
      wizardContainer.style.display = 'none'
      if (standardSettings) standardSettings.style.display = 'block'
    }
  }

  const goToStep = (step) => {
    const panes = [step1Pane, step2Pane, step3Pane, completePane]
    panes.forEach((p) => {
      if (p) p.style.display = 'none'
    })

    const inds = [stepInd1, stepInd2, stepInd3]
    inds.forEach((ind, i) => {
      if (!ind) return
      ind.classList.remove('atlas-step-active', 'atlas-step-complete')
      if (i + 1 < step) {
        ind.classList.add('atlas-step-complete')
      } else if (i + 1 === step) {
        ind.classList.add('atlas-step-active')
      }
    })

    if (step === 1 && step1Pane) step1Pane.style.display = 'block'
    if (step === 2 && step2Pane) step2Pane.style.display = 'block'
    if (step === 3 && step3Pane) {
      step3Pane.style.display = 'block'
      updateTtsDiagnostic()
    }
    if (step === 4 && completePane) completePane.style.display = 'block'
  }

  const updateTtsDiagnostic = () => {
    if (!ttsStatus) return
    ttsStatus.className = 'atlas-status-box atlas-status-info active'
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices()
      const hasArabic = voices.some((v) => v.lang && v.lang.startsWith('ar'))
      if (hasArabic) {
        ttsStatus.textContent = '✓ Voice synthesis ready: Arabic and English system voices detected.'
        ttsStatus.className = 'atlas-status-box atlas-status-ok active'
      } else {
        ttsStatus.textContent = 'ℹ Standard system voice detected. (Arabic voices will use system default or cloud synthesis fallback).'
      }
    } else {
      ttsStatus.textContent = 'ℹ Standard system voice synthesis configured.'
    }
  }

  // Step 1: Health check
  if (testBackendBtn) {
    testBackendBtn.addEventListener('click', async () => {
      const url = (wizardBaseUrl ? wizardBaseUrl.value.trim() : '') || DEFAULT_BASE_URL
      if (backendStatus) {
        backendStatus.className = 'atlas-status-box atlas-status-info active'
        backendStatus.textContent = `Probing ${url}/health...`
      }
      try {
        const res = await fetch(`${url}/health`, { method: 'GET' })
        if (res.ok) {
          const data = await res.json()
          verifiedUrl = url
          if (backendStatus) {
            backendStatus.className = 'atlas-status-box atlas-status-ok active'
            const db = data.db ? data.db.toUpperCase() : 'OK'
            const llm = data.llm ? data.llm.toUpperCase() : 'OK'
            backendStatus.textContent = `✓ Connected: Backend v${data.version || '0.1.0'} (Database: ${db}, AI Planner: ${llm})`
          }
          if (step1NextBtn) step1NextBtn.disabled = false
        } else {
          if (backendStatus) {
            backendStatus.className = 'atlas-status-box atlas-status-warn active'
            backendStatus.textContent = `⚠ Degraded: Backend returned HTTP ${res.status}. Ensure backend services are running.`
          }
          if (step1NextBtn) step1NextBtn.disabled = true
        }
      } catch (err) {
        if (backendStatus) {
          backendStatus.className = 'atlas-status-box atlas-status-error active'
          backendStatus.textContent = `✗ Unreachable: Could not connect to backend at ${url}. Ensure backend server is running.`
        }
        if (step1NextBtn) step1NextBtn.disabled = true
      }
    })
  }

  if (step1NextBtn) {
    step1NextBtn.addEventListener('click', () => {
      goToStep(2)
    })
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      showWizard(false)
    })
  }

  // Step 2: Key validation
  if (toggleKeyBtn && wizardApiKey) {
    toggleKeyBtn.addEventListener('click', () => {
      const isPass = wizardApiKey.type === 'password'
      wizardApiKey.type = isPass ? 'text' : 'password'
      toggleKeyBtn.textContent = isPass ? 'Hide' : 'Show'
    })
  }

  if (validateKeyBtn) {
    validateKeyBtn.addEventListener('click', async () => {
      const key = wizardApiKey ? wizardApiKey.value.trim() : ''
      if (!key || !key.startsWith('atlas_') || key.length < 10) {
        if (keyStatus) {
          keyStatus.className = 'atlas-status-box atlas-status-error active'
          keyStatus.textContent = "Invalid key format: Atlas API key must begin with 'atlas_' and be at least 10 characters."
        }
        if (step2NextBtn) step2NextBtn.disabled = true
        return
      }

      if (keyStatus) {
        keyStatus.className = 'atlas-status-box atlas-status-info active'
        keyStatus.textContent = 'Validating key with backend authentication...'
      }

      try {
        const res = await fetch(`${verifiedUrl}/v1/session/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Atlas-Key': key,
          },
          body: JSON.stringify({}),
        })

        if (res.status === 200) {
          verifiedKey = key
          if (keyStatus) {
            keyStatus.className = 'atlas-status-box atlas-status-ok active'
            keyStatus.textContent = '✓ Valid API key: Tenant authenticated successfully.'
          }
          if (step2NextBtn) step2NextBtn.disabled = false
        } else if (res.status === 401) {
          if (keyStatus) {
            keyStatus.className = 'atlas-status-box atlas-status-error active'
            keyStatus.textContent = '✗ Invalid API key: Key was rejected by backend authentication (HTTP 401).'
          }
          if (step2NextBtn) step2NextBtn.disabled = true
        } else {
          if (keyStatus) {
            keyStatus.className = 'atlas-status-box atlas-status-warn active'
            keyStatus.textContent = `⚠ Authentication warning: Endpoint returned HTTP ${res.status}.`
          }
          if (step2NextBtn) step2NextBtn.disabled = true
        }
      } catch (err) {
        if (keyStatus) {
          keyStatus.className = 'atlas-status-box atlas-status-error active'
          keyStatus.textContent = `✗ Network error: Could not reach session endpoint at ${verifiedUrl}.`
        }
        if (step2NextBtn) step2NextBtn.disabled = true
      }
    })
  }

  if (step2PrevBtn) {
    step2PrevBtn.addEventListener('click', () => {
      goToStep(1)
    })
  }

  if (step2NextBtn) {
    step2NextBtn.addEventListener('click', () => {
      goToStep(3)
    })
  }

  // Step 3: Complete & save
  if (step3PrevBtn) {
    step3PrevBtn.addEventListener('click', () => {
      goToStep(2)
    })
  }

  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      const selectedRadio = document.querySelector('input[name="wizard-lang"]:checked')
      if (selectedRadio) {
        selectedLang = selectedRadio.value
      }

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(
          {
            [API_KEY_STORAGE_KEY]: verifiedKey,
            [BASE_URL_STORAGE_KEY]: verifiedUrl,
            atlas_voice_lang: selectedLang,
            atlas_wizard_completed: true,
          },
          () => {
            if (apiKeyInput) apiKeyInput.value = verifiedKey
            if (baseUrlInput) baseUrlInput.value = verifiedUrl
            if (summaryBox) {
              summaryBox.innerHTML = `
                <div><strong>Backend:</strong> ${verifiedUrl}</div>
                <div><strong>API Key:</strong> ${verifiedKey ? verifiedKey.slice(0, 8) + '••••' : '(not set)'}</div>
                <div><strong>Language:</strong> ${selectedLang === 'ar-EG' ? 'Arabic (ar-EG)' : 'English (en-US)'}</div>
              `
            }
            goToStep(4)
          }
        );
      } else {
        goToStep(4)
      }
    })
  }

  if (finishBtn) {
    finishBtn.addEventListener('click', () => {
      showWizard(false)
    })
  }

  if (launchWizardBtn) {
    launchWizardBtn.addEventListener('click', () => {
      showWizard(true)
    })
  }

  // Check URL query param ?wizard=true
  try {
    const urlParams = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : null
    if (urlParams && urlParams.get('wizard') === 'true') {
      showWizard(true)
      return
    }
  } catch (_) {}

  // Check if first-run
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([API_KEY_STORAGE_KEY, 'atlas_wizard_completed'], (res) => {
      if (!res?.[API_KEY_STORAGE_KEY] && !res?.atlas_wizard_completed) {
        showWizard(true)
      }
    })
  }
}

if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault()

    const key = apiKeyInput ? apiKeyInput.value.trim() : ''
    const baseUrl = (baseUrlInput && baseUrlInput.value.trim()) || DEFAULT_BASE_URL

    if (key && !isPlausibleKey(key)) {
      setStatus("That doesn't look like an Atlas key — it should start with \"atlas_\".", 'error')
      return
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(
        { [API_KEY_STORAGE_KEY]: key, [BASE_URL_STORAGE_KEY]: baseUrl },
        () => {
          setStatus('Saved. Reload any open tabs to pick up the change.', 'ok')
        }
      )
    }
  })
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear your stored Atlas API key?')) {
      return
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([API_KEY_STORAGE_KEY], () => {
        if (apiKeyInput) apiKeyInput.value = ''
        setStatus('API key cleared. You will be prompted again on next activation.', 'ok')
      })
    }
  })
}

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    if (!apiKeyInput) return
    const isPassword = apiKeyInput.type === 'password'
    apiKeyInput.type = isPassword ? 'text' : 'password'
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show'
    toggleBtn.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key')
  })
}

const restartTourBtn = typeof document !== 'undefined' ? document.getElementById('restart-tour-btn') : null
const tourRestartStatus = typeof document !== 'undefined' ? document.getElementById('tour-restart-status') : null

if (restartTourBtn) {
  restartTourBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ atlas_tour_completed: false }, () => {
        if (tourRestartStatus) {
          tourRestartStatus.className = 'atlas-status-box atlas-status-ok active'
          tourRestartStatus.textContent = '✓ Guided tour reset! It will appear the next time you open the Atlas sidebar.'
        }
      })
    }
  })
}

load()

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    load,
    renderSecrets,
    renderProfile,
    getVault,
    initWizard,
    restartTourBtn,
  }
}


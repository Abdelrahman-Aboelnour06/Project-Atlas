'use client'

import React, { useState, useEffect } from 'react'

interface TenantSummary {
  tenant_id: string
  company_name: string
  email: string
  active_sessions: number
  total_goals: number
  success_rate: number
  average_hop_latency_ms: number
  accessibility_issues_flagged: number
}

interface TenantPrivacySettingsProps {
  apiKey?: string
  apiBaseUrl?: string
}

export default function TenantPrivacySettings({
  apiKey = 'atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  apiBaseUrl = 'http://localhost:8000',
}: TenantPrivacySettingsProps) {
  const [summary, setSummary] = useState<TenantSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Erasure modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Load summary on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        setLoading(true)
        const res = await fetch(`${apiBaseUrl}/v1/tenant/summary`, {
          headers: { 'x-atlas-key': apiKey },
        })
        if (res.ok) {
          const data = await res.json()
          setSummary(data)
        }
      } catch (err) {
        console.warn('Backend unavailable, using default metrics view', err)
      } finally {
        setLoading(false)
      }
    }
    fetchSummary()
  }, [apiKey, apiBaseUrl])

  // Handle GDPR JSON Export
  const handleExportData = async () => {
    try {
      setExporting(true)
      setStatusMessage(null)
      setErrorMessage(null)

      const res = await fetch(`${apiBaseUrl}/v1/tenant/export`, {
        headers: { 'x-atlas-key': apiKey },
      })

      if (!res.ok) {
        throw new Error(`Export failed with HTTP ${res.status}`)
      }

      const exportData = await res.json()
      const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      })
      const downloadUrl = URL.createObjectURL(jsonBlob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `atlas-tenant-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)

      setStatusMessage('Tenant data export successfully generated and downloaded.')
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to export tenant data.')
    } finally {
      setExporting(false)
    }
  }

  // Handle GDPR Data Erasure
  const handleDeleteData = async () => {
    if (confirmInput.trim() !== 'CONFIRM_DELETE') {
      return
    }

    try {
      setDeleting(true)
      setStatusMessage(null)
      setErrorMessage(null)

      const res = await fetch(`${apiBaseUrl}/v1/tenant/data?confirm_token=CONFIRM_DELETE`, {
        method: 'DELETE',
        headers: { 'x-atlas-key': apiKey },
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || `Erasure failed with status ${res.status}`)
      }

      const result = await res.json()
      setStatusMessage(
        `GDPR Erasure complete: Successfully erased ${result.records_deleted?.usage_logs || 0} usage records and ${result.records_deleted?.error_logs || 0} error logs.`
      )
      setIsModalOpen(false)
      setConfirmInput('')

      // Refresh summary
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              active_sessions: 0,
              total_goals: 0,
              accessibility_issues_flagged: 0,
            }
          : null
      )
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to erase tenant data.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="privacy-heading">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 id="privacy-heading" className="font-display font-bold text-xl text-ink">
            Privacy & GDPR Controls
          </h2>
          <p className="text-muted text-sm mt-1">
            Manage your organization data retention, portability exports, and GDPR erasure rights.
          </p>
        </div>
        {loading && <p className="text-xs text-muted">Refreshing tenant status...</p>}
      </div>

      {/* Status & Error Alerts */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-card border border-ok/30 bg-ok/10 text-ok px-4 py-3 text-sm font-medium"
        >
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-card border border-danger/30 bg-danger/10 text-danger px-4 py-3 text-sm font-medium"
        >
          {errorMessage}
        </div>
      )}

      {/* Control Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Export Card */}
        <div className="rounded-card border border-line bg-panel p-5 flex flex-col justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-base text-ink mb-1">
              Data Portability (GDPR Art. 20)
            </h3>
            <p className="text-sm text-muted">
              Download a machine-readable JSON archive containing all stored session logs,
              automated goal actions, and flagged accessibility diagnostics.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportData}
            disabled={exporting}
            className="self-start min-h-[44px] px-4 py-2.5 bg-compass text-white font-bold text-sm rounded-md hover:bg-compass-deep disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {exporting ? 'Generating Export...' : 'Export Tenant Data (JSON)'}
          </button>
        </div>

        {/* Danger Zone / Erasure Card */}
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5 flex flex-col justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-base text-danger mb-1">
              Right to Erasure (GDPR Art. 17)
            </h3>
            <p className="text-sm text-muted">
              Permanently purge all stored goal execution logs, user session IDs, and audit records.
              This operation is irreversible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfirmInput('')
              setIsModalOpen(true)
            }}
            className="self-start min-h-[44px] px-4 py-2.5 border border-danger text-danger font-bold text-sm rounded-md hover:bg-danger/10 transition-colors"
          >
            Delete All Tenant Data
          </button>
        </div>
      </div>

      {/* Accessible Confirmation Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-panel p-6 shadow-xl flex flex-col gap-4">
            <h3 id="modal-title" className="font-display font-bold text-lg text-danger">
              Confirm Irreversible Data Erasure
            </h3>
            <p className="text-sm text-muted">
              This action will permanently delete all stored usage logs, session histories, and
              accessibility error records for your tenant.
            </p>
            <div>
              <label htmlFor="confirm-token-input" className="block text-sm font-bold text-ink mb-2">
                Type <span className="font-mono text-danger font-bold">CONFIRM_DELETE</span> to proceed:
              </label>
              <input
                id="confirm-token-input"
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="CONFIRM_DELETE"
                className="w-full min-h-[44px] border border-line rounded-md px-3 py-2 text-sm font-mono"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold border border-line rounded-md hover:bg-line/20 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteData}
                disabled={deleting || confirmInput.trim() !== 'CONFIRM_DELETE'}
                className="min-h-[44px] px-4 py-2 text-sm font-bold bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Erasing Data...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

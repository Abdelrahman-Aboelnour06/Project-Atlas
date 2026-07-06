'use client'

import { useState } from 'react'
import type { ApiKey } from '@/lib/mock-data'

export default function ApiKeyCard({ apiKey }: { apiKey: ApiKey }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey.keyPrefix)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-card border border-line bg-panel p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-muted mb-1">API key</p>
        <code className="font-mono text-sm text-ink">{apiKey.keyPrefix}…</code>
        <p className="text-xs text-muted mt-1">
          Created {new Date(apiKey.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={`text-xs font-bold px-2 py-1 rounded-full ${
            apiKey.isActive
              ? 'bg-ok/10 text-ok'
              : 'bg-danger/10 text-danger'
          }`}
        >
          {apiKey.isActive ? 'Active' : 'Revoked'}
        </span>
        <button
          onClick={handleCopy}
          className="text-sm font-bold text-compass border border-compass rounded-md px-3 py-1.5 hover:bg-compass-dim transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Mock auth only — no real backend call yet. Task board item 6
    // ("Dashboard shows tenant API keys and mock sessions") only requires
    // the shell; wire this to a real /v1/tenant/login once it exists.
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="12.5" fill="#101828" />
            <circle cx="14" cy="14" r="12.5" fill="none" stroke="#2F5DE3" strokeWidth="1.2" />
            <path d="M14 5 L10 14 L14 14 Z" fill="#F5F7FA" />
            <path d="M14 23 L18 14 L14 14 Z" fill="#2F5DE3" />
          </svg>
          <span className="font-display font-bold text-2xl">Atlas</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-panel border border-line rounded-card p-6 flex flex-col gap-4"
        >
          <h1 className="font-display font-bold text-lg">
            Sign in to your dashboard
          </h1>

          <div>
            <label htmlFor="email" className="block text-sm font-bold mb-1">
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-line rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-bold mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              placeholder="••••••••"
              className="w-full border border-line rounded-md px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="bg-compass text-white font-bold rounded-md py-2.5 mt-2 hover:bg-compass-deep transition-colors"
          >
            Sign in
          </button>

          <p className="text-xs text-muted text-center">
            Demo mode — any email/password signs you in as{' '}
            <strong>Atlas Demo Corp</strong>.
          </p>
        </form>
      </div>
    </main>
  )
}

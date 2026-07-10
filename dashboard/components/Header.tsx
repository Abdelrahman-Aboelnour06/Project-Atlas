export default function Header({ tenantName }: { tenantName: string }) {
  return (
    <header className="border-b border-line bg-panel">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Compass mark — same needle motif as the extension icon */}
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="12.5" fill="#101828" />
            <circle cx="14" cy="14" r="12.5" fill="none" stroke="#2F5DE3" strokeWidth="1.2" />
            <path d="M14 5 L10 14 L14 14 Z" fill="#F5F7FA" />
            <path d="M14 23 L18 14 L14 14 Z" fill="#2F5DE3" />
          </svg>
          <span className="font-display font-bold text-lg tracking-tight">
            Atlas
          </span>
        </div>
        <div className="text-sm text-muted">{tenantName}</div>
      </div>
    </header>
  )
}

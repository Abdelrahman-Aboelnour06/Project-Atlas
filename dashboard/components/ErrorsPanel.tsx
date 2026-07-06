import type { ErrorLog } from '@/lib/mock-data'

const errorTypeLabel: Record<string, string> = {
  missing_alt: 'Missing image description',
  missing_aria: 'Missing accessible name',
  missing_label: 'Missing form label',
}

export default function ErrorsPanel({ errors }: { errors: ErrorLog[] }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <h2 className="font-display font-bold text-lg mb-1">
        Accessibility issues flagged
      </h2>
      <p className="text-sm text-muted mb-4">
        Found automatically while Atlas ran on your pages. Fixing these
        helps every visitor, not just Atlas users.
      </p>

      <ul className="flex flex-col gap-3">
        {errors.map((err) => (
          <li
            key={err.id}
            className="flex items-start gap-3 border-l-4 border-amber pl-3 py-1"
          >
            <div>
              <p className="font-bold text-sm">
                {errorTypeLabel[err.errorType] ?? err.errorType}
              </p>
              <p className="text-sm text-muted">{err.suggestion}</p>
              <p className="text-xs text-muted mt-1">
                {err.url.replace(/^https?:\/\//, '')} · element{' '}
                <code className="font-mono">{err.elementId}</code>
              </p>
            </div>
          </li>
        ))}
        {errors.length === 0 && (
          <li className="text-sm text-muted">No issues flagged yet.</li>
        )}
      </ul>
    </div>
  )
}

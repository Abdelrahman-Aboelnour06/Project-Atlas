import type { UsageLog } from '@/lib/mock-data'

const actionLabel: Record<string, string> = {
  click: 'Click',
  fill: 'Fill',
  scroll: 'Scroll',
  focus: 'Focus',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SessionsTable({ logs }: { logs: UsageLog[] }) {
  return (
    <div className="rounded-card border border-line bg-panel overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="px-4 py-3 font-bold">Session</th>
            <th scope="col" className="px-4 py-3 font-bold">Page</th>
            <th scope="col" className="px-4 py-3 font-bold">Command</th>
            <th scope="col" className="px-4 py-3 font-bold">Action</th>
            <th scope="col" className="px-4 py-3 font-bold">When</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3 font-mono text-xs text-muted">
                {log.sessionId}
              </td>
              <td className="px-4 py-3 max-w-[220px] truncate" title={log.url}>
                {log.url.replace(/^https?:\/\//, '')}
              </td>
              <td className="px-4 py-3 text-muted italic">
                {log.command || '—'}
              </td>
              <td className="px-4 py-3">
                {log.action ? (
                  <span className="text-xs font-bold bg-compass-dim text-compass-deep px-2 py-1 rounded-full">
                    {actionLabel[log.action]}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted">{formatTime(log.timestamp)}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted">
                No sessions yet. Activity will show up here once Atlas is
                used on a live page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

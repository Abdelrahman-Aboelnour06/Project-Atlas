import Header from '@/components/Header'
import ApiKeyCard from '@/components/ApiKeyCard'
import SessionsTable from '@/components/SessionsTable'
import ErrorsPanel from '@/components/ErrorsPanel'
import {
  mockTenant,
  mockApiKeys,
  mockUsageLogs,
  mockErrorLogs,
} from '@/lib/mock-data'

export default function DashboardPage() {
  const sessionsToday = new Set(mockUsageLogs.map((l) => l.sessionId)).size
  const actionsToday = mockUsageLogs.filter((l) => l.action).length

  return (
    <div className="min-h-screen">
      <Header tenantName={mockTenant.companyName} />

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        <div>
          <h1 className="font-display font-bold text-2xl">Dashboard</h1>
          <p className="text-muted text-sm mt-1">
            An overview of how Atlas is being used on your site.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-card border border-line bg-panel p-4">
            <p className="text-sm text-muted">Sessions (recent)</p>
            <p className="font-display font-bold text-3xl mt-1">{sessionsToday}</p>
          </div>
          <div className="rounded-card border border-line bg-panel p-4">
            <p className="text-sm text-muted">Actions performed</p>
            <p className="font-display font-bold text-3xl mt-1">{actionsToday}</p>
          </div>
          <div className="rounded-card border border-line bg-panel p-4">
            <p className="text-sm text-muted">Issues flagged</p>
            <p className="font-display font-bold text-3xl mt-1">{mockErrorLogs.length}</p>
          </div>
        </div>

        {/* API keys */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-lg">API keys</h2>
            <button className="text-sm font-bold text-compass border border-compass rounded-md px-3 py-1.5 hover:bg-compass-dim transition-colors">
              Generate new key
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {mockApiKeys.map((key) => (
              <ApiKeyCard key={key.id} apiKey={key} />
            ))}
          </div>
        </section>

        {/* Sessions */}
        <section>
          <h2 className="font-display font-bold text-lg mb-3">Recent sessions</h2>
          <SessionsTable logs={mockUsageLogs} />
        </section>

        {/* Flagged accessibility issues */}
        <section>
          <ErrorsPanel errors={mockErrorLogs} />
        </section>
      </main>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuthProfileReady, useMutations } from 'deepspace'
import { FileText, Plus } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'
import { createIncidentSaveFlow, INITIAL_SAVE_STATE } from '@/features/incidents/incident-save'
import { incidentListCopy } from '@/features/incidents/incident-access'
import { IncidentDetails } from '@/features/incidents/IncidentDetails'
import type { Incident } from '@/features/incidents/incident-types'
import { IncidentList, useIncidentList } from '@/features/incidents/IncidentList'
import { incidentIdFromSearch, incidentSearch } from '@/features/incidents/incident-route'

const EXAMPLE_INCIDENTS = [
  {
    title: 'Checkout API failures',
    rawLog: `2026-09-10T10:01:12Z POST /api/checkout 500 Internal Server Error
2026-09-10T10:01:13Z payment provider request timed out
2026-09-10T10:01:15Z checkout request failed after 3 retries
2026-09-10T10:01:20Z error rate increased to 18 percent`,
  },
  {
    title: 'Authentication requests timing out',
    rawLog: `2026-09-10T11:14:02Z POST /api/auth/login 504 Gateway Timeout
2026-09-10T11:14:03Z identity provider request exceeded 5s timeout
2026-09-10T11:14:08Z login attempt failed after upstream timeout
2026-09-10T11:14:30Z authentication error rate increased to 11 percent`,
  },
  {
    title: 'Database connection pool exhausted',
    rawLog: `2026-09-10T12:22:41Z GET /api/orders 503 Service Unavailable
2026-09-10T12:22:41Z database connection pool reached maximum size
2026-09-10T12:22:45Z request queued for 10s waiting for a connection
2026-09-10T12:23:01Z order API recovered after pool pressure dropped`,
  },
  {
    title: 'Background job retry storm',
    rawLog: `2026-09-10T13:05:10Z job invoice-sync attempt 1 failed: upstream 502
2026-09-10T13:05:20Z job invoice-sync scheduled for retry in 10s
2026-09-10T13:05:30Z job invoice-sync attempt 2 failed: upstream 502
2026-09-10T13:05:31Z retry queue depth increased to 240 jobs`,
  },
  {
    title: 'Search index lagging behind writes',
    rawLog: `2026-09-10T14:40:00Z POST /api/catalog/items 201 Created
2026-09-10T14:40:02Z search index update queued for item item_4821
2026-09-10T14:41:45Z search index freshness exceeded 90 seconds
2026-09-10T14:42:10Z item visible in search after delayed indexing`,
  },
]

export default function IncidentsPage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const list = useIncidentList()
  const { createConfirmed, ready } = useMutations<Incident>('incidents')
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = incidentIdFromSearch(searchParams.toString())
  const [title, setTitle] = useState('')
  const [rawLog, setRawLog] = useState('')
  const [saveState, setSaveState] = useState(INITIAL_SAVE_STATE)
  const [saveFlow] = useState(() => createIncidentSaveFlow(setSaveState))
  const isCreating = saveState.phase === 'saving'
  const lastExampleIndex = useRef<number | null>(null)
  const listCopy = incidentListCopy(user?.role ?? 'member')

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const recordId = await saveFlow.submit({ title, rawLog }, createConfirmed)
    if (recordId) {
      setTitle('')
      setRawLog('')
      setSearchParams(incidentSearch(recordId))
    }
  }

  function handleLoadExample() {
    if (!saveFlow.canReplaceInput()) return
    let nextIndex = Math.floor(Math.random() * EXAMPLE_INCIDENTS.length)
    while (EXAMPLE_INCIDENTS.length > 1 && nextIndex === lastExampleIndex.current) {
      nextIndex = Math.floor(Math.random() * EXAMPLE_INCIDENTS.length)
    }
    lastExampleIndex.current = nextIndex
    const example = EXAMPLE_INCIDENTS[nextIndex]
    setTitle(example.title)
    setRawLog(example.rawLog)
    saveFlow.clearError()
  }

  if (selectedId) {
    return (
      <IncidentDetails
        key={`${user?.id}:${selectedId}`}
        incidentId={selectedId}
        onBack={() => setSearchParams({}, { replace: true })}
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-primary">IncidentDesk</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{listCopy.heading}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {listCopy.description} Save the incident title and original logs as a verifiable starting point for later analysis and handoff.
            </p>
          </div>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Back to home
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/15 p-2 text-primary"><Plus className="h-5 w-5" /></div>
            <div>
              <h2 className="font-medium text-foreground">Create an incident</h2>
              <p className="text-sm text-muted-foreground">Capture the facts first; analysis comes next.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleLoadExample} disabled={saveState.phase !== 'idle'}>
            <FileText className="h-4 w-4" />
            Load example incident
          </Button>
        </div>
        <form className="flex flex-col gap-4" onSubmit={handleCreate} aria-busy={isCreating}>
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Incident title
            <Input disabled={isCreating} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="For example: Checkout requests failing" maxLength={120} />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Original logs
            <Textarea disabled={isCreating} value={rawLog} onChange={(event) => setRawLog(event.target.value)} placeholder="Paste timestamped log text" rows={7} maxLength={20000} />
          </label>
          {saveState.error && <p role="alert" className="text-sm text-destructive">{saveState.error}</p>}
          {saveState.phase === 'review' && (
            <Button type="button" variant="outline" disabled={!ready || list.status !== 'ready'} onClick={() => saveFlow.acknowledgeReview()}>
              I checked Saved incidents — allow retry
            </Button>
          )}
          {isCreating && <p role="status" className="text-sm text-muted-foreground">Saving incident… Keep this page open until confirmation.</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">New records start as Pending analysis.</p>
            <Button type="submit" loading={isCreating} disabled={!ready || saveState.phase !== 'idle'}>
              {isCreating ? 'Saving incident…' : 'Save incident'}
            </Button>
          </div>
        </form>
      </section>

      <IncidentList
        result={list}
        description={listCopy.description}
        disabled={isCreating}
        onOpen={(recordId) => setSearchParams(incidentSearch(recordId))}
      />
    </div>
  )
}

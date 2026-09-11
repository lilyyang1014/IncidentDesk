import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuthProfileReady, useMutations, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { ArrowLeft, ClipboardList, FileText, Plus, RefreshCw } from 'lucide-react'
import { Badge, Button, Input, Textarea } from '@/components/ui'
import { createIncidentSaveFlow, INITIAL_SAVE_STATE, type Incident } from '@/features/incidents/incident-save'
import { creatorLabel, incidentListCopy } from '@/features/incidents/incident-access'
import { IncidentAnalysisControl } from '@/features/incidents/IncidentAnalysisControl'
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function IncidentsPage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { getEmail, getName } = useUserLookup()
  const { records, status, error } = useQuery<Incident>('incidents', {
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 50,
  })
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

  const selected = useMemo(
    () => records.find((record) => record.recordId === selectedId) ?? null,
    [records, selectedId],
  )

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

  if (selected) {
    return (
      <IncidentDetail
        key={`${user?.id}:${selected.recordId}`}
        record={selected}
        onBack={() => setSearchParams({}, { replace: true })}
        creator={creatorLabel({
          createdBy: selected.createdBy,
          currentUserId: user?.id,
          currentUserEmail: user?.email,
          role: user?.role ?? 'member',
          lookup: { getEmail, getName },
        })}
      />
    )
  }

  if (selectedId) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-10">
        <Button variant="outline" onClick={() => setSearchParams({}, { replace: true })}>Back to incidents</Button>
        {status === 'ready' ? (
          <ErrorState message="This incident could not be found in the records available to your account." />
        ) : (
          <p role="status">Loading incident details…</p>
        )}
        {status === 'error' && <ErrorState message={error ?? 'Could not load incident details.'} />}
      </div>
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
            <Button type="button" variant="outline" disabled={!ready || status !== 'ready'} onClick={() => saveFlow.acknowledgeReview()}>
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

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Saved incidents</h2>
            <p className="mt-1 text-sm text-muted-foreground">{listCopy.description}</p>
          </div>
          <ClipboardList className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState message={error ?? 'Could not load incidents.'} />}
        {status === 'ready' && records.length === 0 && <EmptyState />}
        {status === 'ready' && records.length > 0 && (
          <div className="grid gap-3">
            {records.map((record) => <IncidentCard key={record.recordId} record={record} disabled={isCreating} onOpen={() => setSearchParams(incidentSearch(record.recordId))} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function IncidentCard({ record, onOpen, disabled }: { record: RecordData<Incident>; onOpen: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onOpen} disabled={disabled} className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40 disabled:opacity-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">{record.data.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(record.createdAt)}</p>
        </div>
        <Badge variant="warning">{record.data.status}</Badge>
      </div>
      <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{record.data.rawLog}</p>
      <span className="text-sm font-medium text-primary">Open details →</span>
    </button>
  )
}

function IncidentDetail({
  record,
  onBack,
  creator,
}: {
  record: RecordData<Incident>
  onBack: () => void
  creator: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-10">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to incidents
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-primary">Incident details</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{record.data.title}</h1>
        </div>
        <Badge variant="warning" size="lg">{record.data.status}</Badge>
      </header>
      <IncidentAnalysisControl record={record} />
      {record.data.status === 'Analysis ready' && (
        <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="font-medium text-foreground">Analysis summary</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{record.data.analysisSummary}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Detected signals</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{record.data.analysisSignals || 'None'}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Evidence lines</h3>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm leading-6 text-foreground">{record.data.analysisEvidence || 'None'}</pre>
          </div>
        </section>
      )}
      <section className="grid gap-3 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div><p className="text-muted-foreground">Created</p><p className="mt-1 text-foreground">{formatDate(record.createdAt)}</p></div>
        <div><p className="text-muted-foreground">Created by</p><p className="mt-1 break-all text-foreground">{creator}</p></div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-foreground">Original logs</h2>
        <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm leading-6 text-foreground">{record.data.rawLog}</pre>
      </section>
    </div>
  )
}

function LoadingState() {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Loading incidents…</div>
}

function ErrorState({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{message}</div>
}

function EmptyState() {
  return <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">No incidents yet. Create your first one above.</div>
}

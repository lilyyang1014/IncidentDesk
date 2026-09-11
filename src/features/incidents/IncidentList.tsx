import { useQuery, type RecordData } from 'deepspace'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui'
import type { Incident } from './incident-types'
import { formatDate } from './incident-format'

/** One subscription shared by the list view and the page's save-review gate.
 * Keep its lifecycle at page level so visiting details does not reset it. */
export function useIncidentList() {
  return useQuery<Incident>('incidents', {
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 50,
  })
}

type IncidentListProps = {
  result: ReturnType<typeof useIncidentList>
  description: string
  disabled: boolean
  onOpen: (recordId: string) => void
}

export function IncidentList({ result, description, disabled, onOpen }: IncidentListProps) {
  const { records, status, error } = result
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Saved incidents</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <ClipboardList className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState message={error ?? 'Could not load incidents.'} />}
      {status === 'ready' && records.length === 0 && <EmptyState />}
      {status === 'ready' && records.length > 0 && (
        <div className="grid gap-3">
          {records.map((record) => <IncidentCard key={record.recordId} record={record} disabled={disabled} onOpen={() => onOpen(record.recordId)} />)}
        </div>
      )}
    </section>
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

function LoadingState() {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Loading incidents…</div>
}

function ErrorState({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{message}</div>
}

function EmptyState() {
  return <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">No incidents yet. Create your first one above.</div>
}

import { useQuery, type RecordData } from 'deepspace'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import type { Incident } from './incident-types'
import { formatDate } from './incident-format'
import { useIncidentList } from './use-incident-list'
import type { IncidentListEntry, IncidentListView } from './incident-list-types'
export { useIncidentList } from './use-incident-list'

type IncidentListProps = {
  result: ReturnType<typeof useIncidentList>
  userId: string
  disabled: boolean
  onOpen: (recordId: string) => void
}

export function IncidentList({ result, userId, disabled, onOpen }: IncidentListProps) {
  const { entries, status, error, view } = result
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set())
  const report = useCallback((id: string, visible: boolean) => setUnavailable(previous => {
    if (previous.has(id) === !visible) return previous
    const next = new Set(previous); if (visible) next.delete(id); else next.add(id); return next
  }), [])
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Saved incidents</h2>
          <p className="mt-1 text-sm text-muted-foreground">{view === 'mine' ? 'Incidents you created and are responsible for.' : 'Incidents others have shared with you.'}</p>
        </div>
        <div role="group" aria-label="Incident lists" className="flex flex-wrap gap-2">
          {(['mine', 'shared'] as const).map(value => <Button key={value} variant={view === value ? 'default' : 'outline'} aria-pressed={view === value} disabled={disabled} onClick={() => result.selectView(value)}>{value === 'mine' ? 'My incidents' : 'Shared with me'}</Button>)}
        </div>
      </div>
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState message={error ?? 'Could not load incidents.'} />}
      {status !== 'loading' && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Newest first. Refresh to see newly created or shared incidents.</span><Button size="sm" variant="outline" disabled={disabled || result.loadingMore} onClick={result.refresh}>Refresh list</Button></div>}
      {status === 'ready' && entries.length === 0 && <EmptyState view={view} />}
      {status === 'ready' && entries.length > 0 && (
        <div className="grid gap-3">
          {entries.map(entry => <LiveIncidentCard key={`${view}:${entry.recordId}:${entry.createdAt}`} entry={entry} userId={userId} view={view} disabled={disabled} report={report} onOpen={() => onOpen(entry.recordId)} />)}
          {entries.every(entry => unavailable.has(entry.recordId)) && <p className="text-sm text-muted-foreground">These incidents are no longer available in this list. Refresh the list or load more.</p>}
        </div>
      )}
      {error && status !== 'error' && <ErrorState message={error} />}
      {status === 'ready' && result.cursor && <Button variant="outline" disabled={disabled || result.loadingMore} onClick={result.loadMore}>{result.loadingMore ? 'Loading more…' : error ? 'Retry loading more' : 'Load more'}</Button>}
    </section>
  )
}

// Exact-ID subscriptions avoid the SDK's broad permission-filtered scan and
// clear revoked rows on the existing membership RESUBSCRIBE message. Never use
// the HTTP page as a fallback when current authorization is unavailable.
function LiveIncidentCard({ entry, userId, view, disabled, report, onOpen }: { entry: IncidentListEntry; userId: string; view: IncidentListView; disabled: boolean; report: (id: string, visible: boolean) => void; onOpen: () => void }) {
  const { records, status, error } = useQuery<Incident>('incidents', { where: { recordId: entry.recordId }, limit: 1 })
  const record = records.find(row => row.recordId === entry.recordId && row.createdAt === entry.createdAt && row.createdBy === entry.createdBy)
  const visible = !!record && (view === 'mine' ? record.createdBy === userId : record.createdBy !== userId && !!record.data.collaborators?.includes(userId))
  useEffect(() => { if (status === 'ready') report(entry.recordId, visible) }, [status, entry.recordId, visible, report])
  if (status === 'loading') return <LoadingState />
  if (status === 'error') return <ErrorState message={error ?? 'Could not check incident access. Refresh the list.'} />
  return visible && record ? <IncidentCard record={record} disabled={disabled} onOpen={onOpen} /> : null
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

function EmptyState({ view }: { view: IncidentListView }) {
  return <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">{view === 'mine' ? 'No incidents yet. Create your first one above.' : 'No incidents shared with you yet. Ask a teammate to add you as a collaborator.'}</div>
}

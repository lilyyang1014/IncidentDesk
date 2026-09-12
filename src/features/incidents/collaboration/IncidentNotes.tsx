import { useQuery, useUserLookup, type RecordData } from 'deepspace'
import type { Incident } from '../incident-types'
import { formatDate } from '../incident-format'
import { IncidentNoteComposer } from './IncidentNoteComposer'
import { NOTES_PAGE_SIZE, type IncidentNote } from './collaboration-types'
export function IncidentNotes({ record }: { record: RecordData<Incident> }) {
  const { getName } = useUserLookup()
  const { records, status, error } = useQuery<IncidentNote>('incident_notes', {
    where: { incidentId: record.recordId, incidentCreatedAt: record.createdAt, incidentOwner: record.createdBy },
    orderBy: 'sequence', orderDir: 'desc', limit: NOTES_PAGE_SIZE,
  })
  return <section aria-label="Investigation notes" className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
    <div><h2 className="font-medium">Investigation notes</h2><p className="mt-1 text-sm text-muted-foreground">Record checks, findings and next steps together. New notes appear live.</p></div>
    <IncidentNoteComposer incidentId={record.recordId} incidentCreatedAt={record.createdAt} />
    {status === 'loading' && <p role="status">Loading notes…</p>}
    {status === 'error' && <p role="alert" className="text-sm text-destructive">{error ?? 'Could not load notes.'}</p>}
    {status === 'ready' && !records.length && <p className="text-sm text-muted-foreground">No investigation notes yet.</p>}
    {status === 'ready' && <div className="flex flex-col gap-3">
      {records.length >= NOTES_PAGE_SIZE && <p className="text-xs text-muted-foreground">Showing the latest {NOTES_PAGE_SIZE} notes. Older notes remain saved; history navigation is not available yet.</p>}
      {records.map(note => <article key={note.recordId} className="rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">{getName(note.createdBy) ?? 'Registered user'} · {formatDate(note.createdAt)} · #{note.data.sequence}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{note.data.body}</p>
      </article>)}
    </div>}
  </section>
}

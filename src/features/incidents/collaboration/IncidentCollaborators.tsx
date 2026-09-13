import { useEffect, useRef, useState } from 'react'
import { useMutations, useUserLookup, type RecordData } from 'deepspace'
import { Button, Modal } from '@/components/ui'
import type { Incident } from '../incident-types'
import { collaboratorIds } from '../incident-permissions'
import { MAX_COLLABORATORS } from './collaboration-types'
import { IncidentInvitation } from './IncidentInvitation'
import { changeCollaboration } from './collaboration-client'

export function IncidentCollaborators({ record, canManage }: { record: RecordData<Incident>; canManage: boolean }) {
  const { getName } = useUserLookup()
  const { ready } = useMutations('incidents')
  const [removal, setRemoval] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const gate = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const ids = collaboratorIds(record.data.collaborators)
  async function change(intent: 'add' | 'remove', userId: string) {
    if (!ready || gate.current || !canManage || (intent === 'remove' && !ids.includes(userId))) return
    gate.current = true
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(null); setMessage(null)
    try {
      await changeCollaboration({ incidentId: record.recordId, incidentCreatedAt: record.createdAt, intent, userId }, request.signal)
      if (!request.signal.aborted) { setRemoval(null); setMessage(intent === 'add' ? 'Collaborator added. Share this incident URL with them.' : 'Collaborator removed. Future access is blocked.') }
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Could not confirm the access change.')
    } finally { gate.current = false; if (!request.signal.aborted) setBusy(false) }
  }
  function closeRemoval() {
    // Closing a pending request would not undo a server-side access change.
    if (!gate.current) { setRemoval(null); setError(null) }
  }
  return <section aria-label="Collaborators" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
    <h2 className="font-medium">Collaborators</h2>
    <p className="text-sm text-muted-foreground">Share saved logs, analysis and references, and add investigation notes together. Only the creator can manage collaborators.</p>
    <div className="text-sm"><span className="font-medium">{getName(record.createdBy) ?? 'Incident creator'}</span> · Creator</div>
    {ids.map(id => <div key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="break-all">{getName(id) ?? 'Registered user'} · Collaborator <span className="text-xs text-muted-foreground">({id})</span></span>
      {canManage && <Button variant="outline" disabled={!ready || busy} onClick={() => {
        setError(null); setMessage(null); setRemoval({ id, name: getName(id) ?? 'Registered user' })
      }}>Remove collaborator</Button>}
    </div>)}
    {!ids.length && <p className="text-sm text-muted-foreground">No collaborators added.</p>}
    {canManage && <IncidentInvitation key={`${record.recordId}:${record.createdAt}`} incidentId={record.recordId} incidentCreatedAt={record.createdAt} hasCollaborator={ids.length >= MAX_COLLABORATORS} />}
    {canManage && ids.length >= MAX_COLLABORATORS && <p className="text-xs text-muted-foreground">This version supports the creator and one collaborator.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Modal open={removal !== null && canManage} onClose={closeRemoval} size="sm">
      <Modal.Header>
        <Modal.Title>Remove collaborator?</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-sm"><span className="font-medium">{removal?.name}</span> will lose access to this incident. Their existing investigation notes will remain saved.</p>
        <p className="mt-2 break-all text-xs text-muted-foreground">Account ID: {removal?.id}</p>
        {removal && !ids.includes(removal.id) && <p role="status" className="mt-3 text-sm">This person is no longer a collaborator.</p>}
        {error && <div role="alert" className="mt-3 text-sm text-destructive"><p>{error}</p><p className="mt-2">The removal could not be confirmed. Close this dialog and check the collaborator list before trying again.</p></div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" disabled={busy} onClick={closeRemoval}>Cancel</Button>
        <Button variant="destructive" disabled={!ready || busy || !!error || !removal || !ids.includes(removal.id)} onClick={() => {
          if (removal) void change('remove', removal.id)
        }}>{busy ? 'Removing…' : 'Remove collaborator'}</Button>
      </Modal.Footer>
    </Modal>
  </section>
}

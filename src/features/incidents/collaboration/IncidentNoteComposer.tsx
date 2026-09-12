import { useEffect, useRef, useState } from 'react'
import { useMutations } from 'deepspace'
import { Button } from '@/components/ui'
import { changeCollaboration } from './collaboration-client'
import { NOTE_LIMIT } from './collaboration-types'

export function IncidentNoteComposer({ incidentId, incidentCreatedAt }: { incidentId: string; incidentCreatedAt: string }) {
  const { ready } = useMutations('incidents')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState<{ requestId: string; body: string } | null>(null)
  const gate = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function submit() {
    if (!ready || gate.current || !body.trim()) return
    gate.current = true
    const current = attempt ?? { requestId: crypto.randomUUID(), body: body.trim() }
    setAttempt(current)
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(null); setSaved(false)
    try {
      await changeCollaboration({ intent: 'note', incidentId, incidentCreatedAt, ...current }, request.signal)
      if (!request.signal.aborted) { setBody(''); setAttempt(null); setSaved(true) }
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Could not confirm note saving.')
    } finally { gate.current = false; if (!request.signal.aborted) setBusy(false) }
  }
  return <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void submit() }}>
    <label htmlFor="investigation-note" className="text-sm font-medium">Add an investigation note</label>
    <textarea id="investigation-note" value={body} maxLength={NOTE_LIMIT} rows={4} disabled={!ready || busy || !!attempt} onChange={e => { setBody(e.target.value); setSaved(false) }} placeholder="What did you check? What did you find? What should happen next?" className="rounded-md border border-border bg-background p-3 text-sm text-foreground" />
    <p className="text-xs text-muted-foreground">{body.length}/{NOTE_LIMIT} characters. Notes cannot be edited or deleted in this version and are not included in reports or emails. Unsaved text is lost on reload.</p>
    <Button type="submit" className="self-start" disabled={!ready || busy || !body.trim()}>{busy ? 'Saving note…' : attempt ? 'Retry saving this note' : 'Add note'}</Button>
    {saved && <p role="status" className="text-sm">Note saved.</p>}
    {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><p className="mt-1">Retry uses the same request and will not create a duplicate note. Check the notes below before reloading.</p></div>}
  </form>
}

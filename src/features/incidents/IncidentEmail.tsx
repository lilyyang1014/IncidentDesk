import { useEffect, useReducer, useRef, useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { requestEmail, type EmailInput } from './incident-email-client'
import { emailFormReducer, initialEmailForm } from './incident-email-form'
import { recipientSchema, subjectSchema, type EmailState } from './incident-email-types'

export function IncidentEmail({ incidentId, title }: { incidentId: string; title: string }) {
  const [{ to, subject, includeLogs }, updateForm] = useReducer(emailFormReducer, title, initialEmailForm)
  const [state, setState] = useState<EmailState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState(false)
  const gate = useRef(false)
  const mounted = useRef(true)
  const version = useRef(0)
  useEffect(() => {
    mounted.current = true
    const current = ++version.current
    const controller = new AbortController()
    requestEmail(incidentId, { intent: 'status' }, controller.signal).then((next) => {
      if (!controller.signal.aborted && current === version.current) {
        setState(next)
        updateForm({ type: 'restore', draft: next.draft })
      }
    }).catch(() => {
      if (!controller.signal.aborted && current === version.current) setError('Could not load saved email state. Check email status.')
    })
    return () => { mounted.current = false; controller.abort() }
  }, [incidentId])
  async function run(input: EmailInput) {
    if (gate.current) return
    gate.current = true
    ++version.current
    setBusy(true)
    setError(null)
    setReview(false)
    try {
      const next = await requestEmail(incidentId, input)
      if (mounted.current) {
        setState(next)
        if (input.intent === 'prepare' && next.draft && next.draft.to === input.to
          && next.draft.subject === input.subject && next.draft.includeLogs === input.includeLogs) {
          updateForm({ type: 'prepared', draft: next.draft })
        } else updateForm({ type: 'restore', draft: next.draft })
      }
    } catch (err) {
      if (mounted.current) { setState(null); setError(err instanceof Error ? err.message : 'Outcome unknown. Check email status.') }
    } finally { gate.current = false; if (mounted.current) setBusy(false) }
  }
  const locked = !state || ['sending', 'unknown'].includes(state.phase)
  const sendable = state?.draft && ['ready', 'oauth', 'failed'].includes(state.phase)
  return <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5" aria-label="Email handoff">
    <h2 className="font-medium">Email handoff</h2>
    <p className="text-sm text-muted-foreground">Prepare a saved email, review its exact content, then confirm sending from your connected Gmail account.</p>
    <label className="flex flex-col gap-1 text-sm">Recipient<input type="email" value={to} maxLength={254} disabled={busy || locked} onChange={(event) => updateForm({ type: 'edit', fields: { to: event.target.value } })} className="rounded-md border border-border bg-background p-2" /></label>
    <label className="flex flex-col gap-1 text-sm">Subject<input value={subject} maxLength={160} disabled={busy || locked} onChange={(event) => updateForm({ type: 'edit', fields: { subject: event.target.value } })} className="rounded-md border border-border bg-background p-2" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeLogs} disabled={busy || locked} onChange={(event) => updateForm({ type: 'edit', fields: { includeLogs: event.target.checked } })} />Include full original logs</label>
    <p className="text-xs text-muted-foreground">AI evidence may include log excerpts even when full logs are excluded. Preparing and reviewing do not send mail. Sending uses DeepSpace credits.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || locked || !recipientSchema.safeParse(to).success || !subjectSchema.safeParse(subject).success} onClick={() => void run({ intent: 'prepare', to, subject, includeLogs })}>Prepare email draft</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run({ intent: 'status' })}>Check email status</Button>
    </div>
    {busy && <p role="status">Processing email request…</p>}
    {!state && !error && !busy && <p role="status">Loading email state…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {state?.error && <p role="alert" className="text-destructive">{state.error}</p>}
    {state?.phase === 'sending' && <p role="status">Sending is in progress. Check status; do not submit another email.</p>}
    {state?.phase === 'accepted' && <p role="status">Gmail accepted this email. Delivery to the recipient is not confirmed. Message ID: {state.messageId}</p>}
    {state?.phase === 'oauth' && <div className="flex flex-col gap-2 text-sm">
      <p>Google authorization is required. DeepSpace requests Gmail modify access, which is broader than sending only. After authorizing, return here and review and confirm again. Nothing is sent automatically after authorization.</p>
      {state.authUrl && <a href={state.authUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Authorize Google</a>}
    </div>}
    {state?.draft && <div className="rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">Saved draft</p>
      <p className="mt-2 break-all">To: {state.draft.to}</p><p className="break-words">Subject: {state.draft.subject}</p>
      <p className="mt-1 text-muted-foreground">Form edits apply only after preparing a new draft. The saved draft below is what will be sent.</p>
      <Button className="mt-3" variant="outline" disabled={busy} onClick={() => setReview(true)}>{sendable ? 'Review and send email' : 'View saved email'}</Button>
    </div>}
    <Modal open={review} onClose={() => setReview(false)} size="xl">
      <Modal.Header><Modal.Title>Review handoff email</Modal.Title><Modal.Description>Check the recipient and complete body. Confirming may immediately send this email and consume DeepSpace credits. If authorization is needed, you must confirm again afterward.</Modal.Description></Modal.Header>
      <Modal.Body>{state?.draft && <>
        <p className="break-all font-medium">To: {state.draft.to}</p><p className="mt-2 break-words font-medium">Subject: {state.draft.subject}</p>
        <p className="mt-2 text-sm">Full original logs: {state.draft.includeLogs ? 'Included' : 'Excluded'}</p>
        <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-sm">{state.draft.content}</pre>
      </>}</Modal.Body>
      <Modal.Footer><Button variant="outline" onClick={() => setReview(false)}>Cancel</Button>
        {sendable && <Button disabled={busy} onClick={() => { if (state?.draft) void run({ intent: 'send', draftId: state.draft.id, confirmed: true }) }}>Confirm send email</Button>}
      </Modal.Footer>
    </Modal>
  </section>
}

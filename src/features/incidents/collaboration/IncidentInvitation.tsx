import { useEffect, useRef, useState } from 'react'
import { useMutations } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { requestInvitation } from './invitation-client'
import { invitationEmail, invitationLink, type InvitationResult, type InvitationRequest } from './invitation-types'

export function IncidentInvitation({ incidentId, incidentCreatedAt, hasCollaborator }: { incidentId: string; incidentCreatedAt: string; hasCollaborator: boolean }) {
  const { ready } = useMutations('incidents')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<InvitationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const gate = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const uncertain = useRef(false)
  const source = { incidentId, incidentCreatedAt }
  useEffect(() => {
    if (!ready) return
    const request = new AbortController()
    controller.current = request
    requestInvitation({ intent: 'status', incidentId, incidentCreatedAt }, request.signal).then(value => {
      if (!request.signal.aborted) setState(value)
    }).catch(err => { if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load invitation.') })
    return () => request.abort()
  }, [ready, incidentId, incidentCreatedAt])
  useEffect(() => () => controller.current?.abort(), [])

  async function change(input: InvitationRequest) {
    if (gate.current || !ready) return
    gate.current = true
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setBusy(true); setError(null); setCopied(false)
    try {
      const value = await requestInvitation(input, request.signal)
      if (!request.signal.aborted) { setState(value); uncertain.current = false; if (input.intent === 'create') setEmail('') }
    } catch (err) {
      if (!request.signal.aborted) {
        uncertain.current = true
        setError(err instanceof Error ? err.message : 'Could not confirm the invitation.')
      }
    } finally { gate.current = false; if (!request.signal.aborted) setBusy(false) }
  }
  const invitation = state?.invitation
  const active = invitation && ['pending', 'accepting'].includes(invitation.phase)
  const link = invitation ? invitationLink(window.location.origin, invitation.token) : ''
  return <div className="flex flex-col gap-3 border-t border-border pt-4">
    <h3 className="font-medium">Invite by email</h3>
    <p className="text-sm text-muted-foreground">Invite someone who has not used IncidentDesk yet. Create a link and share it with them. They must sign in with this verified email and accept. No invitation email is sent.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error} Check invitation status before making another change.</p>}
    {!state && !error && <p role="status" className="text-sm">Loading invitation…</p>}
    {invitation && <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <p className="break-all">{invitation.email} · <strong>{invitation.phase === 'accepting' ? 'Acceptance pending confirmation' : invitation.phase.charAt(0).toUpperCase() + invitation.phase.slice(1)}</strong></p>
      <p className="text-xs text-muted-foreground">Expires {new Date(invitation.expiresAt).toLocaleString('en-US')}. One pending invitation reserves the collaborator slot.</p>
      {active && <>
        <label htmlFor="invitation-link" className="text-xs">Invitation link — share privately</label>
        <Input id="invitation-link" readOnly value={link} onFocus={event => event.currentTarget.select()} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={async () => {
            try { await navigator.clipboard.writeText(link); setCopied(true) }
            catch { setError('Clipboard unavailable. Select and copy the invitation link above.') }
          }}>{copied ? 'Copied' : 'Copy invitation link'}</Button>
          <Button variant="outline" disabled={busy || !ready || uncertain.current} onClick={() => void change({ intent: 'cancel', ...source, token: invitation.token })}>Cancel invitation</Button>
        </div>
      </>}
    </div>}
    {!!state && !active && !hasCollaborator && <form className="flex flex-col gap-2" onSubmit={event => {
      event.preventDefault()
      const parsed = invitationEmail.safeParse(email)
      if (parsed.success && !uncertain.current) void change({ intent: 'create', ...source, email: parsed.data, requestId: crypto.randomUUID(), expectedId: invitation?.token ?? null })
    }}>
      <label htmlFor="invite-email" className="text-sm">Recipient email</label>
      <Input id="invite-email" type="email" value={email} maxLength={254} placeholder="teammate@example.com" onChange={event => setEmail(event.target.value)} disabled={busy} />
      <p className="text-xs text-muted-foreground">Links expire after 7 days. Up to 10 new invitations per account per UTC day, with one minute between invitations.</p>
      <Button type="submit" className="self-start" disabled={!ready || busy || uncertain.current || !invitationEmail.safeParse(email).success}>Create invitation link</Button>
    </form>}
    <Button variant="outline" className="self-start" disabled={!ready || busy} onClick={() => void change({ intent: 'status', ...source })}>{busy ? 'Checking…' : 'Check invitation status'}</Button>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, useAuth, useMutations } from 'deepspace'
import { Button } from '@/components/ui'
import { requestInvitation } from './invitation-client'
import type { InvitationView } from './invitation-types'
import { forgetInvitation, rememberInvitation } from './invitation-resume'
import { incidentSearch } from '../incident-route'

export function InvitationAcceptance({ token }: { token: string | null }) {
  const { isSignedIn, userId } = useAuth()
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-12">
    <h1 className="text-2xl font-semibold">Incident invitation</h1>
    {!token ? <p role="alert">This invitation link is incomplete. Ask the creator for a new link.</p>
      : !isSignedIn ? <InvitationSignIn token={token} />
      : <SignedInInvitation key={`${token}:${userId}`} token={token} />}
    <Link to="/incidents" className="text-sm underline" onClick={forgetInvitation}>Back to incidents</Link>
  </main>
}

function InvitationSignIn({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <p className="text-sm text-muted-foreground">You do not need to have used IncidentDesk before. Sign in with the account that owns the invited email, then review and accept the invitation. Signing in alone does not grant access.</p>
    <Button onClick={() => { rememberInvitation(token); setOpen(true) }}>Sign in to review invitation</Button>
    <p className="text-xs text-muted-foreground">If sign-in returns you to Home, reopen your original invitation link.</p>
    {open && <AuthOverlay onClose={() => { setOpen(false); forgetInvitation() }} />}
  </>
}

function SignedInInvitation({ token }: { token: string }) {
  const { ready } = useMutations('incidents')
  const [invitation, setInvitation] = useState<InvitationView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!ready) return
    forgetInvitation()
    const request = new AbortController(); controller.current = request
    requestInvitation({ intent: 'inspect', token }, request.signal).then(value => {
      if (!request.signal.aborted) setInvitation(value.invitation)
    }).catch(err => { if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Could not check invitation.') })
    return () => request.abort()
  }, [ready, token])
  useEffect(() => () => controller.current?.abort(), [])
  async function request(accept: boolean) {
    if (!ready || gate.current) return
    gate.current = true
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    setBusy(true); setError(null)
    try {
      const value = await requestInvitation(accept ? { intent: 'accept', token, confirmed: true } : { intent: 'inspect', token }, current.signal)
      if (!current.signal.aborted) setInvitation(value.invitation)
    } catch (err) {
      if (!current.signal.aborted) { setInvitation(null); setError(err instanceof Error ? err.message : 'Acceptance could not be confirmed. Check this invitation before trying again.') }
    } finally { gate.current = false; if (!current.signal.aborted) setBusy(false) }
  }
  return <>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!invitation && !error && <p role="status">Checking invitation and verified email…</p>}
    {invitation && <>
      <p className="break-all text-sm">Invited email: <strong>{invitation.email}</strong></p>
      {invitation.phase === 'accepted' ? <>
        <p role="status">Invitation accepted. You can now view this incident and collaborate.</p>
        <Link className="rounded-md bg-primary px-4 py-2 text-center text-primary-foreground" to={`/incidents${incidentSearch(invitation.incidentId)}`}>Open shared incident</Link>
      </> : ['pending', 'accepting'].includes(invitation.phase) ? <>
        <p className="text-sm text-muted-foreground">Accept to view the incident's logs, saved analysis and references, and contribute notes and hypothesis judgments. You will not manage collaborators or send handoff emails.</p>
        <p className="text-sm">Expires {new Date(invitation.expiresAt).toLocaleString('en-US')}.</p>
        {invitation.phase === 'accepting' && <p role="status" className="text-sm">A previous acceptance is pending confirmation. Continue with this same invitation to recover it.</p>}
        <Button disabled={!ready || busy} onClick={() => void request(true)}>{busy ? 'Confirming…' : invitation.phase === 'accepting' ? 'Continue accepting invitation' : 'Accept invitation'}</Button>
      </> : <p role="status">This invitation is {invitation.phase}. Ask the creator for a new link if you still need access.</p>}
    </>}
    <Button variant="outline" disabled={!ready || busy} onClick={() => void request(false)}>{busy ? 'Checking…' : 'Check invitation status'}</Button>
    <p className="text-xs text-muted-foreground">Using the wrong account? Sign out from the account menu, then reopen this link and sign in with the invited email.</p>
  </>
}

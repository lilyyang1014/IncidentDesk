import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { loadGmailConnection, type GmailConnection } from './gmail-connection'

export function GmailConnectionStatus() {
  const [state, setState] = useState<GmailConnection | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  async function refresh() {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    setState(null)
    try {
      const next = await loadGmailConnection(controller.signal)
      if (!controller.signal.aborted) setState(next)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not check Gmail connection.')
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false) }
    }
  }
  useEffect(() => {
    void refresh()
    return () => { pending.current?.abort(); pending.current = null }
  }, [])
  return <section aria-label="Gmail connection" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
    <h2 className="font-medium">Gmail connection</h2>
    {busy && <p role="status" className="text-sm">Checking Gmail connection…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state && <GmailConnectionView state={state} />}
    <p className="text-xs text-muted-foreground">Checking status does not send email. Prepare and review an email below to begin a confirmed send or request Google authorization.</p>
    <Button className="self-start" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh Gmail status</Button>
  </section>
}
export function GmailConnectionView({ state }: { state: GmailConnection }) {
  return <div className="text-sm">
    <p>{!state.connected ? 'Google account not connected.' : state.gmailSend ? 'Gmail sending permission is recorded.' : 'Google connected; Gmail sending permission is missing.'}</p>
    {state.connected && state.email && <p className="mt-2 break-all text-muted-foreground">Connected account: {state.email}</p>}
    {state.connected && state.gmailSend && <p className="mt-2 text-muted-foreground">Permission has not been tested by sending an email. Google may require authorization again.</p>}
  </div>
}

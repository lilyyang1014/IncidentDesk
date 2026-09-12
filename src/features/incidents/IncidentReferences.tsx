import { useEffect, useRef, useState } from 'react'
import { useMutations } from 'deepspace'
import { Button, Modal } from '@/components/ui'
import { requestReferences } from './incident-reference-client'
import { searchQuery, type ReferenceState, type ReferenceResult } from './incident-reference-types'

export function IncidentReferences({ incidentId, readOnly = false }: { incidentId: string; readOnly?: boolean }) {
  const { ready } = useMutations('incidents')
  const [query, setQuery] = useState('')
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)
  const [state, setState] = useState<ReferenceState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = useRef(false)
  const mounted = useRef(true)
  const version = useRef(0)
  useEffect(() => {
    mounted.current = true
    const current = ++version.current
    const controller = new AbortController()
    requestReferences(incidentId, readOnly ? 'report' : 'status', undefined, controller.signal).then((value) => {
      if (!controller.signal.aborted && current === version.current) { setState(value); setQuery(value.query) }
    }).catch((err) => {
      if (!controller.signal.aborted && current === version.current) setError(err instanceof Error ? err.message : 'Could not load references.')
    })
    return () => { mounted.current = false; controller.abort() }
  }, [incidentId, readOnly])

  async function request(intent: 'status' | 'search', selectedQuery = query.trim()) {
    if (gate.current) return
    gate.current = true
    ++version.current
    setBusy(true)
    setError(null)
    try {
      const value = await requestReferences(incidentId, readOnly ? 'report' : intent, readOnly ? undefined : selectedQuery || undefined)
      if (mounted.current) { setState(value); setQuery(value.query) }
    } catch (err) {
      if (mounted.current) { setState(null); setError(err instanceof Error ? err.message : 'Search outcome unknown. Check status.') }
    } finally { gate.current = false; if (mounted.current) setBusy(false) }
  }
  const valid = searchQuery.safeParse(query).success
  const sameQuery = state?.query === query.trim()
  const canSearch = !!state && (!sameQuery || state.canSearch)
  return <section aria-label="Troubleshooting references" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
    <h2 className="font-medium">Troubleshooting references</h2>
    <p className="text-sm text-muted-foreground">Search public sources with Exa. References are suggestions for review, not verified fixes.</p>
    {!readOnly && <label className="flex flex-col gap-2 text-sm">Search query
      <input value={query} disabled={busy || (!state && !error)} maxLength={300} onChange={(event) => setQuery(event.target.value)} placeholder="Spring Boot database connection timeout"
        className="rounded-md border border-border bg-background p-2 text-foreground" />
    </label>}
    {!readOnly && <p className="text-xs text-muted-foreground">Only this query is sent to Exa. Remove secrets and personal details. Uses your DeepSpace credits; up to 5 results, 10 searches per account per UTC day. No automatic retries.</p>}
    {!state && !error && <p role="status">Loading saved references…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {sameQuery && state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {sameQuery && state?.phase === 'running' && <p role="status">Search in progress. Check status to retrieve saved results.</p>}
    <div className="flex flex-wrap gap-2">
      {!readOnly && <Button disabled={!ready || busy || !valid || !canSearch} onClick={() => setPendingQuery(query.trim())}>{busy ? 'Waiting…' : 'Search references'}</Button>}
      <Button variant="outline" disabled={busy || (!!query.trim() && !valid)} onClick={() => void request('status')}>Check search status</Button>
    </div>
    <Modal open={pendingQuery !== null} onClose={() => setPendingQuery(null)}>
      <Modal.Header>
        <Modal.Title>Confirm reference search</Modal.Title>
        <Modal.Description>This search uses your DeepSpace credits. Only the query below will be sent to Exa. The exact cost depends on usage.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <p className="text-sm font-medium">Search query</p>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-sm">{pendingQuery}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" onClick={() => setPendingQuery(null)}>Cancel</Button>
        <Button disabled={!ready || busy || pendingQuery === null} onClick={() => {
          if (pendingQuery === null || !ready || gate.current) return
          const confirmedQuery = pendingQuery
          setPendingQuery(null)
          void request('search', confirmedQuery)
        }}>Confirm search</Button>
      </Modal.Footer>
    </Modal>
    {state?.result && <ReferenceResults result={state.result} />}
  </section>
}

export function ReferenceResults({ result }: { result: ReferenceResult }) {
  return <div className="flex flex-col gap-3 text-sm">
    <p className="text-muted-foreground">Saved search: {result.query} · {new Date(result.searchedAt).toLocaleString('en-US')}</p>
    {!result.items.length && <p>No references found. Try a different query.</p>}
    {result.items.map((item) => <article key={item.url} className="rounded-lg border border-border p-3">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">{item.title}</a>
      <p className="mt-1 break-all text-xs text-muted-foreground">{new URL(item.url).hostname}</p>
      {item.excerpt && <p className="mt-2 whitespace-pre-wrap break-words">{item.excerpt}</p>}
    </article>)}
  </div>
}

import { useEffect, useRef, useState } from 'react'
import type { RecordData } from 'deepspace'
import { Button, Modal } from '@/components/ui'
import type { Incident } from './incident-types'
import { formatDate } from './incident-format'
import { AiAnalysisView } from './IncidentAiAnalysis'
import { ReferenceResults } from './IncidentReferences'
import { loadHandoffResults, type HandoffResults } from './incident-handoff'

export function IncidentHandoffPreview({ record }: { record: RecordData<Incident> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<HandoffResults | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  function close() {
    controller.current?.abort()
    controller.current = null
    setOpen(false)
    setBusy(false)
    setResults(null)
    setError(null)
  }
  async function preview() {
    if (controller.current) return
    const request = new AbortController()
    controller.current = request
    setOpen(true)
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      const saved = await loadHandoffResults(record.recordId, request.signal)
      if (!request.signal.aborted) setResults(saved)
    } catch {
      if (!request.signal.aborted) setError('Could not load the saved report data. Close this preview and try again.')
    } finally {
      if (!request.signal.aborted) { controller.current = null; setBusy(false) }
    }
  }
  return <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5" aria-label="Incident handoff">
    <h2 className="font-medium">Incident handoff</h2>
    <p className="text-sm text-muted-foreground">Review the incident, saved AI analysis and latest reference search together. Opening a preview uses no model or search credits.</p>
    <Button className="self-start" disabled={busy} onClick={() => void preview()}>Preview handoff report</Button>
    <Modal open={open} onClose={close} size="xl">
      <Modal.Header>
        <Modal.Title>Handoff report preview</Modal.Title>
        <Modal.Description>Draft for review. Nothing has been sent or marked as approved. Close and reopen to load updated results.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        {busy && <p role="status">Loading saved report data…</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {results && <HandoffReport record={record} results={results} />}
      </Modal.Body>
      <Modal.Footer><Button variant="outline" onClick={close}>Close preview</Button></Modal.Footer>
    </Modal>
  </section>
}

export function HandoffReport({ record, results }: { record: RecordData<Incident>; results: HandoffResults }) {
  return <article className="flex flex-col gap-6 text-sm">
    <header>
      <h3 className="break-words text-xl font-semibold">{record.data.title}</h3>
      <p className="mt-2 break-all text-muted-foreground">Incident ID: {record.recordId}</p>
      <p className="mt-1 text-muted-foreground">Created: {formatDate(record.createdAt)}</p>
      <p className="mt-1">Local analysis status: {record.data.status}</p>
    </header>
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">AI analysis</h3>
      {results.ai.phase === 'complete' && results.ai.result
        ? <AiAnalysisView result={results.ai.result} />
        : <p>No completed AI analysis is available. Current state: {results.ai.phase}. This preview does not generate it.</p>}
    </section>
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">Troubleshooting references</h3>
      {results.references.phase === 'complete' && results.references.result
        ? <ReferenceResults result={results.references.result} />
        : <p>No completed reference search is available. Current state: {results.references.phase}. This preview does not run a search.</p>}
    </section>
    <section>
      <h3 className="font-semibold">Original logs</h3>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-background p-3">{record.data.rawLog}</pre>
    </section>
    <p className="text-muted-foreground">Review hypotheses, source relevance and sensitive information before sharing. This draft is not a confirmed root-cause report.</p>
  </article>
}

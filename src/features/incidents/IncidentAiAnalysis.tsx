import { HypothesisReview } from './collaboration/HypothesisReview'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutations } from 'deepspace'
import { Button } from '@/components/ui'
import { requestIncidentAi } from './incident-ai-client'
import type { AiAnalysisState } from './incident-ai-types'

export function IncidentAiAnalysis({ incidentId, incidentCreatedAt, incidentOwner, readOnly = false }: { incidentId: string; incidentCreatedAt?: string; incidentOwner?: string; readOnly?: boolean }) {
  const { ready } = useMutations('incidents')
  const [state, setState] = useState<AiAnalysisState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = useRef(false)
  const mounted = useRef(true)
  const requestVersion = useRef(0)

  useEffect(() => {
    mounted.current = true
    const version = ++requestVersion.current
    const controller = new AbortController()
    requestIncidentAi(incidentId, 'status', controller.signal).then((next) => {
      if (!controller.signal.aborted && version === requestVersion.current) setState(next)
    }).catch((err) => {
      if (!controller.signal.aborted && version === requestVersion.current) setError(err instanceof Error ? err.message : 'Could not load AI analysis.')
    })
    return () => { mounted.current = false; controller.abort() }
  }, [incidentId])

  async function request(intent: 'status' | 'generate') {
    if (gate.current) return
    gate.current = true
    ++requestVersion.current
    setBusy(true)
    setError(null)
    try {
      const next = await requestIncidentAi(incidentId, intent)
      if (mounted.current) setState(next)
    } catch (err) {
      if (mounted.current) {
        // Clear generation eligibility until an authenticated status read has
        // reconciled the durable receipt. Never repeat the paid request here.
        setState(null)
        setError(err instanceof Error ? err.message : 'Request outcome unknown. Check status before trying again.')
      }
    } finally {
      gate.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5" aria-label="AI analysis">
    <div>
      <h2 className="font-medium text-foreground">AI analysis</h2>
      <p className="mt-2 text-sm text-muted-foreground">OpenAI analyzes the saved title and logs. Hypotheses require human verification.</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {!state && !error && <p role="status" className="text-sm">Loading AI analysis…</p>}
    {state?.phase === 'running' && <p role="status" className="text-sm">AI analysis is in progress. Check status to retrieve its result without starting another request.</p>}
    {state?.result && <AiAnalysisView result={state.result} renderJudgment={incidentCreatedAt && incidentOwner && state.analysisVersion ? index => <HypothesisReview key={`${state.analysisVersion}:${index}`} incidentOwner={incidentOwner} scope={{ incidentId, incidentCreatedAt, analysisVersion: state.analysisVersion!, hypothesisIndex: index }} /> : undefined} />}
    {!readOnly && state?.canGenerate && <>
      <p className="text-xs text-muted-foreground">Uses your DeepSpace credits and sends the saved logs to OpenAI. Remove secrets before saving logs. Up to 10 requests per account per UTC day; no automatic paid retries.</p>
      <Button disabled={!ready || busy} loading={busy} onClick={() => void request('generate')}>
        {busy ? 'Analyzing…' : state.phase === 'failed' ? 'Retry AI analysis' : 'Generate AI analysis'}
      </Button>
    </>}
    {state?.phase !== 'complete' && <Button variant="outline" disabled={busy} onClick={() => void request('status')}>
      {busy ? 'Waiting for response…' : 'Check AI status'}
    </Button>}
  </section>
}

export function AiAnalysisView({ result, renderJudgment }: { result: NonNullable<AiAnalysisState['result']>; renderJudgment?: (index: number) => ReactNode }) {
  return <div className="flex flex-col gap-4 text-sm">
    <p className="text-xs text-muted-foreground">Saved AI result · {result.model} · {new Date(result.generatedAt).toLocaleString('en-US')}</p>
    <div><h3 className="font-medium">Summary</h3><p className="mt-2 whitespace-pre-wrap">{result.summary}</p></div>
    <div><h3 className="font-medium">Log evidence</h3>
      {result.evidence.length ? <ul className="mt-2 space-y-2">{result.evidence.map((item) => <li key={item.line}>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-background p-3">[line {item.line}] {item.quote}</pre>
      </li>)}</ul> : <p className="mt-2">No specific evidence identified.</p>}
    </div>
    <div><h3 className="font-medium">{renderJudgment ? 'AI hypotheses' : 'Possible causes — not confirmed'}</h3>
      {result.hypotheses.length ? <ul className="mt-2 list-disc space-y-2 pl-5">{result.hypotheses.map((item, index) => <li key={index}>
        {item.explanation} <span className="text-muted-foreground">(Evidence lines: {item.evidenceLines.join(', ')})</span>
        {renderJudgment?.(index)}
      </li>)}</ul> : <p className="mt-2">Insufficient evidence to suggest a cause.</p>}
    </div>
    <div><h3 className="font-medium">Suggested checks</h3><ul className="mt-2 list-disc space-y-2 pl-5">
      {result.suggestedChecks.map((check, index) => <li key={index}>{check}</li>)}
    </ul></div>
  </div>
}

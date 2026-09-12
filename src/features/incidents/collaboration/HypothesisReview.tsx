import { useEffect, useId, useRef, useState } from 'react'
import { useMutations, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { z } from 'zod'
import { Button } from '@/components/ui'
import { formatDate } from '../incident-format'
import { assessmentStatus, type AssessmentRequest, type AssessmentScope, type HypothesisAssessment } from './hypothesis-types'
import { investigationAction, InvestigationError } from './investigation-client'

const historyResponse = z.object({ records: z.array(z.object({ recordId: z.string(), createdBy: z.string(), createdAt: z.string(), data: z.object({ sequence: z.number(), status: assessmentStatus, reason: z.string() }) })), hasMore: z.boolean() })
type History = z.infer<typeof historyResponse>

export function HypothesisReview({ scope, incidentOwner }: { scope: AssessmentScope; incidentOwner: string }) {
  const { ready } = useMutations('incident_assessments')
  const { records, status, error: queryError } = useQuery<HypothesisAssessment>('incident_assessments', {
    where: { ...scope, incidentOwner }, orderBy: 'sequence', orderDir: 'desc', limit: 1,
  })
  const { getName } = useUserLookup()
  const latest = status === 'ready' ? records[0] : undefined
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<HypothesisAssessment['status']>('Unverified')
  const [reason, setReason] = useState('')
  const [expected, setExpected] = useState(0)
  const [attempt, setAttempt] = useState<AssessmentRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<History | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const gate = useRef(false)
  const mounted = useRef(true)
  const id = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const conflict = editing && status === 'ready' && expected !== (latest?.data.sequence ?? 0)

  async function save() {
    if (gate.current || !ready || status !== 'ready' || (!attempt && (conflict || !reason.trim() || reason.length > 1000))) return
    gate.current = true; setBusy(true); setError(''); setNotice('')
    const input: AssessmentRequest = attempt ?? { ...scope, intent: 'save', requestId: crypto.randomUUID(), expectedSequence: expected, status: choice, reason: reason.trim() }
    setAttempt(input)
    try {
      await investigationAction('assessHypothesis', input)
      if (mounted.current) { setAttempt(null); setEditing(false); setReason(''); setNotice('Judgment saved.'); setHistory(null) }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : 'Could not confirm saving. Retry this same judgment.')
        if (err instanceof InvestigationError && ['conflict', 'invalid', 'access_denied'].includes(err.code)) setAttempt(null)
      }
    } finally { gate.current = false; if (mounted.current) setBusy(false) }
  }
  async function loadHistory(older = false) {
    if (historyBusy) return
    setHistoryBusy(true); setHistoryError('')
    try {
      const page = historyResponse.parse(await investigationAction('assessHypothesis', { ...scope, intent: 'history',
        ...(older && history?.records.length ? { before: history.records.at(-1)!.data.sequence } : {}),
      }))
      if (mounted.current) setHistory(current => ({ ...page, records: older ? [...(current?.records ?? []), ...page.records] : page.records }))
    } catch (err) { if (mounted.current) setHistoryError(err instanceof Error ? err.message : 'Could not load history.') }
    finally { if (mounted.current) setHistoryBusy(false) }
  }
  function entry(record: Pick<RecordData<HypothesisAssessment>, 'recordId' | 'createdAt' | 'createdBy'> & { data: Pick<HypothesisAssessment, 'status' | 'reason' | 'sequence'> }) {
    return <article key={record.recordId} className="rounded-md border border-border bg-background p-3">
      <p className="font-medium">{record.data.status}</p>
      <p title={`Account ID: ${record.createdBy}`} className="mt-1 text-xs text-muted-foreground">{getName(record.createdBy) ?? record.createdBy} · {formatDate(record.createdAt)} · Revision {record.data.sequence}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{record.data.reason}</p>
    </article>
  }
  return <section aria-label={`Human judgment for hypothesis ${scope.hypothesisIndex + 1}`} className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Investigation judgment</h4>
    {status === 'loading' && <p role="status">Loading judgments…</p>}
    {status === 'error' && <p role="alert">{queryError ?? 'Judgments are unavailable. Reconnect before saving.'}</p>}
    {status === 'ready' && (latest ? entry(latest) : <p>Unverified · No human judgment recorded.</p>)}
    <p className="text-xs text-muted-foreground">A human assessment of this saved AI hypothesis, not proof of the root cause. Changes keep history and are not added to reports or emails.</p>
    {!editing && <Button className="self-start" variant="outline" disabled={!ready || status !== 'ready'} onClick={() => {
      setEditing(true); setExpected(latest?.data.sequence ?? 0); setChoice(latest?.data.status ?? 'Unverified'); setError(''); setNotice('')
    }}>{latest ? 'Update judgment' : 'Record judgment'}</Button>}
    {editing && <form onSubmit={e => { e.preventDefault(); void save() }} className="flex flex-col gap-3">
      <label htmlFor={`${id}-status`} className="font-medium">Judgment</label>
      <select id={`${id}-status`} value={choice} disabled={busy || !!attempt} onChange={e => setChoice(e.target.value as HypothesisAssessment['status'])} className="rounded-md border border-border bg-background p-2">
        {assessmentStatus.options.map(value => <option key={value}>{value}</option>)}
      </select>
      <label htmlFor={`${id}-reason`} className="font-medium">Evidence and reason</label>
      <textarea id={`${id}-reason`} rows={4} value={reason} disabled={busy || !!attempt} onChange={e => setReason(e.target.value)} placeholder="What did you check? Cite log lines, measurements or findings that support this judgment." className="rounded-md border border-border bg-background p-3" />
      <p className={`text-xs ${reason.length > 1000 ? 'text-destructive' : 'text-muted-foreground'}`}>{reason.length}/1,000 characters. Required for every change, including Unverified. Unsaved text is lost on reload.</p>
      {conflict && <div role="alert" className="rounded-md border border-amber-500/40 p-3"><p>A newer judgment is shown above. Review it before saving your reason.</p>
        {!attempt && <Button type="button" variant="outline" className="mt-2" onClick={() => { setExpected(latest?.data.sequence ?? 0); setError('') }}>I reviewed the latest judgment</Button>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ready || status !== 'ready' || busy || (!attempt && (conflict || !reason.trim() || reason.length > 1000))}>{busy ? 'Saving judgment…' : attempt ? 'Retry this judgment' : 'Save judgment'}</Button>
        <Button type="button" variant="outline" disabled={busy || !!attempt} onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
      </div>
      {attempt && !busy && <p className="text-xs">Saving is unconfirmed. Retry sends the same request without duplicating history. Check the latest judgment before reloading.</p>}
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button variant="ghost" className="self-start" disabled={historyBusy || status !== 'ready'} onClick={() => void loadHistory()}>{historyBusy ? 'Loading history…' : history ? 'Refresh judgment history' : 'View judgment history'}</Button>
    {historyError && <p role="alert" className="text-destructive">{historyError}</p>}
    {status === 'ready' && history && <div className="flex flex-col gap-2" aria-label="Judgment history">
      <Button variant="ghost" className="self-start" onClick={() => setHistory(null)}>Hide judgment history</Button>
      {history.records.length ? history.records.map(entry) : <p>No judgments recorded for this hypothesis.</p>}
      {history.hasMore && <Button variant="outline" disabled={historyBusy} onClick={() => void loadHistory(true)}>Load older judgments</Button>}
    </div>}
  </section>
}

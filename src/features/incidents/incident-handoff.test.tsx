import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RecordData } from 'deepspace'
import type { Incident } from './incident-types'
import { loadHandoffResults } from './incident-handoff'
import { HandoffReport } from './IncidentHandoffPreview'
const mocks = vi.hoisted(() => ({ ai: vi.fn(), references: vi.fn(), findings: vi.fn() }))
vi.mock('./collaboration/investigation-client', () => ({ investigationAction: mocks.findings }))
vi.mock('./incident-ai-client', () => ({ requestIncidentAi: mocks.ai }))
vi.mock('./incident-reference-client', () => ({ requestReferences: mocks.references }))
const record = { recordId: 'event', createdAt: '2026-09-11T00:00:00Z', data: { title: 'Timeout', rawLog: '<script>secret</script>', status: 'Pending analysis' } } as RecordData<Incident>
beforeEach(() => vi.resetAllMocks())
it('reads only status and propagates cancellation to both requests', async () => {
  const signal = new AbortController().signal
  mocks.ai.mockResolvedValue({ phase: 'idle', canGenerate: true })
  mocks.references.mockResolvedValue({ phase: 'idle', canSearch: true, query: '' })
  await loadHandoffResults('event', signal)
  expect(mocks.ai).toHaveBeenCalledExactlyOnceWith('event', 'status', signal)
  expect(mocks.references).toHaveBeenCalledExactlyOnceWith('event', 'report', undefined, signal)
})
it('fails instead of presenting a failed read as absent data', async () => {
  mocks.ai.mockRejectedValue(new Error('Access denied'))
  mocks.references.mockResolvedValue({ phase: 'idle', canSearch: true, query: '' })
  await expect(loadHandoffResults('event')).rejects.toThrow('Access denied')
})
it('shows missing and running sections honestly and escapes saved logs', () => {
  const html = renderToStaticMarkup(<HandoffReport record={record} results={{ findings: undefined, ai: { phase: 'running', canGenerate: false }, references: { phase: 'idle', query: '', canSearch: true } }} />)
  expect(html).toContain('Current state: running')
  expect(html).toContain('No completed reference search')
  expect(html).toContain('&lt;script&gt;secret&lt;/script&gt;')
  expect(html).not.toContain('<script>')
})
it('includes saved analysis, evidence and source links without treating local status as AI status', () => {
  const html = renderToStaticMarkup(<HandoffReport record={record} results={{ findings: undefined,
    ai: { phase: 'complete', canGenerate: false, result: { summary: 'Timeout observed', evidence: [{ line: 1, quote: 'timeout' }], hypotheses: [], suggestedChecks: ['Check latency'], model: 'test', generatedAt: '2026-09-11T00:00:00Z' } },
    references: { phase: 'complete', query: 'timeout', canSearch: false, result: { query: 'timeout', searchedAt: '2026-09-11T00:00:00Z', items: [{ title: 'Guide', url: 'https://example.test/guide', excerpt: 'Reference excerpt' }] } },
  }} />)
  expect(html).toContain('Timeout observed')
  expect(html).toContain('[line 1] timeout')
  expect(html).toContain('https://example.test/guide')
  expect(html).toContain('Local analysis status: Pending analysis')
  expect(html).toContain('not a confirmed root-cause report')
})

const snapshot={analysisVersion:'a'.repeat(64),sourceVersion:'b'.repeat(64),capturedAt:'2026-09-12T00:00:00Z',findings:[{hypothesisIndex:0,explanation:'Possible cause',status:'Ruled out' as const,reason:'<script>comparison evidence</script>',actorId:'b',actorName:'Test B',judgedAt:'2026-09-12T00:00:00Z',sequence:2}]}
it('loads findings bound to the displayed AI version and fails closed on a findings read failure',async()=>{
  const signal=new AbortController().signal
  mocks.ai.mockResolvedValue({phase:'complete',analysisVersion:snapshot.analysisVersion,result:{hypotheses:[]}})
  mocks.references.mockResolvedValue({phase:'idle'})
  mocks.findings.mockResolvedValue(snapshot)
  expect((await loadHandoffResults('event',signal)).findings).toEqual(snapshot)
  expect(mocks.findings).toHaveBeenCalledWith('incidentFindings',{incidentId:'event',analysisVersion:snapshot.analysisVersion},signal)
  mocks.findings.mockRejectedValue(new Error('Read unavailable'))
  await expect(loadHandoffResults('event',signal)).rejects.toThrow('Read unavailable')
})
it('renders human findings separately with escaped evidence, actor, time and revision',()=>{
  const html=renderToStaticMarkup(<HandoffReport record={record} results={{findings:snapshot,ai:{phase:'idle',canGenerate:true},references:{phase:'idle',query:'',canSearch:true}}}/>)
  for(const text of ['Investigation findings','Human judgment: Ruled out','Revision 2','Test B (b)','2026-09-12T00:00:00Z','&lt;script&gt;comparison evidence&lt;/script&gt;']) expect(html).toContain(text)
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('Update judgment')
})

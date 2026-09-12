import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HypothesisReview } from './HypothesisReview'
import { ViewerAvatar } from './IncidentViewers'
import { AiAnalysisView } from '../IncidentAiAnalysis'
const query = vi.hoisted(() => ({ status: 'ready', records: [] as unknown[], error: 'Unavailable' }))
vi.mock('deepspace', () => ({ useMutations: () => ({ ready: true }), useQuery: () => query, useUserLookup: () => ({ getName: () => 'Investigator B' }) }))
beforeEach(() => { query.status = 'ready'; query.records = [] })
const render = () => renderToStaticMarkup(<HypothesisReview incidentOwner="a" scope={{ incidentId: 'i', incidentCreatedAt: 'created', analysisVersion: 'a'.repeat(64), hypothesisIndex: 0 }} />)
it('distinguishes an unverified hypothesis from a saved conclusion', () => {
  const html = render()
  expect(html).toContain('Unverified · No human judgment recorded.')
  expect(html).toContain('Record judgment')
  expect(html).not.toContain('Judgment saved.')
})
it('shows attribution and escaped reason, but hides stale data when disconnected', () => {
  query.records = [{ recordId: 'review', createdBy: 'b', createdAt: '2026-09-12T20:00:00Z', data: { sequence: 3, status: 'Ruled out', reason: '<script>unsafe</script>' } }]
  let html = render()
  expect(html).toContain('Investigator B'); expect(html).toContain('Revision 3'); expect(html).toContain('&lt;script&gt;')
  query.status = 'error'; html = render()
  expect(html).not.toContain('Investigator B'); expect(html).not.toContain('unsafe')
})
it('keeps standalone report analysis free of judgment controls', () => {
  const html = renderToStaticMarkup(<AiAnalysisView result={{ model: 'test', generatedAt: '2026-09-12', summary: 'Test', evidence: [], hypotheses: [{ explanation: 'Hypothesis', evidenceLines: [] }], suggestedChecks: [] }} />)
  expect(html).toContain('Hypothesis'); expect(html).not.toContain('Record judgment'); expect(html).not.toContain('Investigation judgment')
})
it('labels avatars and falls back to initials when there is no profile image', () => {
  const html = renderToStaticMarkup(<ViewerAvatar viewer={{ userId: 'b', name: 'Test Person' }} self={false} />)
  expect(html).toContain('Test Person · Viewing this incident'); expect(html).toContain('TP'); expect(html).not.toContain('<img')
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { requestIncidentAi } from './incident-ai-client'
import { AiAnalysisView, IncidentAiAnalysis } from './IncidentAiAnalysis'

const auth = vi.hoisted(() => vi.fn())
vi.mock('deepspace', () => ({ getAuthToken: auth, useMutations: () => ({ ready: true }) }))
const fetchMock = vi.fn()
beforeEach(() => { auth.mockResolvedValue('fake-token'); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('AI action client', () => {
  it('sends only incident identity and intent using the authenticated action', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, data: { phase: 'idle', canGenerate: true } }))
    await requestIncidentAi('event', 'status')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/actions/analyzeIncident')
    expect(options.headers.Authorization).toBe('Bearer fake-token')
    expect(JSON.parse(options.body)).toEqual({ incidentId: 'event', intent: 'status' })
  })
  it('never retries a rejected or disconnected generation', async () => {
    fetchMock.mockRejectedValue(new Error('Disconnected'))
    await expect(requestIncidentAi('event', 'generate')).rejects.toThrow('Disconnected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not send a request when signed out', async () => {
    auth.mockResolvedValue(null)
    await expect(requestIncidentAi('event', 'generate')).rejects.toThrow('Sign in')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects a success response that lacks the completed analysis', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, data: { phase: 'complete', canGenerate: false } }))
    await expect(requestIncidentAi('event', 'status')).rejects.toThrow('Unexpected analysis response')
  })
  it('shows an actionable server failure', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: false, error: 'This incident is unavailable.' }, { status: 403 }))
    await expect(requestIncidentAi('event', 'generate')).rejects.toThrow('This incident is unavailable.')
  })
})

describe('AI analysis display', () => {
  it('starts by reading status; rendering never invokes a paid call', () => {
    const html = renderToStaticMarkup(<IncidentAiAnalysis incidentId="event" />)
    expect(html).toContain('Loading AI analysis')
    expect(html).not.toContain('Generate AI analysis')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('separates evidence and hypotheses and safely escapes model text', () => {
    const html = renderToStaticMarkup(<AiAnalysisView result={{
      summary: '<script>alert(1)</script>', model: 'test', generatedAt: '2026-09-11T00:00:00Z',
      evidence: [{ line: 3, quote: '  timeout  ' }],
      hypotheses: [{ explanation: 'A dependency may be slow.', evidenceLines: [3] }], suggestedChecks: ['Check latency.'],
    }} />)
    expect(html).toContain('Possible causes — not confirmed')
    expect(html).toContain('[line 3]   timeout  ')
    expect(html).toContain('Suggested checks')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

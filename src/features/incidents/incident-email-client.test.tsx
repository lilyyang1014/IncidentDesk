import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { requestEmail } from './incident-email-client'
import { IncidentEmail } from './IncidentEmail'
vi.mock('deepspace', () => ({ getAuthToken: async () => 'caller' }))
afterEach(() => vi.unstubAllGlobals())
it('sends explicit confirmation with draft ID and no email body', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { draft: null, phase: 'idle' } }))
  vi.stubGlobal('fetch', fetcher)
  await requestEmail('event', { intent: 'send', draftId: 'a'.repeat(64), confirmed: true })
  expect(fetcher.mock.calls[0]).toMatchObject(['/api/actions/incidentEmail', { body: JSON.stringify({ incidentId: 'event', intent: 'send', draftId: 'a'.repeat(64), confirmed: true }) }])
})
it('does not automatically retry or continue after an OAuth response', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { draft: null, phase: 'oauth', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' } }))
  vi.stubGlobal('fetch', fetcher)
  expect((await requestEmail('event', { intent: 'status' })).phase).toBe('oauth')
  expect(fetcher).toHaveBeenCalledOnce()
})
it('does not retry on transport failure', async () => {
  const fetcher = vi.fn(async () => { throw new Error('lost response') })
  vi.stubGlobal('fetch', fetcher)
  await expect(requestEmail('event', { intent: 'send', draftId: 'a'.repeat(64), confirmed: true })).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledOnce()
})
it('initial UI exposes no send confirmation and does not call a provider during render', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const html = renderToStaticMarkup(<IncidentEmail incidentId="event" title="Incident" />)
  expect(html).toContain('Prepare email draft')
  expect(html).not.toContain('Confirm send email')
  expect(html).toContain('AI evidence may include log excerpts')
  expect(fetcher).not.toHaveBeenCalled()
})

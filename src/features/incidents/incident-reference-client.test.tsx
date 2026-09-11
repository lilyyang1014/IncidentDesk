import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { requestReferences } from './incident-reference-client'
import { IncidentReferences, ReferenceResults } from './IncidentReferences'
const auth = vi.hoisted(() => vi.fn())
vi.mock('deepspace', () => ({ getAuthToken: auth, useMutations: () => ({ ready: true }) }))
const fetchMock = vi.fn()
beforeEach(() => { auth.mockResolvedValue('fake'); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())
it('sends only incident, intent and chosen query', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { phase: 'idle', query: 'timeout', canSearch: true } }))
  await requestReferences('event', 'status', 'timeout')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/actions/findIncidentReferences')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ incidentId: 'event', intent: 'status', query: 'timeout' })
})
it('does not request while signed out and never retries a disconnect', async () => {
  auth.mockResolvedValueOnce(null)
  await expect(requestReferences('event', 'search', 'timeout')).rejects.toThrow('Sign in')
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockRejectedValue(new Error('Disconnected'))
  await expect(requestReferences('event', 'search', 'timeout')).rejects.toThrow('Disconnected')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('rejects unsafe links even in a server success', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { phase: 'complete', canSearch: false, query: 'timeout', result: {
    query: 'timeout', searchedAt: '2026-09-11', items: [{ title: 'Bad', url: 'javascript:alert(1)', excerpt: '' }],
  } } }))
  await expect(requestReferences('event', 'status')).rejects.toThrow()
})
it('initial rendering offers no enabled paid action', () => {
  const html = renderToStaticMarkup(<IncidentReferences incidentId="event" />)
  expect(html).toContain('Loading saved references')
  expect(html).toContain('Only this query is sent to Exa')
  expect(fetchMock).not.toHaveBeenCalled()
})
it('renders excerpts as plain text and links safely in a new tab', () => {
  const html = renderToStaticMarkup(<ReferenceResults result={{ query: 'timeout', searchedAt: '2026-09-11', items: [
    { title: '<script>test</script>', url: 'https://example.test/docs', excerpt: '<img src=x onerror=alert(1)>' },
  ] }} />)
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img ')
  expect(html).toContain('noopener noreferrer')
})
it('makes zero-result success explicit', () => {
  expect(renderToStaticMarkup(<ReferenceResults result={{ query: 'timeout', searchedAt: '2026-09-11', items: [] }} />)).toContain('No references found')
})

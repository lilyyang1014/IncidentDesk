import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IncidentList } from './IncidentList'
import { fetchIncidentPage } from './incident-list-client'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }))
vi.mock('deepspace', () => ({ getAuthToken: mocks.auth, useQuery: mocks.query }))
const fetchMock = vi.fn()
const entry = { recordId: 'private', createdAt: '2026-09-12T10:00:00.000Z', createdBy: 'b' }
const record = { ...entry, updatedAt: entry.createdAt, data: { title: 'Private source title', rawLog: 'private evidence', status: 'Pending analysis', collaborators: ['a'] } }
beforeEach(() => { mocks.auth.mockResolvedValue('test-token'); mocks.query.mockReturnValue({ records: [record], status: 'ready' }); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

it('sends only the selected view and cursor through the authenticated action', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { entries: [entry], nextCursor: null } }))
  const cursor = { ...entry, userId: 'a', view: 'shared' as const }
  await fetchIncidentPage('shared', cursor, new AbortController().signal)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/actions/listIncidents')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ view: 'shared', cursor })
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
})
it('does not fetch while signed out and does not automatically retry errors', async () => {
  mocks.auth.mockResolvedValueOnce(null)
  await expect(fetchIncidentPage('mine', null, new AbortController().signal)).rejects.toThrow('Sign in')
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockResolvedValue(Response.json({ success: false, error: 'Unavailable' }, { status: 503 }))
  await expect(fetchIncidentPage('mine', null, new AbortController().signal)).rejects.toThrow('Unavailable')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('rejects malformed or oversized page responses', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { entries: Array.from({length:21},()=>entry), nextCursor: null } }))
  await expect(fetchIncidentPage('mine', null, new AbortController().signal)).rejects.toThrow()
})

function render(view: 'mine' | 'shared' = 'shared') {
  return renderToStaticMarkup(<IncidentList userId="a" disabled={false} onOpen={vi.fn()} result={{ entries: [entry], cursor: null, status: 'ready', loadingMore: false, error: null, view, selectView: vi.fn(), refresh: vi.fn(), loadMore: vi.fn(), refreshMine: vi.fn() }} />)
}
it('hydrates cards by exact identity and displays a verified shared incident', () => {
  expect(render()).toContain('Private source title')
  expect(mocks.query).toHaveBeenCalledWith('incidents', { where: { recordId: entry.recordId }, limit: 1 })
})
it.each(['loading', 'error'])('never displays cached private content while access is %s', status => {
  mocks.query.mockReturnValue({ records: [record], status })
  expect(render()).not.toContain('Private source title')
})
it('hides revoked membership even when an admin can still read the record', () => {
  mocks.query.mockReturnValue({ records: [{ ...record, data: { ...record.data, collaborators: [] } }], status: 'ready' })
  expect(render()).not.toContain('Private source title')
})
it('does not substitute a new incident incarnation or another owner in My incidents', () => {
  expect(render('mine')).not.toContain('Private source title')
  mocks.query.mockReturnValue({ records: [{ ...record, createdAt: '2026-09-13T00:00:00.000Z' }], status: 'ready' })
  expect(render()).not.toContain('Private source title')
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { RecordData } from 'deepspace'
import type { Incident } from './incident-types'
import IncidentsPage from '@/pages/(app)/(protected)/incidents'

const hooks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('deepspace', () => ({
  useQuery: hooks.query,
  useAuthProfileReady: () => ({ user: { id: 'user-a', email: 'a@example.test', role: 'member' } }),
  useUserLookup: () => ({ getEmail: () => null, getName: () => null }),
  useMutations: () => ({ ready: true, createConfirmed: vi.fn(), putConfirmed: vi.fn() }),
}))

function record(index: number): RecordData<Incident> {
  return {
    recordId: `incident-${index}`,
    createdBy: 'user-a',
    createdAt: '2026-09-10T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    data: { title: `Incident number ${index}`, rawLog: `Original log ${index}`, status: 'Pending analysis' },
  }
}
const accessibleRecords = Array.from({ length: 51 }, (_, index) => record(51 - index))
type QueryOptions = { where?: { recordId: string }; limit?: number }
function render(url: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><IncidentsPage /></MemoryRouter>)
}

beforeEach(() => {
  hooks.query.mockReset()
  // Simulate already-authorized SDK responses, not the server's RBAC engine.
  hooks.query.mockImplementation((_collection: string, options: QueryOptions) => ({
    status: 'ready',
    records: accessibleRecords.filter((row) => !options.where || row.recordId === options.where.recordId).slice(0, options.limit),
  }))
})

describe('incident detail query rendering', () => {
  it('opens an older record outside the latest 50 using an independent ID query', () => {
    expect(accessibleRecords.slice(0, 50).some((row) => row.recordId === 'incident-1')).toBe(false)
    const html = render('/incidents?incidentId=incident-1')
    expect(html).toContain('Incident number 1')
    expect(html).toContain('Original log 1')
    expect(html).not.toContain('could not be found')
    expect(hooks.query).toHaveBeenCalledWith('incidents', { where: { recordId: 'incident-1' }, limit: 1 })
  })

  it('keeps the list limited to 50 and does not subscribe to a detail without an ID', () => {
    const html = render('/incidents')
    expect(html).toContain('Incident number 51')
    expect(html).not.toContain('Original log 1</')
    expect(hooks.query).toHaveBeenCalledTimes(1)
    expect(hooks.query).toHaveBeenCalledWith('incidents', { orderBy: 'createdAt', orderDir: 'desc', limit: 50 })
  })

  it('loads the requested URL on a fresh mount and reads a different ID on another mount', () => {
    expect(render('/incidents?incidentId=incident-1')).toContain('Original log 1')
    const html = render('/incidents?incidentId=incident-2')
    expect(html).toContain('Original log 2')
    expect(html).not.toContain('Original log 1')
  })

  it('does not let a list query failure prevent an available detail from rendering', () => {
    hooks.query.mockImplementation((_collection: string, options: QueryOptions) => options.where
      ? { status: 'ready', records: [record(1)] }
      : { status: 'error', error: 'List unavailable', records: [] })
    const html = render('/incidents?incidentId=incident-1')
    expect(html).toContain('Original log 1')
    expect(html).not.toContain('List unavailable')
  })

  it('shows loading without incorrectly reporting not found', () => {
    hooks.query.mockReturnValue({ status: 'loading', records: [] })
    const html = render('/incidents?incidentId=incident-1')
    expect(html).toContain('Loading incident details')
    expect(html).not.toContain('could not be found')
  })

  it('shows a read error without a loading message or stale record contents', () => {
    hooks.query.mockReturnValue({ status: 'error', error: 'Could not load incident details.', records: [record(1)] })
    const html = render('/incidents?incidentId=incident-1')
    expect(html).toContain('Could not load incident details.')
    expect(html).not.toContain('Loading incident details')
    expect(html).not.toContain('Original log 1')
  })

  it.each(['missing-record', 'inaccessible-record'])('renders the same generic empty response for %s', (id) => {
    const html = render(`/incidents?incidentId=${id}`)
    expect(html).toContain('This incident could not be found in the records available to your account.')
    expect(html).toContain('Back to incidents')
    expect(html).not.toContain('Original log')
  })

  it('never substitutes an unrelated record for the requested ID', () => {
    hooks.query.mockReturnValue({ status: 'ready', records: [record(2)] })
    const html = render('/incidents?incidentId=incident-1')
    expect(html).not.toContain('Original log 2')
    expect(html).toContain('could not be found')
  })
})

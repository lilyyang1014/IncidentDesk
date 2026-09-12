import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import type { ReferenceState } from '../features/incidents/incident-reference-types'
import { IncidentReferenceRoom } from './incident-reference-room'
import { registerActionRoutes } from './action-routes'
import { Hono } from 'hono'
import type { AppContext } from '../../worker'

const mocks = vi.hoisted(() => ({ verify: vi.fn(), member: vi.fn(), api: vi.fn() }))
vi.mock('deepspace/worker', () => ({
  verifyJwt: mocks.verify, resolveAppMembership: mocks.member, apiWorkerFetch: mocks.api, normalizeApiError: vi.fn(),
}))

let record: { recordId: string; createdBy: string; createdAt: string; data: { title: string; rawLog: string; collaborators?: string[] } }
let room: IncidentReferenceRoom
let recordFetch: ReturnType<typeof vi.fn>
let env: Env
let values: Map<string, unknown>
function request(intent = 'search', incidentId = 'incident-1', token = 'fake-caller', query = 'timeout') {
  return room.fetch(new Request('https://internal/references', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ intent, incidentId, ...(intent === 'search' ? { query } : {}) }),
  }))
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  record = { recordId: 'incident-1', createdBy: 'user-a', createdAt: '2026-09-11', data: { title: 'Timeout', rawLog: 'request timed out' } }
  mocks.verify.mockResolvedValue({ result: { userId: 'user-a' } })
  mocks.member.mockResolvedValue({ member: true, role: 'member' })
  recordFetch = vi.fn(async (_request: Request) => Response.json({ success: true, data: { record } }))
  env = { RECORD_ROOMS: { idFromName: (name: string) => name, get: () => ({ fetch: recordFetch }) },
    DEEPSPACE_APP_ID: 'test-app', APP_IDENTITY_TOKEN: 'fake-app-identity' } as unknown as Env
  values = new Map<string, unknown>()
  const storage = { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value) },
    transaction: async <T,>(work: (tx: unknown) => Promise<T>) => work(storage) }
  room = new IncidentReferenceRoom({ storage } as unknown as DurableObjectState, env)
  mocks.api.mockImplementation(async () => Response.json({ success: true, data: { results: [{ title: 'Timeout guide', url: 'https://example.test/timeout', text: 'Check latency.' }] } }))
})

describe('authenticated reference search boundary', () => {
  it('rejects invalid identity before reading data or calling the provider', async () => {
    mocks.verify.mockResolvedValue({ result: null })
    expect((await request()).status).toBe(401)
    expect(recordFetch).not.toHaveBeenCalled()
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('requires app membership and fails closed if membership lookup fails', async () => {
    for (const membership of [null, { member: false, role: 'member' }]) {
      mocks.member.mockResolvedValue(membership)
      expect((await request()).status).toBeGreaterThanOrEqual(400)
    }
    expect(recordFetch).not.toHaveBeenCalled()
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('blocks another creator for both status and search', async () => {
    record.createdBy = 'someone-else'
    expect((await request('status')).status).toBe(403)
    expect((await request()).status).toBe(403)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('permits an admin and persists output independently from local rule analysis', async () => {
    record.createdBy = 'someone-else'
    mocks.member.mockResolvedValue({ member: true, role: 'admin' })
    const body = await (await request()).json() as { data: { phase: string } }
    expect(body.data.phase).toBe('complete')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    const status = await (await request('status')).json() as { data: { result: { query: string } } }
    expect(status.data.result.query).toBe('timeout')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    for (const [req] of recordFetch.mock.calls) {
      expect(await (req as Request).json()).toMatchObject({ tool: 'records.get', params: { collection: 'incidents' } })
    }
  })
  it('shares saved output without granting provider operations or changing its cache identity', async () => {
    await request()
    record.data.collaborators = ['user-b']
    mocks.verify.mockResolvedValue({ result: { userId: 'user-b' } })
    const shared = await (await request('report')).json()
    expect(shared).toMatchObject({ success: true, data: { phase: 'complete', canSearch: false } })
    expect(shared).toMatchObject({ data: { result: expect.any(Object) } })
    expect((await request()).status).toBe(403)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    record.data.collaborators = []
    expect((await request('report')).status).toBe(403)
  })
  it('withholds saved output if collaboration is revoked during the read', async () => {
    await request()
    record.data.collaborators = ['user-b']
    mocks.verify.mockResolvedValue({ result: { userId: 'user-b' } })
    recordFetch.mockImplementationOnce(async () => Response.json({ success: true, data: { record } }))
      .mockImplementationOnce(async () => {
        record.data.collaborators = []
        return Response.json({ success: true, data: { record } })
      })
    expect((await request('report')).status).toBe(409)
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })
  it('does not call a provider on status reads', async () => {
    expect(await (await request('status')).json()).toEqual({ success: true, data: { query: '', phase: 'idle', canSearch: true } })
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it.each(['', '  ', 'x'.repeat(20001)])('rejects invalid saved logs before invoking a provider', async (rawLog) => {
    record.data.rawLog = rawLog
    expect((await request()).status).toBeGreaterThanOrEqual(400)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('never accepts client-provided model, logs, role or billing', async () => {
    const response = await room.fetch(new Request('https://internal/references', { method: 'POST', headers: { Authorization: 'Bearer fake' },
      body: JSON.stringify({ incidentId: 'incident-1', intent: 'search', model: 'other', rawLog: 'spoofed', role: 'admin', billing: 'developer' }) }))
    expect(response.status).toBe(400)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it.each([undefined, '', '  ', 'ab', 'x'.repeat(301)])('rejects an invalid query before provider invocation', async (query) => {
    const response = await room.fetch(new Request('https://internal/references', { method: 'POST', headers: { Authorization: 'Bearer fake' },
      body: JSON.stringify({ incidentId: 'incident-1', intent: 'search', query }) }))
    expect(response.status).toBe(400)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('does not expose a stale completion after logs change during the call', async () => {
    mocks.api.mockImplementationOnce(async () => {
      record = { ...record, data: { ...record.data, rawLog: 'Changed logs' } }
      return Response.json({ success: true, data: { results: [] } })
    })
    expect((await request()).status).toBe(409)
  })
  it('rechecks access after the call', async () => {
    mocks.member.mockResolvedValueOnce({ member: true, role: 'member' }).mockResolvedValueOnce({ member: false, role: 'member' })
    expect((await request()).status).toBe(409)
  })
  it('does not reuse a result when the saved input changes', async () => {
    await request()
    record.data.title = 'Updated title'
    expect(await (await request('status')).json()).toEqual({ success: true, data: { query: '', phase: 'idle', canSearch: true } })
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })
})

describe('public action dispatch', () => {
  it('rejects unauthenticated callers without reaching the reference room', async () => {
    const app = new Hono<AppContext>()
    registerActionRoutes(app, async () => null)
    expect((await app.request('/api/actions/findIncidentReferences', { method: 'POST', body: '{}' }, env)).status).toBe(401)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it('does not treat inherited names as actions', async () => {
    const app = new Hono<AppContext>()
    registerActionRoutes(app, async () => ({ userId: 'user-a', claims: { sub: 'user-a' } }))
    expect((await app.request('/api/actions/constructor', { method: 'POST', headers: { Authorization: 'Bearer fake' }, body: '{}' }, env)).status).toBe(404)
  })
})

async function stateResponse(response: Promise<Response>) {
  return (await (await response).json()) as { data: ReferenceState }
}
describe('report reference selection', () => {
  it('keeps A after B is rate-limited, then uses B only after success', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
    await request()
    const denied = await stateResponse(request('search', 'incident-1', 'fake-caller', 'database'))
    expect(denied.data.error).toContain('Wait one minute')
    expect((await stateResponse(request('status'))).data.query).toBe('database')
    expect((await stateResponse(request('report'))).data.result?.query).toBe('timeout')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(170000)
    await request('search', 'incident-1', 'fake-caller', 'database')
    expect((await stateResponse(request('report'))).data.result?.query).toBe('database')
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })
  it.each([400, 502])('keeps A when B returns HTTP %s', async (status) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
    await request()
    clock.mockReturnValue(170000)
    mocks.api.mockResolvedValueOnce(new Response('', { status }))
    await request('search', 'incident-1', 'fake-caller', 'database')
    expect((await stateResponse(request('status'))).data.phase).toBe(status === 400 ? 'failed' : 'unknown')
    expect((await stateResponse(request('report'))).data.result?.query).toBe('timeout')
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })
  it('treats successful empty results as the latest success and isolates changed incidents', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
    await request()
    clock.mockReturnValue(170000)
    mocks.api.mockResolvedValueOnce(Response.json({ success: true, data: { results: [] } }))
    await request('search', 'incident-1', 'fake-caller', 'database')
    expect((await stateResponse(request('report'))).data.result).toMatchObject({ query: 'database', items: [] })
    record.data.title = 'Changed'
    expect((await stateResponse(request('report'))).data.phase).toBe('idle')
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })
})

it('preserves a completed legacy selection before a denied new search', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(100000)
  await request()
  for (const key of values.keys()) if (key.startsWith('latest-success:')) values.delete(key)
  await request('search', 'incident-1', 'fake-caller', 'database')
  expect((await stateResponse(request('report'))).data.result?.query).toBe('timeout')
  expect(mocks.api).toHaveBeenCalledTimes(1)
})
it('keeps the successful report while the latest attempt is still running', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  await request()
  clock.mockReturnValue(170000)
  let finish!: (response: Response) => void
  mocks.api.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  const pending = request('search', 'incident-1', 'fake-caller', 'database')
  await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
  expect((await stateResponse(request('status'))).data.phase).toBe('running')
  expect((await stateResponse(request('report'))).data.result?.query).toBe('timeout')
  finish(Response.json({ success: true, data: { results: [] } }))
  await pending
  expect((await stateResponse(request('report'))).data.result?.query).toBe('database')
})

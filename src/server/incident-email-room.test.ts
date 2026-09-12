import { beforeEach, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { IncidentEmailRoom } from './incident-email-room'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), member: vi.fn(), api: vi.fn() }))
vi.mock('deepspace/worker', () => ({ verifyJwt: mocks.verify, resolveAppMembership: mocks.member, apiWorkerFetch: mocks.api, normalizeApiError: vi.fn() }))
let room: IncidentEmailRoom
let record: { recordId: string; createdBy: string; createdAt: string; data: { title: string; rawLog: string } }
let statusCalls: ReturnType<typeof vi.fn<(req: Request) => Promise<Response>>>
function request(input: object) {
  return room.fetch(new Request('https://internal/email', { method: 'POST', headers: { Authorization: 'Bearer caller' }, body: JSON.stringify({ incidentId: 'event', ...input }) }))
}
const prepare = { intent: 'prepare', to: 'recipient@example.test', subject: 'Incident handoff', includeLogs: false }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.verify.mockResolvedValue({ result: { userId: 'user-a' } })
  mocks.member.mockResolvedValue({ member: true, role: 'member' })
  mocks.api.mockImplementation(async () => Response.json({ success: true, data: { id: 'gmail-id' } }))
  record = { recordId: 'event', createdBy: 'user-a', createdAt: '2026-09-11', data: { title: 'Timeout', rawLog: 'Sensitive raw log' } }
  const values = new Map<string, unknown>()
  const storage = { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value) }, transaction: async <T,>(work: (tx: unknown) => Promise<T>) => work(storage) }
  statusCalls = vi.fn(async (req: Request) => {
    expect(await req.json()).toEqual({ incidentId: 'event', intent: new URL(req.url).pathname === '/references' ? 'report' : 'status' })
    return Response.json({ success: true, data: { phase: 'idle', canSearch: true, query: '' } })
  })
  const namespace = (fetcher: (req: Request) => Promise<Response>) => ({ idFromName: (name: string) => name, get: () => ({ fetch: fetcher }) })
  const env = { AUTH_JWT_PUBLIC_KEY: '', AUTH_JWT_ISSUER: '', APP_IDENTITY_TOKEN: 'fake', DEEPSPACE_APP_ID: 'test',
    RECORD_ROOMS: namespace(async () => Response.json({ success: true, data: { record } })),
    INCIDENT_AI_ROOMS: namespace(statusCalls), INCIDENT_REFERENCE_ROOMS: namespace(statusCalls),
  } as unknown as Env
  room = new IncidentEmailRoom({ storage } as unknown as DurableObjectState, env)
})
it('prepares only from saved server data and restores without sending', async () => {
  const body = await (await request(prepare)).json() as { data: { draft: { content: string } } }
  expect(body.data.draft.content).not.toContain('Sensitive raw log')
  expect(statusCalls).toHaveBeenCalledTimes(2)
  expect(mocks.api).not.toHaveBeenCalled()
  expect((await request({ intent: 'status' })).status).toBe(200)
  expect(mocks.api).not.toHaveBeenCalled()
})
it('requires membership and ownership before assembling a draft', async () => {
  record.createdBy = 'someone-else'
  expect((await request(prepare)).status).toBe(503)
  expect(statusCalls).not.toHaveBeenCalled()
  expect(mocks.api).not.toHaveBeenCalled()
})
it('rejects a changed incident before sending the reviewed draft', async () => {
  const prepared = await (await request(prepare)).json() as { data: { draft: { id: string } } }
  record.data.rawLog = 'Updated logs'
  expect((await request({ intent: 'send', draftId: prepared.data.draft.id, confirmed: true })).status).toBe(409)
  expect(mocks.api).not.toHaveBeenCalled()
})
it('blocks a saved draft from another caller even if the caller is admin', async () => {
  const prepared = await (await request(prepare)).json() as { data: { draft: { id: string } } }
  mocks.verify.mockResolvedValue({ result: { userId: 'other-admin' } })
  mocks.member.mockResolvedValue({ member: true, role: 'admin' })
  expect((await request({ intent: 'send', draftId: prepared.data.draft.id, confirmed: true })).status).toBe(403)
  expect(mocks.api).not.toHaveBeenCalled()
})
it('does not replace a failed result read with an empty report', async () => {
  statusCalls.mockResolvedValue(new Response('', { status: 503 }))
  expect((await request(prepare)).status).toBe(503)
  expect(mocks.api).not.toHaveBeenCalled()
})
it('sends the saved content and never substitutes client body', async () => {
  const prepared = await (await request(prepare)).json() as { data: { draft: { id: string; content: string } } }
  const sent = await request({ intent: 'send', draftId: prepared.data.draft.id, confirmed: true })
  expect(sent.status).toBe(200)
  expect(JSON.parse(mocks.api.mock.calls[0][2].body).content).toBe(prepared.data.draft.content)
  expect((await request({ intent: 'send', draftId: prepared.data.draft.id, confirmed: true, content: 'injected' })).status).toBe(400)
  expect(mocks.api).toHaveBeenCalledOnce()
})

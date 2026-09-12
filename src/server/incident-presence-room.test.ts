import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { IncidentPresenceRoom } from './incident-presence-room'
const mocks = vi.hoisted(() => ({ userId: 'a', now: 100000, collaborators: ['b'], member: true }))
vi.mock('deepspace/worker', () => ({
  PresenceRoom: class { protected env: unknown; constructor(_state: unknown, env: unknown) { this.env = env } fetch() { return new Response('generic') } },
  verifyJwt: async () => ({ result: { userId: mocks.userId, claims: { name: `User ${mocks.userId}`, email: 'private@example.test', image: 'https://example.test/avatar.png' } } }),
  resolveAppMembership: async () => ({ member: mocks.member, role: 'member' }),
}))
vi.mock('./action-routes', () => ({ createActionTools: () => ({ get: async () => ({ success: true, data: { record: { recordId: 'i', createdBy: 'a', createdAt: 'created', data: { collaborators: mocks.collaborators } } } }) }) }))
beforeEach(() => { mocks.userId = 'a'; mocks.now = 100000; mocks.collaborators = ['b']; mocks.member = true; vi.spyOn(Date, 'now').mockImplementation(() => mocks.now) })
afterEach(() => vi.restoreAllMocks())
const create = () => new IncidentPresenceRoom({} as DurableObjectState, {} as Env)
async function request(room: IncidentPresenceRoom, userId: string, sessionId = crypto.randomUUID(), intent = 'heartbeat') {
  mocks.userId = userId
  const res = await room.fetch(new Request('https://internal/incident-viewers', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ incidentId: 'i', incidentCreatedAt: 'created', sessionId, intent }) }))
  return { status: res.status, body: await res.json() as { success: boolean; data: { viewers: { userId: string }[] } } }
}
it('expires a disconnected viewer at 30 seconds without persistent writes', async () => {
  const room = create(), a = crypto.randomUUID(), b = crypto.randomUUID()
  await request(room, 'a', a)
  mocks.now += 29999
  expect((await request(room, 'b', b)).body.data.viewers).toHaveLength(2)
  mocks.now++
  expect((await request(room, 'b', b)).body.data.viewers.map(p => p.userId)).toEqual(['b'])
})
it('caps one account at four tabs so it cannot consume every slot', async () => {
  const room = create()
  for (let i = 0; i < 4; i++) expect((await request(room, 'a')).status).toBe(200)
  expect((await request(room, 'a')).status).toBe(429)
  expect((await request(room, 'b')).body.data.viewers).toHaveLength(2)
})
it('removes revoked peers from snapshots and refuses their heartbeat', async () => {
  const room = create()
  await request(room, 'b')
  mocks.collaborators = []
  expect((await request(room, 'a')).body.data.viewers.map(p => p.userId)).toEqual(['a'])
  expect((await request(room, 'b')).status).toBe(403)
})
it('requires app membership and exposes only public identity fields', async () => {
  const room = create()
  const result = await request(room, 'a')
  expect(JSON.stringify(result)).not.toContain('private@example.test')
  mocks.member = false
  expect((await request(room, 'a')).status).toBe(403)
})

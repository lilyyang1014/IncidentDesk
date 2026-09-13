import { afterEach, expect, it, vi } from 'vitest'
import { handleInvitation, hasPendingInvitation, INVITATION_LIFETIME_MS, revokeAcceptedInvitation } from './incident-invitations'
import { invitationRequest, type InvitationRequest } from '../features/incidents/collaboration/invitation-types'
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = await import(sqliteModule)
const databases: { close(): void }[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  const sql = { exec(statement: string, ...args: (string | number)[]) {
    const rows = db.prepare(statement).all(...args)
    return { toArray: () => rows }
  } } as unknown as SqlStorage
  const record = { recordId: 'incident', createdAt: '2026-09-13', createdBy: 'a', data: { collaborators: [] as string[] } }
  const source = { incidentId: record.recordId, incidentCreatedAt: record.createdAt, incidentOwner: record.createdBy }
  let interruption: 'before' | 'after' | null = null
  let exists = true
  const tool = vi.fn(async (_user: string, name: string, params: Record<string, unknown>) => {
    if (name === 'records.get') return exists ? { success: true as const, data: { record } } : { success: false as const, error: 'Record not found' }
    const user = (params.data as { userId: string }).userId
    if (interruption !== 'before') record.data.collaborators.push(user)
    if (interruption) { interruption = null; throw new Error('Simulated crash') }
    return { success: true as const, data: { recordId: params.recordId } }
  })
  const refresh = vi.fn()
  const call = (input: InvitationRequest, user = 'a', email: string | null = null, now = 100000) => handleInvitation(input, { userId: user, claims: { sub: user, email: `${user}@example.test` } }, email, tool, sql, refresh, now)
  const create = (email = 'b@example.test', expectedId: string | null = null, requestId = crypto.randomUUID()) => ({ intent: 'create' as const, incidentId: source.incidentId, incidentCreatedAt: source.incidentCreatedAt, email, expectedId, requestId })
  const status = () => call({ intent: 'status', incidentId: source.incidentId, incidentCreatedAt: source.incidentCreatedAt })
  return { db, sql, record, source, tool, refresh, call, create, status, interrupt: (when: 'before' | 'after') => { interruption = when }, removeParent: () => { exists = false } }
}
const data = async (response: Response) => (await response.json() as { data: { invitation: { token: string; phase: string; email: string } } }).data.invitation

it('creates before the recipient registers, restores the link, and deduplicates identical creation', async () => {
  const f = fixture(), input = f.create()
  const invitation = await data(await f.call(input))
  expect(invitation.token).toMatch(/^[a-f0-9]{64}$/)
  expect(invitation.phase).toBe('pending')
  expect(await data(await f.status())).toEqual(invitation)
  expect(await data(await f.call(input))).toEqual(invitation)
  expect(f.tool.mock.calls.every(([, name]) => name === 'records.get')).toBe(true)
  expect(hasPendingInvitation(f.sql, f.source, 100000)).toBe(true)
  expect((await f.call({ ...input, email: 'c@example.test' })).status).toBe(409)
})
it('enforces creator ownership, incarnation binding and the pending member reservation', async () => {
  const f = fixture()
  expect((await f.call(f.create(), 'admin')).status).toBe(403)
  expect((await f.call({ ...f.create(), incidentCreatedAt: 'stale' })).status).toBe(403)
  expect((await f.call(f.create('a@example.test'))).status).toBe(409)
  const invitation = await data(await f.call(f.create()))
  expect((await f.call(f.create('c@example.test', invitation.token))).status).toBe(409)
  expect((await f.call({ intent: 'cancel', incidentId: 'incident', incidentCreatedAt: '2026-09-13', token: invitation.token }, 'b')).status).toBe(403)
})
it('requires exact verified mailbox, explicit acceptance and never leaks source to another identity', async () => {
  const f = fixture(), invitation = await data(await f.call(f.create()))
  const inspect = { intent: 'inspect' as const, token: invitation.token }
  f.tool.mockClear()
  for (const email of [null, 'c@example.test', 'b+alias@example.test']) expect((await f.call(inspect, 'b', email)).status).toBe(403)
  expect(f.tool).not.toHaveBeenCalled()
  expect((await f.call(inspect, 'b', 'b@example.test')).status).toBe(200)
  expect(f.record.data.collaborators).toEqual([])
  expect(invitationRequest.safeParse({ intent: 'accept', token: invitation.token }).success).toBe(false)
  expect(invitationRequest.safeParse({ intent: 'accept', token: invitation.token, confirmed: true, userId: 'b' }).success).toBe(false)
  expect(invitationRequest.safeParse({ intent: 'create', ...f.source, email: 'invalid', expectedId: null, requestId: crypto.randomUUID() }).success).toBe(false)
  const input = { intent: 'accept' as const, token: invitation.token, confirmed: true as const }
  expect((await data(await f.call(input, 'b', 'b@example.test'))).phase).toBe('accepted')
  expect((await data(await f.call(input, 'b', 'b@example.test'))).phase).toBe('accepted')
  expect(f.record.data.collaborators).toEqual(['b'])
  expect(f.tool.mock.calls.filter(([, name]) => name === 'records.create')).toHaveLength(1)
  // Reassigned mailbox cannot replay an already bound invitation as a new user.
  expect((await f.call(input, 'c', 'b@example.test')).status).toBe(403)
})
it('cancels, expires and rejects old tokens after replacement', async () => {
  const f = fixture(), invitation = await data(await f.call(f.create()))
  const inspect = { intent: 'inspect' as const, token: invitation.token }
  expect((await data(await f.call(inspect, 'b', 'b@example.test', 100000 + INVITATION_LIFETIME_MS))).phase).toBe('expired')
  const cancel = { intent: 'cancel' as const, incidentId: 'incident', incidentCreatedAt: '2026-09-13', token: invitation.token }
  expect((await data(await f.call(cancel))).phase).toBe('cancelled')
  expect((await f.call({ intent: 'accept', token: invitation.token, confirmed: true }, 'b', 'b@example.test')).status).toBe(409)
  expect((await f.call(f.create('c@example.test', invitation.token))).status).toBe(429)
  const next = await data(await f.call(f.create('c@example.test', invitation.token), 'a', null, 160000))
  expect(next.token).not.toBe(invitation.token)
  expect((await f.call(inspect, 'b', 'b@example.test')).status).toBe(403)
  expect((await f.call(cancel)).status).toBe(409)
})
it.each(['before', 'after'] as const)('recovers a crash %s membership persistence through the same invitation', async when => {
  const f = fixture(), invitation = await data(await f.call(f.create()))
  const accept = { intent: 'accept' as const, token: invitation.token, confirmed: true as const }
  f.interrupt(when)
  await expect(f.call(accept, 'b', 'b@example.test')).rejects.toThrow('Simulated crash')
  expect((await data(await f.status())).phase).toBe(when === 'before' ? 'accepting' : 'accepted')
  expect((await data(await f.call(accept, 'b', 'b@example.test'))).phase).toBe('accepted')
  expect(f.record.data.collaborators).toEqual(['b'])
  revokeAcceptedInvitation(f.sql, f.source, 'b')
  f.record.data.collaborators = []
  expect((await f.call(accept, 'b', 'b@example.test')).status).toBe(409)
  expect(f.record.data.collaborators).toEqual([])
})
it('removal invalidates an interrupted acceptance before it can recreate membership', async () => {
  const f = fixture(), invitation = await data(await f.call(f.create()))
  const accept = { intent: 'accept' as const, token: invitation.token, confirmed: true as const }
  f.interrupt('after')
  await expect(f.call(accept, 'b', 'b@example.test')).rejects.toThrow()
  revokeAcceptedInvitation(f.sql, f.source, 'b')
  f.record.data.collaborators = []
  expect((await f.call(accept, 'b', 'b@example.test')).status).toBe(409)
})
it('rejects a deleted/recreated source and an occupied slot at acceptance', async () => {
  const f = fixture(), invitation = await data(await f.call(f.create()))
  const accept = { intent: 'accept' as const, token: invitation.token, confirmed: true as const }
  f.record.data.collaborators = ['c']
  expect((await f.call(accept, 'b', 'b@example.test')).status).toBe(409)
  f.record.data.collaborators = []
  f.record.createdAt = 'recreated'
  expect((await f.call(accept, 'b', 'b@example.test')).status).toBe(403)
  f.removeParent()
  expect((await f.call(accept, 'b', 'b@example.test')).status).toBe(403)
})
it('bounds stored history and enforces the persistent per-account daily creation quota', async () => {
  const f = fixture()
  let token: string | null = null
  for (let i = 0; i < 10; i++) {
    const now = 100000 + i * 60000
    const invitation = await data(await f.call(f.create('b@example.test', token), 'a', null, now))
    token = invitation.token
    await f.call({ intent: 'cancel', incidentId: 'incident', incidentCreatedAt: '2026-09-13', token }, 'a', null, now)
  }
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM incident_invitations').get().n).toBe(1)
  expect((await f.call(f.create('b@example.test', token), 'a', null, 1000000)).status).toBe(429)
  expect((await f.call(f.create('b@example.test', token), 'a', null, 86400000)).status).toBe(200)
})

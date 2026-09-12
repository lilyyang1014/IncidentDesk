import { beforeEach, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { sendGmail } from './incident-email-provider'
import { sendStoredEmail, presentEmail, type EmailStorage, type StoredEmail } from './incident-email-store'
import { formatEmailReport } from './incident-email-content'
import { emailRequest } from '../actions/incident-email'
import { integrationBilling } from '../integrations'
const api = vi.hoisted(() => vi.fn())
vi.mock('deepspace/worker', () => ({ apiWorkerFetch: api }))
const draft = { id: 'a'.repeat(64), to: 'recipient@example.test', subject: 'Handoff', content: 'Exact reviewed body', includeLogs: false, createdAt: '2026-09-11' }
const env = { APP_IDENTITY_TOKEN: 'test-identity', DEEPSPACE_APP_ID: 'test-app' } as Env
function storage() {
  const values = new Map<string, unknown>()
  let queue = Promise.resolve()
  const tx = { get: async (key: string) => structuredClone(values.get(key)), put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)) } }
  return { ...tx, put: vi.fn(tx.put), transaction: <T,>(work: (transaction: typeof tx) => Promise<T>) => { const next = queue.then(() => work(tx)); queue = next.then(() => {}, () => {}); return next } } as unknown as EmailStorage
}
const entry: StoredEmail = { draft, userId: 'user', source: 'source', incidentId: 'event', attempts: 0 }
beforeEach(() => api.mockReset())
it('sends only the saved payload, with caller identity', async () => {
  api.mockResolvedValue(Response.json({ success: true, data: { id: 'gmail-message' } }))
  expect(await sendGmail(env, 'caller-token', draft)).toEqual({ phase: 'accepted', messageId: 'gmail-message' })
  expect(api.mock.calls[0][1]).toBe('/api/integrations/google/gmail-send')
  expect(api.mock.calls[0][2].headers.Authorization).toBe('Bearer caller-token')
  expect(JSON.parse(api.mock.calls[0][2].body)).toEqual({ to: draft.to, subject: draft.subject, content: draft.content })
})
it('returns OAuth as a separate state without automatically retrying', async () => {
  api.mockResolvedValue(Response.json({ success: true, data: { requiresOAuth: true, provider: 'google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' } }))
  expect(await sendGmail(env, 'caller', draft)).toMatchObject({ phase: 'oauth' })
  expect(api).toHaveBeenCalledTimes(1)
})
it.each(['https://evil.test/auth', 'javascript:alert(1)', 'https://accounts.google.com.evil.test'])('blocks untrusted authorization URL %s', async (authUrl) => {
  api.mockResolvedValue(Response.json({ success: true, data: { requiresOAuth: true, provider: 'google', authUrl } }))
  expect((await sendGmail(env, 'caller', draft)).phase).toBe('unknown')
})
it.each([500, 502, 408])('blocks automatic retry for HTTP %s, including token-refresh failure', async (status) => {
  api.mockResolvedValue(new Response('Token refresh failed', { status }))
  expect((await sendGmail(env, 'caller', draft)).phase).toBe('unknown')
  expect(api).toHaveBeenCalledOnce()
})
it('treats malformed success and transport loss as unknown', async () => {
  api.mockResolvedValueOnce(Response.json({ success: true, data: {} })).mockRejectedValueOnce(new Error('Disconnected'))
  expect((await sendGmail(env, 'caller', draft)).phase).toBe('unknown')
  expect((await sendGmail(env, 'caller', draft)).phase).toBe('unknown')
})
it('rejects insufficient credits explicitly without retry', async () => {
  api.mockResolvedValue(new Response('', { status: 402 }))
  expect(await sendGmail(env, 'caller', draft)).toMatchObject({ phase: 'failed', error: expect.stringContaining('credits') })
})
it('requires a single recipient and explicit confirmation; prevents body injection and generic send bypass', () => {
  expect(emailRequest.safeParse({ intent: 'send', incidentId: 'event', draftId: draft.id }).success).toBe(false)
  expect(emailRequest.safeParse({ intent: 'send', incidentId: 'event', draftId: draft.id, confirmed: true, content: 'changed' }).success).toBe(false)
  expect(emailRequest.safeParse({ intent: 'prepare', incidentId: 'event', to: 'a@test.com,b@test.com', subject: 'x', includeLogs: false }).success).toBe(false)
  expect(integrationBilling('google/gmail-send')).toBe(null)
})
it('claims once across simultaneous requests and preserves acceptance on later attempts', async () => {
  const s = storage(); await s.put('draft', entry)
  let finish!: (value: { phase: 'accepted'; messageId: string }) => void
  const call = vi.fn(() => new Promise<{ phase: 'accepted'; messageId: string }>((resolve) => { finish = resolve }))
  const first = sendStoredEmail(s, 'draft', 'user', call, 100000)
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
  expect((await sendStoredEmail(s, 'draft', 'user', call, 100000)).phase).toBe('sending')
  finish({ phase: 'accepted', messageId: 'id' }); await first
  expect((await sendStoredEmail(s, 'draft', 'user', call, 300000)).phase).toBe('accepted')
  expect(call).toHaveBeenCalledOnce()
})
it('OAuth remains unsent until a separate confirmed call and enforces cooldown', async () => {
  const s = storage(); await s.put('draft', entry)
  const call = vi.fn().mockResolvedValueOnce({ phase: 'oauth', authUrl: 'https://accounts.google.com/auth' }).mockResolvedValue({ phase: 'accepted', messageId: 'id' })
  expect((await sendStoredEmail(s, 'draft', 'user', call, 100000)).phase).toBe('oauth')
  expect(presentEmail(await s.get<StoredEmail>('draft')).phase).toBe('oauth')
  expect(call).toHaveBeenCalledOnce()
  await sendStoredEmail(s, 'draft', 'user', call, 100100)
  expect(call).toHaveBeenCalledOnce()
  expect((await sendStoredEmail(s, 'draft', 'user', call, 170000)).phase).toBe('accepted')
})
it('preserves a blocked receipt after loss of the final storage acknowledgement', async () => {
  const s = storage(); await s.put('draft', entry)
  vi.mocked(s.put).mockRejectedValueOnce(new Error('disk'))
  const call = vi.fn(async () => ({ phase: 'accepted' as const, messageId: 'id' }))
  await expect(sendStoredEmail(s, 'draft', 'user', call, 100000)).rejects.toThrow()
  expect((await sendStoredEmail(s, 'draft', 'user', call, 300000)).phase).toBe('unknown')
  expect(call).toHaveBeenCalledOnce()
})
it('caps failed attempts, blocks other users and never retries unknown outcomes', async () => {
  const s = storage(); await s.put('draft', entry)
  const call = vi.fn(async () => ({ phase: 'failed' as const, error: 'rejected' }))
  await expect(sendStoredEmail(s, 'draft', 'someone-else', call)).rejects.toThrow()
  for (let i = 0; i < 4; i++) await sendStoredEmail(s, 'draft', 'user', call, 100000 + i * 70000)
  expect(call).toHaveBeenCalledTimes(3)
  await s.put('draft', { ...entry, outcome: { phase: 'unknown', error: 'lost' } })
  expect((await sendStoredEmail(s, 'draft', 'user', call)).phase).toBe('unknown')
  expect(call).toHaveBeenCalledTimes(3)
})
it('excludes full logs by default and includes them only when selected', () => {
  const record = { recordId: 'event', createdAt: 'date', data: { title: 'Incident', rawLog: 'private raw log' } }
  expect(formatEmailReport(record, undefined, undefined, false)).not.toContain('private raw log')
  expect(formatEmailReport(record, undefined, undefined, true)).toContain('private raw log')
  expect(formatEmailReport(record, undefined, undefined, false)).toContain('No completed AI analysis')
})

it('allows repeated OAuth cycles then delivery without consuming draft send attempts', async () => {
  const s = storage(); await s.put('draft', { ...entry, oauthAttempts: 0 })
  const call = vi.fn().mockResolvedValue({ phase: 'oauth', authUrl: 'https://accounts.google.com/auth' })
  for (let i = 0; i < 4; i++) {
    expect((await sendStoredEmail(s, 'draft', 'user', call, 100000 + i * 70000)).phase).toBe('oauth')
  }
  expect(await s.get<StoredEmail>('draft')).toMatchObject({ attempts: 0, oauthAttempts: 4 })
  call.mockResolvedValue({ phase: 'accepted', messageId: 'id' })
  expect((await sendStoredEmail(s, 'draft', 'user', call, 400000)).phase).toBe('accepted')
  await sendStoredEmail(s, 'draft', 'user', call, 500000)
  expect(call).toHaveBeenCalledTimes(5)
  expect(await s.get<StoredEmail>('draft')).toMatchObject({ attempts: 1, oauthAttempts: 4 })
})
it('keeps the daily request quota for OAuth responses across drafts', async () => {
  const s = storage(); await s.put('draft', entry); await s.put('other', entry)
  const call = vi.fn(async () => ({ phase: 'oauth' as const, authUrl: 'https://accounts.google.com/auth' }))
  for (let i = 0; i < 10; i++) await sendStoredEmail(s, 'draft', 'user', call, 100000 + i * 70000)
  expect((await sendStoredEmail(s, 'other', 'user', call, 900000)).error).toContain('maximum ten')
  expect(call).toHaveBeenCalledTimes(10)
  expect((await sendStoredEmail(s, 'draft', 'user', call, 86400000 + 100000)).phase).toBe('oauth')
  expect(call).toHaveBeenCalledTimes(11)
})
it('refunds only the last proven legacy OAuth attempt once, preserving earlier failures', async () => {
  const s = storage()
  await s.put('draft', { ...entry, attempts: 3, outcome: { phase: 'oauth', authUrl: 'https://accounts.google.com/auth' } })
  const call = vi.fn(async () => ({ phase: 'failed' as const, error: 'rejected' }))
  expect((await sendStoredEmail(s, 'draft', 'user', call, 100000)).phase).toBe('failed')
  expect(await s.get<StoredEmail>('draft')).toMatchObject({ attempts: 3, oauthAttempts: 1 })
  await sendStoredEmail(s, 'draft', 'user', call, 200000)
  expect(call).toHaveBeenCalledOnce()
})
it('retains the send reservation if persisting an OAuth outcome fails', async () => {
  const s = storage(); await s.put('draft', { ...entry, oauthAttempts: 0 })
  vi.mocked(s.put).mockRejectedValueOnce(new Error('disk'))
  const call = vi.fn(async () => ({ phase: 'oauth' as const, authUrl: 'https://accounts.google.com/auth' }))
  await expect(sendStoredEmail(s, 'draft', 'user', call, 100000)).rejects.toThrow('disk')
  expect(await s.get<StoredEmail>('draft')).toMatchObject({ attempts: 1, oauthAttempts: 0 })
  expect((await sendStoredEmail(s, 'draft', 'user', call, 300000)).phase).toBe('unknown')
  expect(call).toHaveBeenCalledOnce()
})

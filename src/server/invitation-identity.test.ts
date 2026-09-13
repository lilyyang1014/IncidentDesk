import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { invitationSessionCookie, verifiedInvitationEmail } from './invitation-identity'
const fetchAuth = vi.hoisted(() => vi.fn())
vi.mock('deepspace/worker', () => ({ authWorkerFetch: fetchAuth, SESSION_COOKIE: '__Secure-better-auth.session_token' }))
const cookie = '__Secure-better-auth.session_token=synthetic-session'
const auth = { userId: 'b', claims: { sub: 'b', email: 'untrusted-profile@example.test' } }
let session: { user: { id: string; email: string; emailVerified: boolean }; session: { userId: string; expiresAt: string } }
beforeEach(() => {
  vi.resetAllMocks()
  session = { user: { id: 'b', email: ' B@Example.test ', emailVerified: true }, session: { userId: 'b', expiresAt: new Date(Date.now() + 60000).toISOString() } }
  fetchAuth.mockImplementation(async () => Response.json(session))
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network disabled') }))
})
afterEach(() => vi.unstubAllGlobals())
it('uses only an authenticated live verified session and binds its subject to the JWT', async () => {
  expect(await verifiedInvitationEmail({} as Env, auth, cookie)).toBe('b@example.test')
  expect(fetchAuth).toHaveBeenCalledWith({}, '/api/auth/get-session?disableCookieCache=true&disableRefresh=true', expect.objectContaining({ headers: { Cookie: cookie }, redirect: 'manual' }))
})
it.each(['unverified', 'other-user', 'other-session', 'expired', 'invalid-email', 'failure', 'malformed', 'network'])('fails closed for %s identity', async kind => {
  if (kind === 'unverified') session.user.emailVerified = false
  if (kind === 'other-user') session.user.id = 'a'
  if (kind === 'other-session') session.session.userId = 'a'
  if (kind === 'expired') session.session.expiresAt = '2000-01-01T00:00:00.000Z'
  if (kind === 'invalid-email') session.user.email = 'invalid'
  if (kind === 'failure') fetchAuth.mockImplementation(async () => Response.json(session, { status: 401 }))
  if (kind === 'malformed') fetchAuth.mockImplementation(async () => Response.json({ user: { ...session.user, emailVerified: 'true' } }))
  if (kind === 'network') fetchAuth.mockRejectedValue(new Error('Private provider details'))
  await expect(verifiedInvitationEmail({} as Env, auth, cookie)).rejects.toThrow(/verified email|Could not verify/)
})
it('requires a session cookie and strips unrelated cookies', async () => {
  expect(invitationSessionCookie(`other=secret; ${cookie}; cache=private`)).toBe(cookie)
  expect(invitationSessionCookie(`${cookie}; ${cookie}`)).toBeNull()
  expect(invitationSessionCookie(null)).toBeNull()
  await expect(verifiedInvitationEmail({} as Env, auth, null)).rejects.toThrow('Sign in again')
  expect(fetchAuth).not.toHaveBeenCalled()
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { requestInvitation } from './invitation-client'
import { invitationEmail, invitationFromHash, invitationLink } from './invitation-types'
import { forgetInvitation, recalledInvitation, rememberInvitation } from './invitation-resume'
import { InvitationAcceptance } from './InvitationAcceptance'
const mocks = vi.hoisted(() => ({ token: vi.fn(), signedIn: false }))
vi.mock('deepspace', () => ({ getAuthToken: mocks.token, useAuth: () => ({ isSignedIn: mocks.signedIn, userId: 'a' }), useMutations: () => ({ ready: true }), AuthOverlay: () => null }))
const token = 'a'.repeat(64)
beforeEach(() => {
  vi.resetAllMocks(); mocks.signedIn = false
  mocks.token.mockResolvedValue('synthetic-jwt')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { invitation: { token, email: 'b@example.test', phase: 'pending', incidentId: 'incident', expiresAt: 200000 } } })))
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('uses an authenticated same-origin POST without recipient claims supplied by the browser', async () => {
  await requestInvitation({ intent: 'accept', token, confirmed: true })
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith('/api/incident-invitations', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: { Authorization: 'Bearer synthetic-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'accept', token, confirmed: true }) }))
})
it.each(['network', 'malformed', 'rejected'])('never automatically retries %s outcomes', async outcome => {
  if (outcome === 'network') vi.mocked(fetch).mockRejectedValue(new Error('Disconnected'))
  if (outcome === 'malformed') vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, data: { invitation: { token: 'invalid' } } }))
  if (outcome === 'rejected') vi.mocked(fetch).mockResolvedValue(Response.json({ success: false, error: 'Wrong account' }, { status: 403 }))
  await expect(requestInvitation({ intent: 'accept', token, confirmed: true })).rejects.toThrow()
  expect(fetch).toHaveBeenCalledOnce()
})
it('refuses signed-out requests before network access', async () => {
  mocks.token.mockResolvedValue(null)
  await expect(requestInvitation({ intent: 'inspect', token })).rejects.toThrow('Sign in again')
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps tokens in the fragment, rejects malformed links, and preserves mailbox aliases', () => {
  const link = new URL(invitationLink('https://incidentdesk.app.space', token))
  expect(link.search).toBe(''); expect(link.pathname).toBe('/invite')
  expect(invitationFromHash(link.hash)).toBe(token)
  expect(invitationFromHash('#token=../incidents')).toBeNull()
  expect(invitationFromHash('')).toBeNull()
  expect(invitationEmail.parse(' B+Tag@Example.test ')).toBe('b+tag@example.test')
  expect(invitationEmail.parse('b.c@example.test')).toBe('b.c@example.test')
})
it('retains a bounded OAuth return hint and removes it after use or expiry', () => {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  rememberInvitation(token); expect(recalledInvitation()).toBe(token)
  forgetInvitation(); expect(recalledInvitation()).toBeNull()
  rememberInvitation(token); vi.setSystemTime(100000 + 31 * 60000)
  expect(recalledInvitation()).toBeNull()
  expect(recalledInvitation()).toBeNull()
})
it('handles blocked browser storage without breaking the invitation page', () => {
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
  expect(() => rememberInvitation(token)).not.toThrow()
  expect(recalledInvitation()).toBeNull()
  expect(() => forgetInvitation()).not.toThrow()
})
it('shows first-time sign-in and no incident data or accept action before authentication', () => {
  const html = renderToStaticMarkup(<MemoryRouter><InvitationAcceptance token={token} /></MemoryRouter>)
  expect(html).toContain('Sign in to review invitation')
  expect(html).toContain('Signing in alone does not grant access')
  expect(html).not.toContain('Accept invitation</button>')
  expect(html).not.toContain('b@example.test')
  expect(fetch).not.toHaveBeenCalled()
})
it('renders invalid-link guidance without opening authentication or making requests', () => {
  const html = renderToStaticMarkup(<MemoryRouter><InvitationAcceptance token={null} /></MemoryRouter>)
  expect(html).toContain('invitation link is incomplete')
  expect(html).not.toContain('Sign in to review invitation')
  expect(fetch).not.toHaveBeenCalled()
})

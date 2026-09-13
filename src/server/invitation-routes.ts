import type { Hono } from 'hono'
import type { AppContext } from '../../worker'
import { resolveAuth } from './http-routes'
import { invitationSessionCookie } from './invitation-identity'
import { invitationRequest } from '../features/incidents/collaboration/invitation-types'

export function registerInvitationRoutes(app: Hono<AppContext>) {
  app.post('/api/incident-invitations', async c => {
    c.header('Cache-Control', 'no-store')
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth || auth.userId.startsWith('anon-')) return c.json({ success: false, error: 'Sign in to manage invitations.' }, 401)
    // Bound the actual stream, including chunked requests; no unbounded json().
    const reader = c.req.raw.body?.getReader()
    if (!reader) return c.json({ success: false, error: 'Invalid invitation request.' }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 4096) { await reader.cancel(); return c.json({ success: false, error: 'Invitation request is too large.' }, 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    let json: unknown
    try { json = JSON.parse(new TextDecoder().decode(bytes)) } catch { return c.json({ success: false, error: 'Invalid invitation request.' }, 400) }
    const input = invitationRequest.safeParse(json)
    if (!input.success) return c.json({ success: false, error: 'Enter a valid email or invitation link.' }, 400)
    const headers = new Headers({ Authorization: c.req.header('Authorization')!, 'Content-Type': 'application/json' })
    const cookie = invitationSessionCookie(c.req.header('Cookie') ?? null)
    if (cookie) headers.set('Cookie', cookie)
    const room = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.DEEPSPACE_APP_ID}`))
    const response = await room.fetch(new Request('https://internal/incident-invitations', { method: 'POST', headers, body: JSON.stringify(input.data) }))
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  })
}

import { PresenceRoom, resolveAppMembership, verifyJwt } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { createActionTools } from './action-routes'
import { incidentCapabilities } from '../features/incidents/incident-permissions'
import { VIEWER_TTL_MS, viewerRequest, type IncidentViewer } from '../features/incidents/collaboration/viewer-types'

type Lease = IncidentViewer & { expiresAt: number }

/** Per-incident ephemeral leases, separate from durable investigation records.
 * The SDK's open generic presence socket is not an incident access boundary.
 * This internal action path checks access on each bounded snapshot instead.
 * Heap eviction loses only avatars; the next heartbeat reconstructs them.
 */
export class IncidentPresenceRoom extends PresenceRoom<Env> {
  private leases = new Map<string, Lease>()
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/incident-viewers') return super.fetch(request)
    const fail = (error: string, status = 403) => Response.json({ success: false, error }, { status })
    if (request.method !== 'POST') return fail('Not found.', 404)
    try {
      const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
      const { result: auth } = await verifyJwt({ publicKey: this.env.AUTH_JWT_PUBLIC_KEY, issuer: this.env.AUTH_JWT_ISSUER }, jwt)
      if (!auth || auth.userId.startsWith('anon-')) return fail('Sign in required.', 401)
      const parsed = viewerRequest.safeParse(await request.json())
      if (!parsed.success) return fail('Invalid presence request.', 400)
      const input = parsed.data
      const now = Date.now()
      for (const [key, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(key)
      const key = `${auth.userId}:${input.sessionId}`
      if (input.intent === 'leave') {
        this.leases.delete(key)
        return Response.json({ success: true, data: { viewers: [] } })
      }
      const tools = createActionTools(this.env, auth.userId, jwt)
      // Resolve live roles, never preserve an admin role in a lease.
      const roles = new Map<string, string>()
      for (const userId of new Set([auth.userId, ...Array.from(this.leases.values(), lease => lease.userId)])) {
        const membership = await resolveAppMembership(this.env, userId)
        if (!membership) return fail('Presence could not be refreshed.', 503)
        if (membership.member) roles.set(userId, membership.role)
      }
      const found = await tools.get('incidents', input.incidentId)
      const record = z.object({ recordId: z.string(), createdAt: z.string(), createdBy: z.string(), data: z.object({ collaborators: z.array(z.string()).optional() }) }).safeParse(found.data?.record)
      if (!found.success || !record.success || record.data.createdAt !== input.incidentCreatedAt
        || !roles.has(auth.userId) || !incidentCapabilities(record.data, auth.userId, roles.get(auth.userId)!).read) {
        for (const [id, lease] of this.leases) if (lease.userId === auth.userId) this.leases.delete(id)
        return fail('This incident is unavailable to your account.')
      }
      for (const [id, lease] of this.leases) {
        if (!roles.has(lease.userId) || !incidentCapabilities(record.data, lease.userId, roles.get(lease.userId)!).read) this.leases.delete(id)
      }
      const ownTabs = Array.from(this.leases.values()).filter(lease => lease.userId === auth.userId).length
      if (!this.leases.has(key) && (ownTabs >= 4 || this.leases.size >= 12)) return fail('Too many viewing tabs for this incident. Close an extra tab.', 429)
      const image = auth.claims.image
      this.leases.set(key, { userId: auth.userId, name: auth.claims.name?.slice(0, 200) || 'Registered user',
        ...(image && /^https:\/\//i.test(image) ? { image } : {}), expiresAt: Date.now() + VIEWER_TTL_MS })
      const viewers = Array.from(new Map(Array.from(this.leases.values(), ({ expiresAt: _expiresAt, ...viewer }) => [viewer.userId, viewer])).values())
      return Response.json({ success: true, data: { viewers } })
    } catch { return fail('Presence could not be refreshed.', 503) }
  }
}

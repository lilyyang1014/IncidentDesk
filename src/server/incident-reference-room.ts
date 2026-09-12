import { resolveAppMembership, verifyJwt } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { referenceRequest } from '../actions/find-incident-references'
import { createActionTools } from './action-routes'
import { searchReferences } from './incident-reference-provider'
import { runStoredReferences } from './incident-reference-store'

const incidentRecord = z.object({
  recordId: z.string(), createdBy: z.string().min(1), createdAt: z.string(),
  data: z.object({ title: z.string().min(1).max(120), rawLog: z.string().min(1).max(20000) }),
})

export class IncidentReferenceRoom {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status })
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/references') return fail('Not found.', 404)
    try {
      const header = request.headers.get('Authorization') ?? ''
      const jwt = header.startsWith('Bearer ') ? header.slice(7) : ''
      if (!jwt) return fail('Sign in required.', 401)
      const { result: auth } = await verifyJwt({ publicKey: this.env.AUTH_JWT_PUBLIC_KEY, issuer: this.env.AUTH_JWT_ISSUER }, jwt)
      if (!auth || auth.userId.startsWith('anon-')) return fail('Sign in required.', 401)
      const input = referenceRequest.safeParse(await request.json())
      if (!input.success) return fail('Invalid reference request.')
      const membership = await resolveAppMembership(this.env, auth.userId)
      if (!membership) return fail('Could not verify your access. Try again later.', 503)
      if (!membership.member) return fail('This incident is unavailable to your account.', 403)
      const tools = createActionTools(this.env, auth.userId, jwt)
      const found = await tools.get('incidents', input.data.incidentId)
      const parsed = incidentRecord.safeParse(found.success ? found.data?.record : null)
      if (!parsed.success || parsed.data.recordId !== input.data.incidentId) return fail('This incident is unavailable or its logs exceed the supported limits.', 404)
      const record = parsed.data
      if (record.createdBy !== auth.userId && membership.role !== 'admin') return fail('This incident is unavailable to your account.', 403)
      if (!record.data.title.trim() || !record.data.rawLog.trim()) return fail('A title and nonblank original logs are required.')
      const identity = JSON.stringify([record.recordId, record.createdAt, record.createdBy, record.data.title, record.data.rawLog])
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const lastKey = `latest:${hash}`
      const successKey = `latest-success:${hash}`
      const receiptKey = async (query: string) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query))
        const queryHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
        return `references:v1:${hash}:${queryHash}`
      }
      // Preserve a completed legacy selection before a new attempt replaces it.
      const previousQuery = await this.ctx.storage.get<string>(lastKey)
      if (previousQuery && !await this.ctx.storage.get<string>(successKey)) {
        const previous = await runStoredReferences(this.ctx.storage, await receiptKey(previousQuery), auth.userId, previousQuery, false,
          () => searchReferences(this.env, jwt, previousQuery))
        if (previous.phase === 'complete') await this.ctx.storage.transaction(async (tx) => {
          if (!await tx.get(successKey)) await tx.put(successKey, previousQuery)
        })
      }
      const query = input.data.intent === 'report'
        ? await this.ctx.storage.get<string>(successKey) ?? previousQuery ?? ''
        : input.data.query ?? previousQuery ?? ''
      // The attempt pointer still supports refresh and interrupted-request recovery.
      if (input.data.intent === 'search') await this.ctx.storage.put(lastKey, query)
      const state = await runStoredReferences(this.ctx.storage, await receiptKey(query), auth.userId, query, input.data.intent === 'search',
        () => searchReferences(this.env, jwt, query), Date.now(), successKey)
      // Re-check access and input after a potentially slow provider response.
      // A changed/deleted record must not receive stale analysis in the UI.
      const currentMembership = await resolveAppMembership(this.env, auth.userId)
      const current = await tools.get('incidents', record.recordId)
      const latest = incidentRecord.safeParse(current.success ? current.data?.record : null)
      if (!currentMembership?.member || !latest.success
        || (latest.data.createdBy !== auth.userId && currentMembership.role !== 'admin')
        || JSON.stringify([latest.data.recordId, latest.data.createdAt, latest.data.createdBy, latest.data.data.title, latest.data.data.rawLog]) !== identity) {
        return fail('The incident or your access changed. Reopen its details.', 409)
      }
      return Response.json({ success: true, data: state })
    } catch {
      return fail('Could not confirm the search state. Check status before trying again.', 503)
    }
  }
}

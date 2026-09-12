import { incidentCapabilities } from '../features/incidents/incident-permissions'
import { resolveAppMembership, verifyJwt } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { analysisRequest } from '../actions/analyze-incident'
import { createActionTools } from './action-routes'
import { generateAiAnalysis } from './incident-ai-provider'
import { runStoredAnalysis } from './incident-ai-store'

const incidentRecord = z.object({
  recordId: z.string(), createdBy: z.string().min(1), createdAt: z.string(),
  data: z.object({ collaborators: z.array(z.string()).optional(), title: z.string().min(1).max(120), rawLog: z.string().min(1).max(20000) }),
})

export class IncidentAiRoom {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status })
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/analysis') return fail('Not found.', 404)
    try {
      const header = request.headers.get('Authorization') ?? ''
      const jwt = header.startsWith('Bearer ') ? header.slice(7) : ''
      if (!jwt) return fail('Sign in required.', 401)
      const { result: auth } = await verifyJwt({ publicKey: this.env.AUTH_JWT_PUBLIC_KEY, issuer: this.env.AUTH_JWT_ISSUER }, jwt)
      if (!auth || auth.userId.startsWith('anon-')) return fail('Sign in required.', 401)
      const input = analysisRequest.safeParse(await request.json())
      if (!input.success) return fail('Invalid analysis request.')
      const membership = await resolveAppMembership(this.env, auth.userId)
      if (!membership) return fail('Could not verify your access. Try again later.', 503)
      if (!membership.member) return fail('This incident is unavailable to your account.', 403)
      const tools = createActionTools(this.env, auth.userId, jwt)
      const found = await tools.get('incidents', input.data.incidentId)
      const parsed = incidentRecord.safeParse(found.success ? found.data?.record : null)
      if (!parsed.success || parsed.data.recordId !== input.data.incidentId) return fail('This incident is unavailable or its logs exceed the supported limits.', 404)
      const record = parsed.data
      const capability = incidentCapabilities(record, auth.userId, membership.role)
      if (!capability.read || (input.data.intent === 'generate' && !capability.operate)) return fail('This incident is unavailable to your account.', 403)
      if (!record.data.title.trim() || !record.data.rawLog.trim()) return fail('A title and nonblank original logs are required.')
      const identity = JSON.stringify([record.recordId, record.createdAt, record.createdBy, record.data.title, record.data.rawLog])
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const state = await runStoredAnalysis(this.ctx.storage, `analysis:v1:${hash}`, auth.userId, input.data.intent === 'generate',
        () => generateAiAnalysis(this.env, jwt, record.data.title, record.data.rawLog))
      // Re-check access and input after a potentially slow provider response.
      // A changed/deleted record must not receive stale analysis in the UI.
      const currentMembership = await resolveAppMembership(this.env, auth.userId)
      const current = await tools.get('incidents', record.recordId)
      const latest = incidentRecord.safeParse(current.success ? current.data?.record : null)
      if (!currentMembership?.member || !latest.success
        || !incidentCapabilities(latest.data, auth.userId, currentMembership.role).read
        || JSON.stringify([latest.data.recordId, latest.data.createdAt, latest.data.createdBy, latest.data.data.title, latest.data.data.rawLog]) !== identity) {
        return fail('The incident or your access changed. Reopen its details.', 409)
      }
      return Response.json({ success: true, data: { ...state, canGenerate: state.canGenerate && incidentCapabilities(latest.data, auth.userId, currentMembership.role).operate } })
    } catch {
      return fail('Could not confirm the analysis state. Check status before trying again.', 503)
    }
  }
}

import { incidentCapabilities } from '../features/incidents/incident-permissions'
import { resolveAppMembership, verifyJwt } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { emailRequest } from '../actions/incident-email'
import { emailDraftSchema } from '../features/incidents/incident-email-types'
import { referenceStateSchema } from '../features/incidents/incident-reference-types'
import { createActionTools } from './action-routes'
import { formatEmailReport } from './incident-email-content'
import { presentEmail, sendStoredEmail, type StoredEmail } from './incident-email-store'
import { sendGmail } from './incident-email-provider'

const recordSchema = z.object({ recordId: z.string(), createdBy: z.string(), createdAt: z.string(), data: z.object({ title: z.string().trim().min(1).max(120), rawLog: z.string().min(1).max(20000) }) })
const aiSchema = z.object({ phase: z.string(), result: z.object({ summary: z.string(), model: z.string(), generatedAt: z.string(), evidence: z.array(z.object({ line: z.number(), quote: z.string() })), hypotheses: z.array(z.object({ explanation: z.string(), evidenceLines: z.array(z.number()) })), suggestedChecks: z.array(z.string()) }).optional() })
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export class IncidentEmailRoom {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}
  async fetch(request: Request): Promise<Response> {
    const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status })
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/email') return fail('Not found.', 404)
    try {
      const token = request.headers.get('Authorization') ?? ''
      const jwt = token.startsWith('Bearer ') ? token.slice(7) : ''
      if (!jwt) return fail('Sign in required.', 401)
      const { result: auth } = await verifyJwt({ publicKey: this.env.AUTH_JWT_PUBLIC_KEY, issuer: this.env.AUTH_JWT_ISSUER }, jwt)
      if (!auth || auth.userId.startsWith('anon-')) return fail('Sign in required.', 401)
      const parsed = emailRequest.safeParse(await request.json())
      if (!parsed.success) return fail('Invalid email request.')
      const input = parsed.data
      const tools = createActionTools(this.env, auth.userId, jwt)
      const readAuthorized = async () => {
        const membership = await resolveAppMembership(this.env, auth.userId)
        if (!membership?.member) throw new Error('Access unavailable')
        const found = await tools.get('incidents', input.incidentId)
        const record = recordSchema.parse(found.success ? found.data?.record : null)
        if (record.recordId !== input.incidentId || !incidentCapabilities(record, auth.userId, membership.role).operate) throw new Error('Access denied')
        return record
      }
      const record = await readAuthorized()
      const source = await hash(JSON.stringify(record))
      const pointer = `latest:${auth.userId}:${input.incidentId}`
      let entry: StoredEmail | undefined
      if (input.intent === 'prepare') {
        // Status actions only: never regenerate AI or invoke Exa while preparing mail.
        const readStatus = async (namespace: DurableObjectNamespace, path: string) => {
          const room = namespace.get(namespace.idFromName(`app:${this.env.DEEPSPACE_APP_ID}`))
          const response = await room.fetch(new Request(`https://internal/${path}`, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ incidentId: input.incidentId, intent: path === 'references' ? 'report' : 'status' }) }))
          if (!response.ok) throw new Error('Status unavailable')
          return z.object({ success: z.literal(true), data: z.unknown() }).parse(await response.json()).data
        }
        const [aiData, refData] = await Promise.all([readStatus(this.env.INCIDENT_AI_ROOMS, 'analysis'), readStatus(this.env.INCIDENT_REFERENCE_ROOMS, 'references')])
        const ai = aiSchema.parse(aiData)
        const references = referenceStateSchema.parse(refData)
        const content = formatEmailReport(record, ai.phase === 'complete' ? ai.result : undefined, references.phase === 'complete' ? references.result : undefined, input.includeLogs)
        if (source !== await hash(JSON.stringify(await readAuthorized()))) return fail('Incident changed. Prepare the email again.', 409)
        const id = await hash(JSON.stringify([auth.userId, source, input.to, input.subject, content, input.includeLogs]))
        const draft = emailDraftSchema.parse({ id, to: input.to, subject: input.subject, content, includeLogs: input.includeLogs, createdAt: new Date().toISOString() })
        entry = await this.ctx.storage.transaction(async (tx) => {
          const existing = await tx.get<StoredEmail>(`draft:${id}`)
          const next = existing ?? { draft, userId: auth.userId, source, incidentId: input.incidentId, attempts: 0, oauthAttempts: 0 }
          await tx.put(`draft:${id}`, next)
          await tx.put(pointer, id)
          return next
        })
      } else {
        const id = input.intent === 'send' ? input.draftId : await this.ctx.storage.get<string>(pointer)
        entry = id ? await this.ctx.storage.get<StoredEmail>(`draft:${id}`) : undefined
        if (entry && (entry.userId !== auth.userId || entry.incidentId !== input.incidentId)) return fail('Draft unavailable.', 403)
        if (input.intent === 'send') {
          if (!entry) return fail('Prepare and review an email first.', 404)
          if (entry.source !== source) return fail('Incident changed. Prepare and review a new email.', 409)
          const result = await sendStoredEmail(this.ctx.storage, `draft:${id}`, auth.userId, (draft) => sendGmail(this.env, jwt, draft))
          await readAuthorized()
          return Response.json({ success: true, data: result })
        }
      }
      await readAuthorized()
      return Response.json({ success: true, data: presentEmail(entry) })
    } catch { return fail('Could not confirm the email state or your access. Check email status before trying again.', 503) }
  }
}

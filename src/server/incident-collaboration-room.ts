import { internalAssessmentRequest, assessHypothesisInRoom } from './incident-assessments'
import { incidentWriteRequest } from '../features/incidents/incident-write-types'
import { writeIncident } from './incident-write'
import { incidentListRequest } from '../features/incidents/incident-list-types'
import { listIncidentsInRoom } from './incident-list'
import { MSG, RecordRoom, verifyJwt, type ActionResult } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { schemas } from '../schemas'
import { collaborationRequest, MAX_COLLABORATORS } from '../features/incidents/collaboration/collaboration-types'
import { incidentCapabilities } from '../features/incidents/incident-permissions'

const incidentSchema = z.object({ recordId: z.string(), createdBy: z.string(), createdAt: z.string(), data: z.object({ collaborators: z.array(z.string()).optional() }) })
const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status })
async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Keep authorization and the resulting write in the same RecordRoom event.
 * SDK writes retain schema validation, attribution and permission-aware broadcasts.
 * No self-fetch to a DO stub inside its concurrency gate (which would deadlock).
 */
export class IncidentCollaborationRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }

  private async tool(userId: string, tool: string, params: Record<string, unknown>, appAction = true): Promise<ActionResult<Record<string, unknown>>> {
    const response = await super.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...(appAction ? { 'X-App-Action': 'true' } : {}) },
      body: JSON.stringify({ tool, params }),
    }))
    return response.json()
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path !== '/incident-collaboration' && path !== '/incident-write' && path !== '/incident-assessment' && path !== '/incident-list') return super.fetch(request)
    if (request.method !== 'POST') return fail('Not found.', 404)
    try {
      const header = request.headers.get('Authorization') ?? ''
      const jwt = header.startsWith('Bearer ') ? header.slice(7) : ''
      const { result: auth } = await verifyJwt({ publicKey: this.env.AUTH_JWT_PUBLIC_KEY, issuer: this.env.AUTH_JWT_ISSUER }, jwt)
      if (!auth || auth.userId.startsWith('anon-')) return fail('Sign in required.', 401)
      const payload = await request.json()
      const list = path === '/incident-list' ? incidentListRequest.safeParse(payload) : null
      if (list && !list.success) return fail('Invalid incident list request.')
      const write = path === '/incident-write' ? incidentWriteRequest.safeParse(payload) : null
      if (write && !write.success) return fail(write.error.issues[0].message)
      const assessment = path === '/incident-assessment' ? internalAssessmentRequest.safeParse(payload) : null
      if (assessment && !assessment.success) return fail('Invalid judgment request.')
      const parsed = collaborationRequest.safeParse(payload)
      if (!write && !assessment && !list && !parsed.success) return fail('Invalid collaboration request.')
      // Initialize the SDK's schema tables before entering the local gate.
      await super.fetch(new Request('https://internal/api/initialize-collaboration'))
      this.sql.exec('CREATE INDEX IF NOT EXISTS incident_member_lookup ON c_incident_members (col_incidentid, col_incidentcreatedat, col_incidentowner, col_userid)')
      this.sql.exec('CREATE INDEX IF NOT EXISTS incident_note_order ON c_incident_notes (col_incidentid, col_incidentcreatedat, col_incidentowner, col_sequence DESC)')
      this.sql.exec('CREATE INDEX IF NOT EXISTS incident_assessment_order ON c_incident_assessments (col_incidentid, col_incidentcreatedat, col_incidentowner, col_analysisversion, col_hypothesisindex, col_sequence DESC)')
      return await this.state.blockConcurrencyWhile(async () => {
        const account = await this.tool(auth.userId, 'records.get', { collection: 'users', recordId: auth.userId })
        const user = z.object({ data: z.object({ role: z.string() }) }).safeParse(account.data?.record)
        if (!account.success || !user.success) return fail('Sign in to this app before collaborating.', 403)
        const role = auth.userId === this.env.OWNER_USER_ID ? 'admin' : user.data.data.role
        if (list?.success) return listIncidentsInRoom(list.data, auth.userId, (id, tool, params) => this.tool(id, tool, params, false), this.sql)
        if (assessment?.success) return assessHypothesisInRoom(assessment.data, auth.userId, role, this.tool.bind(this), this.sql)
        if (write?.success) return writeIncident(write.data, auth.userId, role, this.tool.bind(this))
        if (!parsed.success) return fail('Invalid collaboration request.')
        const input = parsed.data
        const found = await this.tool(auth.userId, 'records.get', { collection: 'incidents', recordId: input.incidentId })
        const parsedRecord = incidentSchema.safeParse(found.data?.record)
        if (!found.success || !parsedRecord.success || parsedRecord.data.createdAt !== input.incidentCreatedAt) return fail('This incident is unavailable. Reopen its details.', 403)
        const record = parsedRecord.data
        const capability = incidentCapabilities(record, auth.userId, role)
        const source = { incidentId: record.recordId, incidentCreatedAt: record.createdAt, incidentOwner: record.createdBy }
        let result: ActionResult<Record<string, unknown>>
        if (input.intent === 'add' || input.intent === 'remove') {
          if (!capability.manageMembers) return fail('Only the incident creator can manage collaborators.', 403)
          if (input.userId === record.createdBy) return fail('The creator already has access.')
          const memberId = await digest([source, input.userId])
          const existing = (record.data.collaborators ?? []).includes(input.userId)
          if (input.intent === 'add') {
            if (existing) { this.refreshAccess(); return Response.json({ success: true }) }
            if ((record.data.collaborators?.length ?? 0) >= MAX_COLLABORATORS) return fail('This version supports one collaborator per incident. Remove the current collaborator first.')
            const target = await this.tool(auth.userId, 'records.get', { collection: 'users', recordId: input.userId })
            if (!target.success || !target.data?.record || input.userId.startsWith('anon-')) return fail('Ask this person to sign in to IncidentDesk first.')
            result = await this.tool(auth.userId, 'records.create', { collection: 'incident_members', recordId: memberId, data: { ...source, userId: input.userId } })
          } else {
            if (!existing) { this.refreshAccess(); return Response.json({ success: true }) }
            result = await this.tool(auth.userId, 'records.delete', { collection: 'incident_members', recordId: memberId })
          }
          // Membership-derived columns changed without modifying the incident or
          // every historical note. Resubscribe clears revoked client query results.
          if (result.success) this.refreshAccess()
        } else {
          if (!capability.comment) return fail('This incident is unavailable to your account.', 403)
          const noteId = await digest([source, auth.userId, input.requestId])
          const previous = await this.tool(auth.userId, 'records.get', { collection: 'incident_notes', recordId: noteId })
          if (previous.success && previous.data?.record) {
            const saved = z.object({ createdBy: z.string(), data: z.object({ body: z.string() }) }).parse(previous.data.record)
            if (saved.createdBy !== auth.userId || saved.data.body !== input.body) return fail('This request already saved different note content. Reopen the incident before adding a new note.')
            return Response.json({ success: true, data: { recordId: noteId } })
          }
          const latest = await this.tool(auth.userId, 'records.query', { collection: 'incident_notes', where: source, orderBy: 'sequence', orderDir: 'desc', limit: 1 })
          if (!latest.success) return fail('Could not confirm existing notes. Try again later.', 503)
          const rows = z.array(z.object({ data: z.object({ sequence: z.number() }) })).parse(latest.data?.records)
          result = await this.tool(auth.userId, 'records.create', { collection: 'incident_notes', recordId: noteId, data: { ...source, body: input.body, sequence: (rows[0]?.data.sequence ?? 0) + 1 } })
        }
        if (!result.success) return fail('The change was not saved. Check the incident before trying again.', 503)
        return Response.json({ success: true })
      })
    } catch { return fail(path === '/incident-list' ? 'Could not load incidents. Refresh the list and try again.' : 'Could not confirm the change. Reopen the incident to check its saved state before retrying.', 503) }
  }

  private refreshAccess() {
    for (const ws of this.getWebSockets()) {
      try { this.sendTo(ws, { type: MSG.RESUBSCRIBE, payload: {} }) } catch { /* A closed socket resyncs on reconnect. */ }
    }
  }
}

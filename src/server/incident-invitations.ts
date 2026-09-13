import { z } from 'zod'
import type { ActionResult, VerifyResult } from 'deepspace/worker'
import type { InvitationRequest, InvitationView } from '../features/incidents/collaboration/invitation-types'
import { MAX_COLLABORATORS } from '../features/incidents/collaboration/collaboration-types'

type Tool = (userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
type Source = { incidentId: string; incidentCreatedAt: string; incidentOwner: string }
type StoredInvitation = Source & { token: string; email: string; expiresAt: number; phase: 'pending' | 'accepting' | 'accepted' | 'cancelled' | 'revoked'; requestId: string; acceptedBy?: string }
const incident = z.object({ recordId: z.string(), createdBy: z.string(), createdAt: z.string(), data: z.object({ collaborators: z.array(z.string()).optional() }) })
const fail = (error: string, status = 409) => Response.json({ success: false, error }, { status })
const sourceKey = (source: Source) => JSON.stringify([source.incidentId, source.incidentCreatedAt, source.incidentOwner])
const ok = (invitation: InvitationView | null) => Response.json({ success: true, data: { invitation } })
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export function initializeInvitations(sql: SqlStorage) {
  // One latest invitation per incident incarnation. Never registered as an SDK
  // collection: no generic queries, directory exposure, or client writes.
  sql.exec('CREATE TABLE IF NOT EXISTS incident_invitations (scope TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS incident_invitation_limits (actor TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL, last REAL NOT NULL)')
}
function read(sql: SqlStorage, key: string, byToken = false): StoredInvitation | null {
  const row = sql.exec<{ value: string }>(`SELECT value FROM incident_invitations WHERE ${byToken ? 'token' : 'scope'} = ?`, key).toArray()[0]
  return row ? JSON.parse(row.value) as StoredInvitation : null
}
function save(sql: SqlStorage, entry: StoredInvitation) {
  sql.exec('INSERT INTO incident_invitations(scope,token,value) VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET token=excluded.token,value=excluded.value', sourceKey(entry), entry.token, JSON.stringify(entry))
}
function view(entry: StoredInvitation, members: string[], now: number): InvitationView {
  let phase: InvitationView['phase'] = entry.phase
  if (entry.acceptedBy && members.includes(entry.acceptedBy) && (phase === 'accepting' || phase === 'accepted')) phase = 'accepted'
  else if (phase === 'accepted') phase = 'revoked'
  else if ((phase === 'pending' || phase === 'accepting') && entry.expiresAt <= now) phase = 'expired'
  return { token: entry.token, email: entry.email, expiresAt: entry.expiresAt, phase, incidentId: entry.incidentId }
}

/** Also used by the legacy registered-user add path, under the SAME room gate. */
export function hasPendingInvitation(sql: SqlStorage, source: Source, now = Date.now()) {
  initializeInvitations(sql)
  const entry = read(sql, sourceKey(source))
  return !!entry && ['pending', 'accepting'].includes(entry.phase) && entry.expiresAt > now
}

/** Invalidate replay before removal, including a crash after membership create
 * but before acceptance receipt finalization. A failed removal can leave access
 * intact; it must never leave a reusable invitation that can restore access.
 */
export function revokeAcceptedInvitation(sql: SqlStorage, source: Source, userId: string) {
  initializeInvitations(sql)
  const entry = read(sql, sourceKey(source))
  if (entry?.acceptedBy === userId) save(sql, { ...entry, phase: 'revoked' })
}

/** Called only inside the authoritative RecordRoom concurrency gate. */
export async function handleInvitation(input: InvitationRequest, auth: VerifyResult, verifiedEmail: string | null, tool: Tool, sql: SqlStorage, refreshAccess: () => void, now = Date.now()): Promise<Response> {
  initializeInvitations(sql)
  const recipient = input.intent === 'inspect' || input.intent === 'accept'
  let entry = recipient ? read(sql, input.token, true) : null
  if (recipient && (!entry || !verifiedEmail || verifiedEmail !== entry.email || (entry.acceptedBy && entry.acceptedBy !== auth.userId))) {
    return fail('This invitation is unavailable for your account. Sign in with the invited email, or ask the creator for a current link.', 403)
  }
  const recordId = recipient ? entry!.incidentId : input.incidentId
  const result = await tool(auth.userId, 'records.get', { collection: 'incidents', recordId })
  const parsed = incident.safeParse(result.data?.record)
  if (!result.success || !parsed.success) return fail('This invitation or incident is no longer available.', 403)
  const record = parsed.data
  const source: Source = { incidentId: record.recordId, incidentCreatedAt: record.createdAt, incidentOwner: record.createdBy }
  if (recipient ? sourceKey(source) !== sourceKey(entry!) : record.createdBy !== auth.userId || record.createdAt !== input.incidentCreatedAt) {
    return fail('This invitation or incident is unavailable to your account.', 403)
  }
  const members = record.data.collaborators ?? []
  if (!recipient) entry = read(sql, sourceKey(source))
  if (input.intent === 'status') return ok(entry ? view(entry, members, now) : null)
  if (input.intent === 'create') {
    if (entry?.requestId === input.requestId) {
      if (entry.email !== input.email) return fail('This request was already used for another email.')
      return ok(view(entry, members, now))
    }
    if ((entry?.token ?? null) !== input.expectedId) return fail('The invitation changed in another window. Refresh invitation status.')
    if (entry && ['pending', 'accepting'].includes(view(entry, members, now).phase)) return fail('Cancel the current invitation before creating another.')
    if (members.length >= MAX_COLLABORATORS) return fail('Remove the current collaborator before inviting another person.')
    if (typeof auth.claims.email === 'string' && auth.claims.email.trim().toLowerCase() === input.email) return fail('You already have access as the creator.')
    const day = new Date(now).toISOString().slice(0, 10)
    const quota = sql.exec<{ day: string; count: number; last: number }>('SELECT day,count,last FROM incident_invitation_limits WHERE actor=?', auth.userId).toArray()[0]
    const count = quota?.day === day ? quota.count : 0
    if (count >= 10 || (quota && now - quota.last < 60000)) return fail('Invitation limit reached. Wait one minute between new invitations; maximum ten per account per UTC day.', 429)
    // Conservative quota reservation: a storage failure never refunds an
    // uncertain creation. Status and an identical retry recover the saved link.
    sql.exec('INSERT INTO incident_invitation_limits(actor,day,count,last) VALUES (?,?,?,?) ON CONFLICT(actor) DO UPDATE SET day=excluded.day,count=excluded.count,last=excluded.last', auth.userId, day, count + 1, now)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
    entry = { ...source, token, email: input.email, phase: 'pending', requestId: input.requestId, expiresAt: now + INVITATION_LIFETIME_MS }
    save(sql, entry)
    return ok(view(entry, members, now))
  }
  if (input.intent === 'cancel') {
    if (!entry || entry.token !== input.token) return fail('The invitation changed. Refresh invitation status.')
    const current = view(entry, members, now)
    if (current.phase === 'accepted') return fail('This invitation was already accepted. Remove the collaborator to revoke access.')
    if (current.phase !== 'revoked') save(sql, { ...entry, phase: 'cancelled' })
    return ok(view(read(sql, sourceKey(source))!, members, now))
  }
  // entry was authorized above; neither the URL nor the caller supplies source,
  // owner, recipient identity, or membership metadata for acceptance.
  if (!entry) return fail('This invitation is unavailable.', 403)
  if (record.createdBy === auth.userId) return fail('The creator cannot accept their own invitation.')
  const current = view(entry, members, now)
  if (input.intent === 'inspect') return ok(current)
  if (current.phase === 'accepted') { refreshAccess(); return ok(current) }
  if (!['pending', 'accepting'].includes(current.phase)) return fail('This invitation has expired, was cancelled, or no longer grants access. Ask the creator for a new link.')
  if (members.length >= MAX_COLLABORATORS && !members.includes(auth.userId)) return fail('The collaborator slot is no longer available.')
  if (members.includes(auth.userId) && !entry.acceptedBy) return fail('You already have access. Ask the creator to cancel this unused invitation.')
  const accepting: StoredInvitation = { ...entry, phase: 'accepting', acceptedBy: auth.userId }
  save(sql, accepting)
  // Reserve identity before the asynchronous SDK write. A crash can leave an
  // accepting receipt; retry the SAME invitation, never create a second member.
  const memberId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source, auth.userId])))), byte => byte.toString(16).padStart(2, '0')).join('')
  const created = await tool(auth.userId, 'records.create', { collection: 'incident_members', recordId: memberId, data: { ...source, userId: auth.userId } })
  if (!created.success) return fail('Acceptance could not be confirmed. Check this same invitation before retrying.', 503)
  save(sql, { ...accepting, phase: 'accepted' })
  refreshAccess()
  return ok(view({ ...accepting, phase: 'accepted' }, [...members, auth.userId], now))
}

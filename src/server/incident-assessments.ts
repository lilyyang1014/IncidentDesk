import { z } from 'zod'
import type { ActionResult } from 'deepspace/worker'
import { assessmentRequest, HISTORY_PAGE_SIZE } from '../features/incidents/collaboration/hypothesis-types'
import { incidentCapabilities } from '../features/incidents/incident-permissions'
import { incidentDigest, sourceIdentity } from './incident-identity'

export const internalAssessmentRequest = z.object({ input: assessmentRequest, verified: z.object({
  sourceVersion: z.string(), explanation: z.string(), evidenceLines: z.array(z.number()),
}).optional() }).strict()
type Tool = (userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
const fail = (error: string, status = 400) => Response.json({ success: false, error, code: status === 409 ? 'conflict' : status === 400 ? 'invalid' : status === 403 ? 'access_denied' : 'unavailable' }, { status })

/** Called only within the authoritative RecordRoom concurrency gate. */
export async function assessHypothesisInRoom(payload: z.infer<typeof internalAssessmentRequest>, userId: string, role: string, tool: Tool, sql: SqlStorage) {
  const { input, verified } = payload
  const found = await tool(userId, 'records.get', { collection: 'incidents', recordId: input.incidentId })
  const parsed = z.object({ recordId: z.string(), createdAt: z.string(), createdBy: z.string(),
    data: z.object({ title: z.string(), rawLog: z.string(), collaborators: z.array(z.string()).optional() }),
  }).safeParse(found.data?.record)
  if (!found.success || !parsed.success || parsed.data.createdAt !== input.incidentCreatedAt
    || !incidentCapabilities(parsed.data, userId, role).comment) return fail('This incident is unavailable to your account.', 403)
  const record = parsed.data
  const scope = { incidentId: record.recordId, incidentCreatedAt: record.createdAt, incidentOwner: record.createdBy,
    analysisVersion: input.analysisVersion, hypothesisIndex: input.hypothesisIndex }
  if (input.intent === 'history') {
    // Keyset pagination: new entries do not shift older pages. SQL values are
    // bound; every row still passes through the SDK envelope serializer.
    const rows = sql.exec<{ id: string }>(`SELECT _row_id AS id FROM c_incident_assessments
      WHERE col_incidentid = ? AND col_incidentcreatedat = ? AND col_incidentowner = ?
      AND col_analysisversion = ? AND col_hypothesisindex = ? AND col_sequence < ?
      ORDER BY col_sequence DESC LIMIT ?`, ...Object.values(scope), input.before ?? Number.MAX_SAFE_INTEGER, HISTORY_PAGE_SIZE + 1).toArray()
    const records = []
    for (const row of rows.slice(0, HISTORY_PAGE_SIZE)) {
      const entry = await tool(userId, 'records.get', { collection: 'incident_assessments', recordId: row.id })
      if (!entry.success || !entry.data?.record) return fail('Could not load judgment history.', 503)
      records.push(entry.data.record)
    }
    return Response.json({ success: true, data: { records, hasMore: rows.length > HISTORY_PAGE_SIZE } })
  }
  const sourceVersion = await incidentDigest(sourceIdentity(record))
  if (!verified || verified.sourceVersion !== sourceVersion) return fail('The original logs changed. Reopen Analysis before saving a judgment.', 409)
  const id = await incidentDigest(['assessment:v1', scope, userId, input.requestId])
  const previous = await tool(userId, 'records.get', { collection: 'incident_assessments', recordId: id })
  if (previous.success && previous.data?.record) {
    const saved = z.object({ createdBy: z.string(), data: z.object({ status: z.string(), reason: z.string(), previousSequence: z.number() }) }).parse(previous.data.record)
    if (saved.createdBy !== userId || saved.data.status !== input.status || saved.data.reason !== input.reason || saved.data.previousSequence !== input.expectedSequence) {
      return fail('This request already saved different content. Check history before starting a new judgment.', 409)
    }
    return Response.json({ success: true, data: { recordId: id } })
  }
  if (!previous.success && previous.error !== 'Record not found') return fail('Could not confirm this request. Retry the same judgment later.', 503)
  const latest = await tool(userId, 'records.query', { collection: 'incident_assessments', where: scope, orderBy: 'sequence', orderDir: 'desc', limit: 1 })
  const rows = z.array(z.object({ data: z.object({ sequence: z.number() }) })).safeParse(latest.data?.records)
  if (!latest.success || !rows.success) return fail('Could not read the latest judgment.', 503)
  const sequence = rows.data[0]?.data.sequence ?? 0
  if (sequence !== input.expectedSequence) return fail('Someone saved a newer judgment. Your reason is kept. Review the latest judgment before trying again.', 409)
  const result = await tool(userId, 'records.create', { collection: 'incident_assessments', recordId: id, data: {
    ...scope, sourceVersion, explanation: verified.explanation, evidenceLines: JSON.stringify(verified.evidenceLines),
    sequence: sequence + 1, previousSequence: sequence, status: input.status, reason: input.reason,
  } })
  if (!result.success) return fail('Could not confirm the save. Retry the same judgment to check its outcome.', 503)
  return Response.json({ success: true, data: { recordId: id } })
}

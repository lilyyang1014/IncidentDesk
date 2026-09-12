import { RECORD_NOT_FOUND, type ActionResult } from 'deepspace/worker'
import { z } from 'zod'
import { incidentSource, type IncidentWriteRequest } from '../features/incidents/incident-write-types'
import { incidentCapabilities } from '../features/incidents/incident-permissions'

type Tool = (userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status })
const recordSchema = z.object({ recordId: z.string(), createdBy: z.string(), createdAt: z.string(), data: z.object({ title: z.string(), rawLog: z.string() }) })

/** Called only inside the RecordRoom gate after verified app membership.
 * SDK trusted writes keep normal persistence, attribution and live broadcasts.
 */
export async function writeIncident(input: IncidentWriteRequest, userId: string, role: string, tool: Tool): Promise<Response> {
  const recordId = input.intent === 'create' ? `incident:${userId}:${input.requestId}` : input.incidentId
  const found = await tool(userId, 'records.get', { collection: 'incidents', recordId })
  if (!found.success && found.error !== RECORD_NOT_FOUND) return fail('Could not check the saved incident. Try again later.', 503)
  let data: Record<string, unknown> = input.data
  if (input.intent === 'create') {
    if (!['viewer', 'member', 'admin'].includes(role)) return fail('Your role cannot create incidents.', 403)
    if (found.data?.record) {
      const old = recordSchema.safeParse(found.data.record)
      if (!old.success || old.data.createdBy !== userId || old.data.data.title !== input.data.title || old.data.data.rawLog !== input.data.rawLog) return fail('This save request was already used for different content.', 409)
      return Response.json({ success: true, data: { recordId } })
    }
  } else {
    const parsed = recordSchema.safeParse(found.data?.record)
    if (!parsed.success || parsed.data.createdAt !== input.incidentCreatedAt || !incidentCapabilities(parsed.data, userId, role).operate) return fail('This incident is unavailable to your account.', 403)
    if (parsed.data.data.title !== input.expectedSource.title || parsed.data.data.rawLog !== input.expectedSource.rawLog) return fail('The incident source changed. Reopen its details before saving.', 409)
    const merged = incidentSource.safeParse({ ...parsed.data.data, ...input.data })
    if (!merged.success) return fail(merged.error.issues[0].message)
    if (merged.data.title !== parsed.data.data.title || merged.data.rawLog !== parsed.data.data.rawLog) {
      data = { ...input.data, status: 'Pending analysis', analysisSummary: '', analysisSignals: '', analysisEvidence: '' }
    }
  }
  const result = await tool(userId, input.intent === 'create' ? 'records.create' : 'records.update', {
    collection: 'incidents', recordId, data: input.intent === 'create' ? { ...input.data, status: 'Pending analysis' } : data,
  })
  if (!result.success) return fail('Could not save the incident. Check the saved state before retrying.', 503)
  return Response.json({ success: true, data: { recordId } })
}

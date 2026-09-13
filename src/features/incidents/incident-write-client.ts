import { getAuthToken, type RecordData } from 'deepspace'
import { z } from 'zod'
import type { Incident } from './incident-types'
import type { IncidentWriteRequest } from './incident-write-types'

async function write(input: IncidentWriteRequest): Promise<string> {
  const token = await getAuthToken()
  if (!token) throw Object.assign(new Error('Sign in again before saving.'), { code: 'not_ready' })
  let result: z.infer<typeof responseSchema>
  try {
    const response = await fetch('/api/actions/saveIncident', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), body: JSON.stringify(input),
    })
    // An unavailable server does not prove the mutation was never persisted.
    if (response.status >= 500) throw new Error('Unavailable')
    result = responseSchema.parse(await response.json())
  } catch { throw new Error('Mutation confirmation timed out') }
  if (result.uncertain) throw new Error('Mutation confirmation timed out')
  if (!result.success) throw Object.assign(new Error(result.error ?? 'Could not save the incident.'), { code: result.code })
  if (!result.data?.recordId) throw new Error('Mutation confirmation timed out')
  return result.data.recordId
}
const responseSchema = z.object({ success: z.boolean(), uncertain: z.boolean().optional(), code: z.string().optional(), error: z.string().optional(), data: z.object({ recordId: z.string() }).optional() })
export const createIncidentConfirmed = (data: Incident) => write({ intent: 'create', requestId: crypto.randomUUID(), data: { title: data.title, rawLog: data.rawLog } })
export const updateIncidentConfirmed = (record: RecordData<Incident>, data: Partial<Incident>) => write({
  intent: 'update', incidentId: record.recordId, incidentCreatedAt: record.createdAt,
  expectedSource: { title: record.data.title, rawLog: record.data.rawLog }, data,
})

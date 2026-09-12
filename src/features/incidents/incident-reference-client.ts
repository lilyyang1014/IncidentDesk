import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import { referenceStateSchema, type ReferenceState } from './incident-reference-types'

export async function requestReferences(incidentId: string, intent: 'status' | 'search' | 'report', query?: string, signal?: AbortSignal): Promise<ReferenceState> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to access references.')
  const response = await fetch('/api/actions/findIncidentReferences', {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(110000)]) : AbortSignal.timeout(110000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId, intent, query }),
  })
  const body = z.object({ success: z.boolean(), error: z.string().optional(), data: z.unknown().optional() }).parse(await response.json())
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not load references. Check search status before retrying.')
  return referenceStateSchema.parse(body.data)
}

import { getAuthToken } from 'deepspace'
import { z } from 'zod'

export class InvestigationError extends Error {
  constructor(message: string, readonly code = 'unavailable') { super(message) }
}
export async function investigationAction(action: 'assessHypothesis' | 'incidentViewers' | 'incidentFindings', input: unknown, signal?: AbortSignal, keepalive = false): Promise<unknown> {
  const token = await getAuthToken()
  if (!token) throw new InvestigationError('Sign in again to continue.', 'access_denied')
  const response = await fetch(`/api/actions/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), keepalive,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  const body = z.object({ success: z.boolean(), data: z.unknown().optional(), error: z.string().optional(), code: z.string().optional() }).parse(await response.json())
  if (!response.ok || !body.success) throw new InvestigationError(body.error ?? 'Could not confirm the request.', body.code)
  return body.data
}

import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import { emailStateSchema } from './incident-email-types'
export type EmailInput = { intent: 'prepare'; to: string; subject: string; includeLogs: boolean } | { intent: 'status' } | { intent: 'send'; draftId: string; confirmed: true }
export async function requestEmail(incidentId: string, input: EmailInput, signal?: AbortSignal) {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to access email handoff.')
  const response = await fetch('/api/actions/incidentEmail', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(110000)]) : AbortSignal.timeout(110000),
    body: JSON.stringify({ incidentId, ...input }),
  })
  const envelope = z.object({ success: z.boolean(), data: z.unknown().optional(), error: z.string().optional() }).parse(await response.json())
  if (!response.ok || !envelope.success) throw new Error(envelope.error ?? 'Could not confirm email state. Check email status before trying again.')
  return emailStateSchema.parse(envelope.data)
}

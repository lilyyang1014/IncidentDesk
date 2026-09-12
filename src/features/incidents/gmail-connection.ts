import { getAuthToken } from 'deepspace'
import { z } from 'zod'

const googleSchema = z.object({ connected: z.boolean(), gmailSend: z.boolean(), email: z.string().optional() })
export type GmailConnection = z.infer<typeof googleSchema>
export function parseGmailConnection(value: unknown): GmailConnection {
  const envelope = z.object({ google: googleSchema }).safeParse(value)
  if (envelope.success) return envelope.data.google
  const wrapped = z.object({ success: z.literal(true), data: z.object({ google: googleSchema }) }).parse(value)
  return wrapped.data.google
}
export async function loadGmailConnection(signal?: AbortSignal): Promise<GmailConnection> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to check Gmail connection.')
  const response = await fetch('/api/integrations/status', {
    headers: { Authorization: `Bearer ${token}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Could not check Gmail connection. Try again.')
  try { return parseGmailConnection(await response.json()) } catch { throw new Error('Could not verify Gmail connection status. Try again.') }
}

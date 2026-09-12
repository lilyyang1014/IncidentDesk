import { z } from 'zod'
import { apiWorkerFetch } from 'deepspace/worker'
import type { Env } from '../../worker'
import { googleAuthUrl, type EmailDraft } from '../features/incidents/incident-email-types'

export type SendOutcome = { phase: 'accepted'; messageId: string } | { phase: 'oauth'; authUrl: string } | { phase: 'failed' | 'unknown'; error: string }
export async function sendGmail(env: Env, jwt: string, draft: EmailDraft): Promise<SendOutcome> {
  if (!env.APP_IDENTITY_TOKEN) return { phase: 'failed', error: 'Email integration is not configured.' }
  try {
    const response = await apiWorkerFetch(env, '/api/integrations/google/gmail-send', {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, 'x-app-id': env.DEEPSPACE_APP_ID, 'x-app-identity-token': env.APP_IDENTITY_TOKEN },
      body: JSON.stringify({ to: draft.to, subject: draft.subject, content: draft.content }),
    })
    if (!response.ok) {
      if (response.status === 402) return { phase: 'failed', error: 'Your DeepSpace account has insufficient credits. No automatic retry will occur.' }
      if ([400, 401, 403, 429].includes(response.status)) return { phase: 'failed', error: 'Sending was rejected. Check account access and sending limits before retrying.' }
      return { phase: 'unknown', error: 'Sending outcome is unknown. Do not send again; check Gmail Sent and account authorization.' }
    }
    const envelope = z.object({ success: z.literal(true), data: z.unknown() }).parse(await response.json())
    const needsAuth = z.object({ requiresOAuth: z.literal(true) }).safeParse(envelope.data)
    const oauth = z.object({ requiresOAuth: z.literal(true), provider: z.literal('google'), authUrl: googleAuthUrl }).safeParse(envelope.data)
    if (oauth.success) return { phase: 'oauth', authUrl: oauth.data.authUrl }
    if (needsAuth.success) return { phase: 'unknown', error: 'The Google authorization link could not be verified. No automatic retry will occur.' }
    // The catalog has no output schema. Fail closed on unfamiliar responses.
    const sent = z.object({ id: z.string().min(1).max(500) }).parse(envelope.data)
    return { phase: 'accepted', messageId: sent.id }
  } catch { return { phase: 'unknown', error: 'Sending outcome could not be confirmed. Do not send again; check Gmail Sent.' } }
}

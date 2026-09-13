import { z } from 'zod'
import { apiWorkerFetch } from 'deepspace/worker'
import type { Env } from '../../worker'
import { googleAuthUrl, type EmailDraft } from '../features/incidents/incident-email-types'
import { encodeEmailSubject } from './incident-email-subject'

export type SendOutcome = { phase: 'accepted'; messageId: string } | { phase: 'oauth'; authUrl: string } | { phase: 'failed' | 'unknown'; error: string }
export async function sendGmail(env: Env, jwt: string, draft: EmailDraft): Promise<SendOutcome> {
  if (!env.APP_IDENTITY_TOKEN) return { phase: 'failed', error: 'Email integration is not configured.' }
  try {
    const response = await apiWorkerFetch(env, '/api/integrations/google/gmail-send', {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, 'x-app-id': env.DEEPSPACE_APP_ID, 'x-app-identity-token': env.APP_IDENTITY_TOKEN },
      body: JSON.stringify({ to: draft.to, subject: encodeEmailSubject(draft.subject), content: draft.content, ...(draft.html ? { html: draft.html } : {}) }),
    })
    if (!response.ok) {
      if (response.status === 402) return { phase: 'failed', error: 'Your DeepSpace account has insufficient credits. No automatic retry will occur.' }
      const rejection: Record<number, string> = {
        400: 'The email service rejected the request (HTTP 400). The request format may be unsupported. Do not keep retrying; report this error.',
        401: 'The email service rejected authentication (HTTP 401). Check your sign-in and Google authorization before retrying.',
        403: 'The email service refused this request (HTTP 403). Account permissions or provider policy may be blocking it.',
        429: 'The email service rate limit was reached (HTTP 429). Wait before trying again; no automatic retry will occur.',
      }
      if (rejection[response.status]) return { phase: 'failed', error: rejection[response.status] }
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

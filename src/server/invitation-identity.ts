import { authWorkerFetch, SESSION_COOKIE, type VerifyResult } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'
import { invitationEmail } from '../features/incidents/collaboration/invitation-types'

export function invitationSessionCookie(header: string | null): string | null {
  const values = (header ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`))
  return values.length === 1 && values[0].length <= 4096 ? values[0] : null
}

// The app's users records are editable profiles. They are NOT evidence of
// mailbox ownership. Ask the authentication authority for the live session,
// disable its cookie cache, and bind that identity to the separately verified JWT.
export async function verifiedInvitationEmail(env: Env, auth: VerifyResult, cookie: string | null): Promise<string> {
  if (!cookie) throw new Error('Sign in again to verify the email for this invitation.')
  let response: Response
  try {
    response = await authWorkerFetch(env, '/api/auth/get-session?disableCookieCache=true&disableRefresh=true', {
      // Workers supports manual/follow; refuse redirects without forwarding a
      // session cookie to a different origin.
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000), redirect: 'manual',
    })
  } catch { throw new Error('Could not verify your sign-in. Retry checking this invitation.') }
  const session = z.object({
    user: z.object({ id: z.string(), email: invitationEmail, emailVerified: z.literal(true) }),
    session: z.object({ userId: z.string(), expiresAt: z.string().datetime({ offset: true }) }),
  }).safeParse(await response.json().catch(() => null))
  if (!response.ok || !session.success || session.data.user.id !== auth.userId || session.data.session.userId !== auth.userId || Date.parse(session.data.session.expiresAt) <= Date.now()) {
    throw new Error('A current sign-in with a verified email is required. Sign in with the account that owns the invited email.')
  }
  return session.data.user.email
}

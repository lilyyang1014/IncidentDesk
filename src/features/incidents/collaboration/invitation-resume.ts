import { invitationToken } from './invitation-types'
const KEY = 'incidentdesk:invitation-return'
const MAX_AGE_MS = 30 * 60 * 1000

// Tab-local, bounded OAuth return hint, not a credential or authorization cache.
// The link stays in the fragment so it is omitted from HTTP/referrer URLs.
export function rememberInvitation(token: string) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ token: invitationToken.parse(token), savedAt: Date.now() })) } catch { /* Keep the original link available if browser storage is blocked. */ }
}
export function recalledInvitation(): string | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    const token = invitationToken.safeParse(value?.token)
    if (!token.success || typeof value.savedAt !== 'number' || value.savedAt > Date.now() || Date.now() - value.savedAt > MAX_AGE_MS) { forgetInvitation(); return null }
    return token.data
  } catch { return null }
}
export function forgetInvitation() {
  try { sessionStorage.removeItem(KEY) } catch { /* Optional return hint only. */ }
}

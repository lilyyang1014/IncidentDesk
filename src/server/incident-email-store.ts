import type { EmailDraft, EmailState } from '../features/incidents/incident-email-types'
import type { SendOutcome } from './incident-email-provider'
export type StoredEmail = { draft: EmailDraft; userId: string; source: string; incidentId: string; attempts: number; oauthAttempts?: number; startedAt?: number; outcome?: SendOutcome | { phase: 'sending' } }
type Tx = Pick<DurableObjectTransaction, 'get' | 'put'>
export type EmailStorage = Tx & { transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> }
export function presentEmail(entry: StoredEmail | undefined, now = Date.now()): EmailState {
  if (!entry) return { draft: null, phase: 'idle' }
  if (entry.outcome?.phase === 'sending' && now - (entry.startedAt ?? 0) > 150000) return { draft: entry.draft, phase: 'unknown', error: 'Sending was interrupted. Do not resend; check Gmail Sent.' }
  return { draft: entry.draft, ...(entry.outcome ?? { phase: 'ready' }) }
}
export async function sendStoredEmail(storage: EmailStorage, key: string, userId: string, call: (draft: EmailDraft) => Promise<SendOutcome>, now = Date.now()): Promise<EmailState> {
  const claim = await storage.transaction(async (tx) => {
    const stored = await tx.get<StoredEmail>(key)
    if (!stored || stored.userId !== userId) throw new Error('Draft unavailable')
    // Legacy receipts only prove whether the last attempt required OAuth.
    // Preserve all other historical attempts; never reset uncertain send history.
    const legacyOAuth = stored.oauthAttempts === undefined && stored.outcome?.phase === 'oauth'
    const entry: StoredEmail = stored.oauthAttempts === undefined
      ? { ...stored, attempts: Math.max(0, stored.attempts - (legacyOAuth ? 1 : 0)), oauthAttempts: legacyOAuth ? 1 : 0 }
      : stored
    if (stored.oauthAttempts === undefined) await tx.put(key, entry)
    if (entry.outcome && ['sending', 'accepted', 'unknown'].includes(entry.outcome.phase)) return { state: presentEmail(entry, now) }
    if (entry.attempts >= 3) return { state: { ...presentEmail(entry, now), phase: 'failed' as const, error: 'This draft reached the three-attempt limit. Check Gmail before preparing another draft.' } }
    const quotaKey = `quota:${userId}`
    const quota = await tx.get<{ day: string; count: number; last: number }>(quotaKey)
    const day = new Date(now).toISOString().slice(0, 10)
    const count = quota?.day === day ? quota.count : 0
    if (count >= 10 || (quota && now - quota.last < 60000)) return { state: { ...presentEmail(entry, now), error: 'Limit reached. Wait one minute between attempts; maximum ten per UTC day.' } }
    const next: StoredEmail = { ...entry, attempts: entry.attempts + 1, startedAt: now, outcome: { phase: 'sending' } }
    await tx.put(key, next)
    await tx.put(quotaKey, { day, count: count + 1, last: now })
    return { entry: next }
  })
  if (!claim.entry) return claim.state!
  let outcome: SendOutcome
  try { outcome = await call(claim.entry.draft) } catch { outcome = { phase: 'unknown', error: 'Sending outcome unknown. Check Gmail Sent before taking further action.' } }
  // Only a confirmed OAuth response proves this request did not attempt delivery.
  // Keep the reserved attempt for failures, uncertainty and interrupted persistence.
  const next: StoredEmail = {
    ...claim.entry,
    attempts: claim.entry.attempts - (outcome.phase === 'oauth' ? 1 : 0),
    oauthAttempts: (claim.entry.oauthAttempts ?? 0) + (outcome.phase === 'oauth' ? 1 : 0),
    outcome,
  }
  await storage.put(key, next)
  return presentEmail(next)
}

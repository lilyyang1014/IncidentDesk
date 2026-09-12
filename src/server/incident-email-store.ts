import type { EmailDraft, EmailState } from '../features/incidents/incident-email-types'
import type { SendOutcome } from './incident-email-provider'
export type StoredEmail = { draft: EmailDraft; userId: string; source: string; incidentId: string; attempts: number; startedAt?: number; outcome?: SendOutcome | { phase: 'sending' } }
type Tx = Pick<DurableObjectTransaction, 'get' | 'put'>
export type EmailStorage = Tx & { transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> }
export function presentEmail(entry: StoredEmail | undefined, now = Date.now()): EmailState {
  if (!entry) return { draft: null, phase: 'idle' }
  if (entry.outcome?.phase === 'sending' && now - (entry.startedAt ?? 0) > 150000) return { draft: entry.draft, phase: 'unknown', error: 'Sending was interrupted. Do not resend; check Gmail Sent.' }
  return { draft: entry.draft, ...(entry.outcome ?? { phase: 'ready' }) }
}
export async function sendStoredEmail(storage: EmailStorage, key: string, userId: string, call: (draft: EmailDraft) => Promise<SendOutcome>, now = Date.now()): Promise<EmailState> {
  const claim = await storage.transaction(async (tx) => {
    const entry = await tx.get<StoredEmail>(key)
    if (!entry || entry.userId !== userId) throw new Error('Draft unavailable')
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
  const next = { ...claim.entry, outcome }
  await storage.put(key, next)
  return presentEmail(next)
}

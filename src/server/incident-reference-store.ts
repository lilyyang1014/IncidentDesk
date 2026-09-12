import type { ReferenceResult, ReferenceState } from '../features/incidents/incident-reference-types'
import { ReferenceProviderError } from './incident-reference-provider'

type Entry = { phase: 'running' | 'complete' | 'failed' | 'unknown'; attempts: number; startedAt: number; result?: ReferenceResult; error?: string }
type Counter = { day: string; count: number; lastAt: number }
type Transaction = Pick<DurableObjectTransaction, 'get' | 'put'>
export type ReferenceStorage = Transaction & { transaction<T>(work: (txn: Transaction) => Promise<T>): Promise<T> }

function present(query: string, entry?: Entry, now = Date.now()): ReferenceState {
  if (!entry) return { query, phase: 'idle', canSearch: true }
  if (entry.phase === 'running' && now - entry.startedAt > 150000) {
    return { query, phase: 'unknown', canSearch: false, error: 'This request was interrupted or has not finished. Check status later. A new paid request is blocked.' }
  }
  const exhausted = entry.phase === 'failed' && entry.attempts >= 3
  return { query, phase: entry.phase, result: entry.result, error: exhausted ? `${entry.error ?? 'Search failed.'} The three-attempt limit for this query has been reached.` : entry.error,
    canSearch: entry.phase === 'failed' && entry.attempts < 3 && now - entry.startedAt >= 60000 }
}

/** Private durable receipts, not a background job runner. Claims survive a
 * restart; an interrupted request stays unknown rather than charging again. */
export async function runStoredReferences(storage: ReferenceStorage, key: string, userId: string, query: string, generate: boolean,
  call: () => Promise<ReferenceResult>, now = Date.now(), successKey?: string): Promise<ReferenceState> {
  const claim = await storage.transaction(async (tx) => {
    const previous = await tx.get<Entry>(key)
    const view = present(query, previous, now)
    if (!generate || !view.canSearch) return { view }
    const counterKey = `quota:${userId}`
    const day = new Date(now).toISOString().slice(0, 10)
    const old = await tx.get<Counter>(counterKey)
    const count = old?.day === day ? old.count : 0
    if (count >= 10 || (old && now - old.lastAt < 60000)) {
      return { view: { ...view, canSearch: false, error: count >= 10
        ? 'Daily search limit reached (10 requests per account, UTC day).'
        : 'Wait one minute between search requests, then check status.' } }
    }
    const entry: Entry = { phase: 'running', attempts: (previous?.attempts ?? 0) + 1, startedAt: now }
    await tx.put(key, entry)
    await tx.put(counterKey, { day, count: count + 1, lastAt: now })
    return { entry }
  })
  if (!claim.entry) return claim.view!
  let next: Entry
  try {
    const result = await call()
    next = { ...claim.entry, phase: 'complete', result }
  } catch (error) {
    next = { ...claim.entry, phase: error instanceof ReferenceProviderError && !error.uncertain ? 'failed' : 'unknown',
      error: error instanceof ReferenceProviderError ? error.message : 'Search outcome is unknown. A new paid request is blocked.' }
  }
  // If persistence fails, leave the durable running claim intact. Never retry
  // the provider merely because the final storage acknowledgement was lost.
  if (!successKey) await storage.put(key, next)
  else await storage.transaction(async (tx) => {
    await tx.put(key, next)
    if (next.phase === 'complete' && successKey) await tx.put(successKey, query)
  })
  return present(query, next)
}

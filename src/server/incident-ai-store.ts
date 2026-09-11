import type { AiAnalysis, AiAnalysisState } from '../features/incidents/incident-ai-types'
import { AiProviderError } from './incident-ai-provider'

type Entry = { phase: 'running' | 'complete' | 'failed' | 'unknown'; attempts: number; startedAt: number; result?: AiAnalysis; error?: string }
type Counter = { day: string; count: number; lastAt: number }
type Transaction = Pick<DurableObjectTransaction, 'get' | 'put'>
export type AnalysisStorage = Transaction & { transaction<T>(work: (txn: Transaction) => Promise<T>): Promise<T> }

function present(entry?: Entry, now = Date.now()): AiAnalysisState {
  if (!entry) return { phase: 'idle', canGenerate: true }
  if (entry.phase === 'running' && now - entry.startedAt > 150000) {
    return { phase: 'unknown', canGenerate: false, error: 'This request was interrupted or has not finished. Check status later. A new paid request is blocked.' }
  }
  const exhausted = entry.phase === 'failed' && entry.attempts >= 3
  return { phase: entry.phase, result: entry.result, error: exhausted ? `${entry.error ?? 'Analysis failed.'} The three-attempt limit for these logs has been reached.` : entry.error,
    canGenerate: entry.phase === 'failed' && entry.attempts < 3 && now - entry.startedAt >= 60000 }
}

/** Private durable receipts, not a background job runner. Claims survive a
 * restart; an interrupted request stays unknown rather than charging again. */
export async function runStoredAnalysis(storage: AnalysisStorage, key: string, userId: string, generate: boolean,
  call: () => Promise<AiAnalysis>, now = Date.now()): Promise<AiAnalysisState> {
  const claim = await storage.transaction(async (tx) => {
    const previous = await tx.get<Entry>(key)
    const view = present(previous, now)
    if (!generate || !view.canGenerate) return { view }
    const counterKey = `quota:${userId}`
    const day = new Date(now).toISOString().slice(0, 10)
    const old = await tx.get<Counter>(counterKey)
    const count = old?.day === day ? old.count : 0
    if (count >= 10 || (old && now - old.lastAt < 60000)) {
      return { view: { ...view, canGenerate: false, error: count >= 10
        ? 'Daily AI limit reached (10 requests per account, UTC day).'
        : 'Wait one minute between AI requests, then check status.' } }
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
    next = { ...claim.entry, phase: error instanceof AiProviderError && !error.uncertain ? 'failed' : 'unknown',
      error: error instanceof AiProviderError ? error.message : 'Analysis outcome is unknown. A new paid request is blocked.' }
  }
  // If persistence fails, leave the durable running claim intact. Never retry
  // the provider merely because the final storage acknowledgement was lost.
  await storage.put(key, next)
  return present(next)
}

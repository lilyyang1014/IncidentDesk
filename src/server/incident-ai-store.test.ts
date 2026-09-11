import { describe, expect, it, vi } from 'vitest'
import { runStoredAnalysis, type AnalysisStorage } from './incident-ai-store'
import { AiProviderError } from './incident-ai-provider'
import type { AiAnalysis } from '../features/incidents/incident-ai-types'

// Transactions serialize like DO storage; ordinary reads/writes clone values.
export function memoryStorage(): AnalysisStorage {
  const values = new Map<string, unknown>()
  let queue = Promise.resolve()
  const tx = {
    get: vi.fn(async (key: string) => structuredClone(values.get(key))),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)) }),
  }
  return { ...tx, put: vi.fn(async (key: string, value: unknown) => tx.put(key, value)), transaction: <T,>(work: (transaction: typeof tx) => Promise<T>) => {
    const next = queue.then(() => work(tx))
    queue = next.then(() => {}, () => {})
    return next
  } } as unknown as AnalysisStorage
}
const result: AiAnalysis = { summary: 'Timeout.', evidence: [], hypotheses: [], suggestedChecks: ['Check latency.'], model: 'test', generatedAt: '2026-09-11T00:00:00Z' }
const start = Date.parse('2026-09-11T00:00:00Z')

describe('durable analysis receipts', () => {
  it('reads status without calling a provider or consuming quota', async () => {
    const call = vi.fn()
    expect(await runStoredAnalysis(memoryStorage(), 'event', 'user', false, call, start)).toEqual({ phase: 'idle', canGenerate: true })
    expect(call).not.toHaveBeenCalled()
  })
  it('prevents simultaneous duplicate calls and reuses saved results across callers', async () => {
    const storage = memoryStorage()
    let finish!: (result: AiAnalysis) => void
    const call = vi.fn(() => new Promise<AiAnalysis>((resolve) => { finish = resolve }))
    const first = runStoredAnalysis(storage, 'event', 'user', true, call, start)
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect((await runStoredAnalysis(storage, 'event', 'admin', true, call, start)).phase).toBe('running')
    finish(result)
    expect((await first).phase).toBe('complete')
    expect((await runStoredAnalysis(storage, 'event', 'user', true, call, start + 70000)).result).toEqual(result)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('never resubmits unknown outcomes, including after the request deadline', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => { throw new AiProviderError('Unknown outcome', true) })
    expect((await runStoredAnalysis(storage, 'event', 'user', true, call, start)).phase).toBe('unknown')
    expect((await runStoredAnalysis(storage, 'event', 'user', true, call, start + 180000)).canGenerate).toBe(false)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('leaves an interrupted running receipt blocked after restart', async () => {
    const storage = memoryStorage()
    await storage.put('event', { phase: 'running', attempts: 1, startedAt: start })
    const call = vi.fn()
    expect((await runStoredAnalysis(storage, 'event', 'user', true, call, start + 180000)).phase).toBe('unknown')
    expect(call).not.toHaveBeenCalled()
  })
  it('allows only explicit retries after known failures, bounded to three attempts', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => { throw new AiProviderError('Rejected') })
    for (let i = 0; i < 4; i++) await runStoredAnalysis(storage, 'event', 'user', true, call, start + i * 70000)
    expect(call).toHaveBeenCalledTimes(3)
  })
  it('enforces per-account cooldown and daily limits across distinct incidents', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => result)
    await runStoredAnalysis(storage, 'event-0', 'user', true, call, start)
    expect((await runStoredAnalysis(storage, 'early', 'user', true, call, start + 100)).error).toContain('one minute')
    for (let i = 1; i < 11; i++) await runStoredAnalysis(storage, `event-${i}`, 'user', true, call, start + i * 70000)
    expect(call).toHaveBeenCalledTimes(10)
    await runStoredAnalysis(storage, 'next-day', 'user', true, call, start + 86400000)
    expect(call).toHaveBeenCalledTimes(11)
  })
  it('does not repeat a provider call when saving the result fails', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => result)
    vi.mocked(storage.put).mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(runStoredAnalysis(storage, 'event', 'user', true, call, start)).rejects.toThrow()
    expect((await runStoredAnalysis(storage, 'event', 'user', true, call, start + 180000)).phase).toBe('unknown')
    expect(call).toHaveBeenCalledTimes(1)
  })
})

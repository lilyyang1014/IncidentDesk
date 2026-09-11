import { describe, expect, it, vi } from 'vitest'
import { runStoredReferences, type ReferenceStorage } from './incident-reference-store'
import { ReferenceProviderError } from './incident-reference-provider'
import type { ReferenceResult } from '../features/incidents/incident-reference-types'

// Transactions serialize like DO storage; ordinary reads/writes clone values.
export function memoryStorage(): ReferenceStorage {
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
  } } as unknown as ReferenceStorage
}
const result: ReferenceResult = { query: 'timeout', searchedAt: '2026-09-11T00:00:00Z', items: [] }
const start = Date.parse('2026-09-11T00:00:00Z')

describe('durable analysis receipts', () => {
  it('reads status without calling a provider or consuming quota', async () => {
    const call = vi.fn()
    expect(await runStoredReferences(memoryStorage(), 'event', 'user', 'timeout', false, call, start)).toEqual({ query: 'timeout', phase: 'idle', canSearch: true })
    expect(call).not.toHaveBeenCalled()
  })
  it('prevents simultaneous duplicate calls and reuses saved results across callers', async () => {
    const storage = memoryStorage()
    let finish!: (result: ReferenceResult) => void
    const call = vi.fn(() => new Promise<ReferenceResult>((resolve) => { finish = resolve }))
    const first = runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start)
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect((await runStoredReferences(storage, 'event', 'admin', 'timeout', true, call, start)).phase).toBe('running')
    finish(result)
    expect((await first).phase).toBe('complete')
    expect((await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start + 70000)).result).toEqual(result)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('never resubmits unknown outcomes, including after the request deadline', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => { throw new ReferenceProviderError('Unknown outcome', true) })
    expect((await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start)).phase).toBe('unknown')
    expect((await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start + 180000)).canSearch).toBe(false)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('leaves an interrupted running receipt blocked after restart', async () => {
    const storage = memoryStorage()
    await storage.put('event', { phase: 'running', attempts: 1, startedAt: start })
    const call = vi.fn()
    expect((await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start + 180000)).phase).toBe('unknown')
    expect(call).not.toHaveBeenCalled()
  })
  it('allows only explicit retries after known failures, bounded to three attempts', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => { throw new ReferenceProviderError('Rejected') })
    for (let i = 0; i < 4; i++) await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start + i * 70000)
    expect(call).toHaveBeenCalledTimes(3)
  })
  it('enforces per-account cooldown and daily limits across distinct incidents', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => result)
    await runStoredReferences(storage, 'event-0', 'user', 'timeout', true, call, start)
    expect((await runStoredReferences(storage, 'early', 'user', 'timeout', true, call, start + 100)).error).toContain('one minute')
    for (let i = 1; i < 11; i++) await runStoredReferences(storage, `event-${i}`, 'user', 'timeout', true, call, start + i * 70000)
    expect(call).toHaveBeenCalledTimes(10)
    await runStoredReferences(storage, 'next-day', 'user', 'timeout', true, call, start + 86400000)
    expect(call).toHaveBeenCalledTimes(11)
  })
  it('does not repeat a provider call when saving the result fails', async () => {
    const storage = memoryStorage()
    const call = vi.fn(async () => result)
    vi.mocked(storage.put).mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start)).rejects.toThrow()
    expect((await runStoredReferences(storage, 'event', 'user', 'timeout', true, call, start + 180000)).phase).toBe('unknown')
    expect(call).toHaveBeenCalledTimes(1)
  })
})

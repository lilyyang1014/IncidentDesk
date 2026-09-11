import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIncidentAnalysisFlow, withAnalysisLock, type AnalysisLock, type AnalysisState } from './incident-analysis-flow'
import type { Incident } from './incident-types'

const incident: Incident = { title: 'Failure', rawLog: 'GET /orders 503', status: 'Pending analysis' }
const lock: AnalysisLock = async (_id, work) => { await work(); return true }
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const changed = vi.fn<(state: AnalysisState) => void>()
  return { flow: createIncidentAnalysisFlow(changed), state: () => changed.mock.calls.at(-1)?.[0] }
}

describe('confirmed local analysis', () => {
  it('requests a non-queued browser lock and skips work if another tab holds it', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback(null))
    vi.stubGlobal('navigator', { locks: { request } })
    const work = vi.fn()
    expect(await withAnalysisLock('a', work)).toBe(false)
    expect(request).toHaveBeenCalledWith('incidentdesk:analysis:a', { ifAvailable: true }, expect.any(Function))
    expect(work).not.toHaveBeenCalled()
  })

  it('does not write when browser coordination is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const { flow, state } = setup()
    const write = vi.fn()
    await flow.submit('a', incident, true, write)
    expect(state()?.error).toContain('Web Locks')
    expect(write).not.toHaveBeenCalled()
  })

  it('saves result and final status in one write, and blocks repeated clicks before and after confirmation', async () => {
    const { flow, state } = setup()
    let resolve!: () => void
    const write = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const first = flow.submit('a', incident, true, write, lock)
    await flow.submit('a', incident, true, write, lock)
    expect(state()?.phase).toBe('saving')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'Analysis ready', analysisEvidence: '[line 1] GET /orders 503' }))
    resolve()
    await first
    await flow.submit('a', incident, true, write, lock)
    expect(write).toHaveBeenCalledTimes(1)
    expect(state()?.phase).toBe('complete')
  })

  it.each(['Mutation confirmation timed out', 'WebSocket disconnected'])('never overwrites a saved result after a lost acknowledgement: %s', async (message) => {
    const { flow, state } = setup()
    let persisted = { ...incident }
    const write = vi.fn(async (_id: string, patch: Partial<Incident>) => {
      persisted = { ...persisted, ...patch }
      throw new Error(message)
    })
    await flow.submit('a', incident, true, write, lock)
    expect(state()?.phase).toBe('review')
    expect(persisted.status).toBe('Analysis ready')
    await flow.submit('a', incident, true, write, lock)
    await setup().flow.submit('a', persisted, true, write, lock)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('allows explicit retry after rejection without persisting failure or intermediate status', async () => {
    const { flow, state } = setup()
    const write = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce(undefined)
    await flow.submit('a', incident, true, write, lock)
    expect(state()?.phase).toBe('idle')
    expect(write).toHaveBeenCalledTimes(1)
    await flow.submit('a', incident, true, write, lock)
    expect(state()?.phase).toBe('complete')
    expect(write.mock.calls.every((call) => call[1].status === 'Analysis ready')).toBe(true)
  })

  it('does not write empty logs or write while disconnected', async () => {
    const { flow, state } = setup()
    const write = vi.fn()
    await flow.submit('a', { ...incident, rawLog: ' \n ' }, true, write, lock)
    expect(state()?.error).toContain('empty')
    await flow.submit('a', incident, false, write, lock)
    expect(state()?.error).toContain('Reconnect')
    expect(write).not.toHaveBeenCalled()
  })

  it('coordinates independent flows through a shared per-record lock without blocking another record', async () => {
    const held = new Set<string>()
    const shared: AnalysisLock = async (id, work) => {
      if (held.has(id)) return false
      held.add(id)
      try { await work(); return true } finally { held.delete(id) }
    }
    let resolve!: () => void
    const firstWrite = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const first = setup().flow.submit('a', incident, true, firstWrite, shared)
    const other = setup()
    const write = vi.fn().mockResolvedValue(undefined)
    await other.flow.submit('a', incident, true, write, shared)
    expect(other.state()?.error).toContain('another tab')
    expect(write).not.toHaveBeenCalled()
    await setup().flow.submit('b', incident, true, write, shared)
    expect(write).toHaveBeenCalledTimes(1)
    resolve()
    await first
  })

  it.each(['Analyzing', 'Analysis failed'] as const)('can recover legacy %s records', async (status) => {
    const write = vi.fn().mockResolvedValue(undefined)
    await setup().flow.submit('a', { ...incident, status }, true, write, lock)
    expect(write).toHaveBeenCalledTimes(1)
  })
})

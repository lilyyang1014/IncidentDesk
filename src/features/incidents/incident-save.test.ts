import { describe, expect, it, vi } from 'vitest'
import { createIncidentSaveFlow, type SaveState } from './incident-save'

const input = { title: ' Checkout failure ', rawLog: ' 2026-09-10T10:01:12Z request failed\nsecond line ' }

function deferred() {
  let resolve!: (id: string) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const changed = vi.fn<(state: SaveState) => void>()
  const flow = createIncidentSaveFlow(changed)
  const state = () => changed.mock.calls.at(-1)?.[0]
  return { flow, changed, state }
}

describe('confirmed incident saving', () => {
  it('returns the ID only after confirmation and leaves the input object intact', async () => {
    const { flow, state } = setup()
    const acknowledgement = deferred()
    const write = vi.fn(() => acknowledgement.promise)
    const completed = vi.fn()
    const draft = { ...input }
    const save = flow.submit(draft, write).then(completed)

    expect(state()).toEqual({ phase: 'saving', error: null })
    expect(flow.canReplaceInput()).toBe(false)
    expect(write).toHaveBeenCalledWith({
      title: 'Checkout failure', rawLog: '2026-09-10T10:01:12Z request failed\nsecond line', status: 'Pending analysis',
    })
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    expect(draft).toEqual(input)

    acknowledgement.resolve('incident-1')
    await save
    expect(completed).toHaveBeenCalledWith('incident-1')
    expect(state()).toEqual({ phase: 'idle', error: null })
    expect(flow.canReplaceInput()).toBe(true)
  })

  it('blocks same-tick repeated submissions until the first request settles', async () => {
    const { flow } = setup()
    const acknowledgement = deferred()
    const write = vi.fn(() => acknowledgement.promise)
    const first = flow.submit(input, write)
    expect(await flow.submit(input, write)).toBeUndefined()
    flow.acknowledgeReview()
    expect(await flow.submit(input, write)).toBeUndefined()
    expect(write).toHaveBeenCalledTimes(1)
    acknowledgement.resolve('incident-1')
    await first
  })

  it.each([
    { title: ' \n ', rawLog: 'logs' },
    { title: 'title', rawLog: '\t ' },
  ])('rejects blank input without contacting the server: %j', async (draft) => {
    const { flow, state } = setup()
    const write = vi.fn()
    expect(await flow.submit(draft, write)).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
    expect(state()?.error).toBe('Enter an incident title and the original logs.')
  })

  it('preserves the draft on rejection and allows a later explicit successful attempt', async () => {
    const { flow, state } = setup()
    const draft = { ...input }
    const write = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce('incident-2')
    expect(await flow.submit(draft, write)).toBeUndefined()
    expect(state()?.phase).toBe('idle')
    expect(state()?.error).toContain('Your input is unchanged')
    expect(draft).toEqual(input)
    expect(write).toHaveBeenCalledTimes(1)
    expect(await flow.submit(draft, write)).toBe('incident-2')
    expect(state()?.error).toBeNull()
  })

  it('handles a disconnect before sending as a not-ready error', async () => {
    const { flow, state } = setup()
    const write = vi.fn(() => { throw Object.assign(new Error('Not ready'), { code: 'not_ready' }) })
    expect(await flow.submit(input, write)).toBeUndefined()
    expect(state()?.phase).toBe('idle')
    expect(state()?.error).toContain('Reconnect before saving')
  })

  it.each(['Mutation confirmation timed out', 'WebSocket disconnected', null])(
    'requires manual record review after an unknown result (%s), without automatic retries', async (message) => {
      const { flow, state } = setup()
      const draft = { ...input }
      const write = vi.fn().mockRejectedValueOnce(message === null ? null : new Error(message)).mockResolvedValueOnce('incident-3')
      expect(await flow.submit(draft, write)).toBeUndefined()
      expect(state()?.phase).toBe('review')
      expect(state()?.error).toContain('may already be saved')
      expect(draft).toEqual(input)
      expect(flow.canReplaceInput()).toBe(false)
      flow.clearError()
      expect(state()?.phase).toBe('review')
      expect(await flow.submit(draft, write)).toBeUndefined()
      expect(write).toHaveBeenCalledTimes(1)

      flow.acknowledgeReview()
      expect(await flow.submit(draft, write)).toBe('incident-3')
      expect(write).toHaveBeenCalledTimes(2)
    },
  )
})

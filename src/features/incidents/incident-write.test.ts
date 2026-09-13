import { afterEach, expect, it, vi } from 'vitest'
import { createIncidentSaveFlow } from './incident-save'
import { incidentSource } from './incident-write-types'
import { createIncidentConfirmed } from './incident-write-client'
vi.mock('deepspace', () => ({ getAuthToken: async () => 'test-token' }))
afterEach(() => vi.unstubAllGlobals())
it('matches browser UTF-16 bounds and preserves log whitespace', () => {
  expect(incidentSource.parse({title:'😀'.repeat(60), rawLog:'\n  log\n'}).rawLog).toBe('\n  log\n')
  expect(incidentSource.safeParse({title:'😀'.repeat(61),rawLog:'log'}).success).toBe(false)
  expect(incidentSource.safeParse({title:'title',rawLog:'x'.repeat(20000)}).success).toBe(true)
  expect(incidentSource.safeParse({title:'title',rawLog:'x'.repeat(20001)}).success).toBe(false)
})
it.each(['', ' ', '\t\n', '\u00a0\u2003\uFEFF'])('rejects blank source fields: %j', blank => {
  expect(incidentSource.safeParse({title:blank,rawLog:'log'}).success).toBe(false)
  expect(incidentSource.safeParse({title:'title',rawLog:blank}).success).toBe(false)
})
it.each([503, 200])('treats ambiguous server results as an unknown save for HTTP %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({success:false,uncertain:true}, {status})))
  await expect(createIncidentConfirmed({title:'Test',rawLog:'log',status:'Pending analysis'})).rejects.toThrow('Mutation confirmation timed out')
})
it('distinguishes an explicit validation refusal from an uncertain save', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({success:false,error:'Enter the original logs.'})))
  await expect(createIncidentConfirmed({title:'Test',rawLog:' ',status:'Pending analysis'})).rejects.toThrow('Enter the original logs.')
})

it('blocks oversized form submission before trimming or sending any write', async () => {
  const save = vi.fn()
  const changed = vi.fn()
  const flow = createIncidentSaveFlow(changed)
  await flow.submit({title:'x'.repeat(121),rawLog:'log'},save)
  await flow.submit({title:'Test',rawLog:'x'.repeat(20000)+' '},save)
  expect(save).not.toHaveBeenCalled()
  expect(changed).toHaveBeenLastCalledWith({phase:'idle',error:'Original logs exceed the 20,000-character limit. Shorten them before saving.'})
})

it('shows a definite rate refusal without entering uncertain-save review', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({success:false,code:'rate_limited',retryAfterSeconds:12,error:'Too many requests. Try again in 12 seconds.'},{status:429})))
  const changed=vi.fn()
  const flow=createIncidentSaveFlow(changed)
  await flow.submit({title:'Keep this title',rawLog:'Keep these logs'},createIncidentConfirmed)
  expect(changed).toHaveBeenLastCalledWith({phase:'idle',error:'Too many requests. Try again in 12 seconds. Your input is unchanged.'})
  expect(flow.canReplaceInput()).toBe(true)
})

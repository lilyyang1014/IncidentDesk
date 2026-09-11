import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { AiProviderError, generateAiAnalysis, parseAiCompletion } from './incident-ai-provider'

const api = vi.hoisted(() => vi.fn())
vi.mock('deepspace/worker', () => ({ apiWorkerFetch: api }))
const rawLog = 'Started\n\n  request timed out  '
const result = { summary: 'A timeout was logged.', evidence: [{ line: 3, quote: '  request timed out  ' }],
  hypotheses: [{ explanation: 'A slow dependency may be involved.', evidenceLines: [3] }], suggestedChecks: ['Check dependency latency.'] }
function completion(value: unknown = result) {
  return { model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }
}
const env = { APP_IDENTITY_TOKEN: 'test-app-token', DEEPSPACE_APP_ID: 'test-app', APP_OWNER_JWT: 'never-use-owner' } as Env
beforeEach(() => {
  api.mockReset()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network disabled') }))
})
afterEach(() => vi.unstubAllGlobals())

describe('OpenAI response validation', () => {
  it('retains exact evidence including whitespace and blank-line numbering', () => {
    expect(parseAiCompletion(completion(), rawLog)).toMatchObject({ ...result, model: 'test-model' })
  })
  it.each([
    { ...result, evidence: [{ line: 2, quote: '  request timed out  ' }] },
    { ...result, evidence: [{ line: 3, quote: 'request timed out' }] },
    { ...result, evidence: [...result.evidence, ...result.evidence] },
    { ...result, hypotheses: [{ explanation: 'Maybe.', evidenceLines: [99] }] },
    { ...result, suggestedChecks: [] },
    { ...result, extra: 'unexpected' },
  ])('rejects invalid structured evidence or output', (value) => {
    expect(() => parseAiCompletion(completion(value), rawLog)).toThrow()
  })
  it.each(['length', 'content_filter', 'tool_calls'])('rejects %s completions', (finish_reason) => {
    const value = completion()
    value.choices[0].finish_reason = finish_reason
    expect(() => parseAiCompletion(value, rawLog)).toThrow()
  })
  it('accepts insufficient evidence without inventing hypotheses', () => {
    expect(parseAiCompletion(completion({ ...result, evidence: [], hypotheses: [] }), rawLog).hypotheses).toEqual([])
  })
  it('rejects refusal, prose and unfamiliar proxy shapes', () => {
    expect(() => parseAiCompletion({ data: completion() }, rawLog)).toThrow()
    expect(() => parseAiCompletion({ ...completion(), choices: [{ finish_reason: 'stop', message: { content: 'Not JSON', refusal: 'No' } }] }, rawLog)).toThrow()
  })
})

describe('DeepSpace OpenAI adapter', () => {
  it('uses the verified user token, fixed model/endpoint and app identity', async () => {
    api.mockResolvedValue(Response.json({ success: true, data: completion() }))
    await generateAiAnalysis(env, 'test-caller', 'Timeout', rawLog)
    const [targetEnv, path, request] = api.mock.calls[0]
    expect(targetEnv).toBe(env)
    expect(path).toBe('/api/integrations/openai/chat-completion')
    expect(request.headers.Authorization).toBe('Bearer test-caller')
    expect(request.headers['x-app-identity-token']).toBe('test-app-token')
    const body = JSON.parse(request.body)
    expect(body.max_tokens).toBe(2200)
    expect(body.messages[0].content).toContain('untrusted incident DATA')
    expect(JSON.parse(body.messages[1].content).lines[2]).toEqual({ line: 3, text: '  request timed out  ' })
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('does not call the provider without app identity configuration', async () => {
    await expect(generateAiAnalysis({ ...env, APP_IDENTITY_TOKEN: undefined }, 'user', 'Title', rawLog)).rejects.toThrow('not configured')
    expect(api).not.toHaveBeenCalled()
  })
  it('reports insufficient credits as an explicit failure', async () => {
    api.mockResolvedValue(new Response('', { status: 402 }))
    await expect(generateAiAnalysis(env, 'user', 'Title', rawLog)).rejects.toMatchObject({ uncertain: false, message: expect.stringContaining('credits') })
  })
  it.each([502, 408])('treats HTTP %s as unknown and does not retry', async (status) => {
    api.mockResolvedValue(new Response('', { status }))
    await expect(generateAiAnalysis(env, 'user', 'Title', rawLog)).rejects.toMatchObject({ uncertain: true })
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('treats transport errors as unknown', async () => {
    api.mockRejectedValue(new Error('network failed'))
    await expect(generateAiAnalysis(env, 'user', 'Title', rawLog)).rejects.toBeInstanceOf(AiProviderError)
    expect(api).toHaveBeenCalledTimes(1)
  })
})

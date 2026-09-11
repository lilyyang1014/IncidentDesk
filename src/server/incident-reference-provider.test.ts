import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../worker'
import { parseReferences, searchReferences } from './incident-reference-provider'
const api = vi.hoisted(() => vi.fn())
vi.mock('deepspace/worker', () => ({ apiWorkerFetch: api }))
const env = { APP_IDENTITY_TOKEN: 'test-identity', DEEPSPACE_APP_ID: 'test-app' } as Env
beforeEach(() => api.mockReset())
describe('Exa result validation and billing boundary', () => {
  it('accepts empty results and deduplicates links', () => {
    expect(parseReferences({ results: [] }, 'timeout').items).toEqual([])
    const item = { title: 'Docs', url: 'https://example.test/docs', text: 'x'.repeat(2000) }
    const result = parseReferences({ results: [item, item] }, 'timeout')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].excerpt).toHaveLength(1500)
  })
  it.each(['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.test'])('rejects unsafe source %s', (url) => {
    expect(() => parseReferences({ results: [{ title: 'Docs', url }] }, 'timeout')).toThrow()
  })
  it('rejects malformed responses instead of saving empty success', () => {
    expect(() => parseReferences({}, 'timeout')).toThrow()
    expect(() => parseReferences({ results: [{ title: 'Missing URL' }] }, 'timeout')).toThrow()
  })
  it('sends only the chosen query with fixed limits and caller billing identity', async () => {
    api.mockResolvedValue(Response.json({ success: true, data: { results: [] } }))
    await searchReferences(env, 'caller', 'timeout')
    const [, path, request] = api.mock.calls[0]
    expect(path).toBe('/api/integrations/exa/search')
    expect(request.headers.Authorization).toBe('Bearer caller')
    expect(JSON.parse(request.body)).toEqual({ query: 'timeout', numResults: 5, type: 'auto', contents: { text: { maxCharacters: 1500, includeHtmlTags: false } } })
  })
  it('does not invoke without app identity', async () => {
    await expect(searchReferences({} as Env, 'caller', 'timeout')).rejects.toThrow('not configured')
    expect(api).not.toHaveBeenCalled()
  })
  it.each([402, 429])('permits manual recovery from explicit HTTP %s rejection', async (status) => {
    api.mockResolvedValue(new Response('', { status }))
    await expect(searchReferences(env, 'caller', 'timeout')).rejects.toMatchObject({ uncertain: false })
    expect(api).toHaveBeenCalledTimes(1)
  })
  it.each([408, 500])('blocks retries for uncertain HTTP %s', async (status) => {
    api.mockResolvedValue(new Response('', { status }))
    await expect(searchReferences(env, 'caller', 'timeout')).rejects.toMatchObject({ uncertain: true })
  })
  it('blocks retry after an unreadable provider success or connection failure', async () => {
    api.mockResolvedValueOnce(Response.json({ success: true, data: {} })).mockRejectedValueOnce(new Error('network'))
    await expect(searchReferences(env, 'caller', 'timeout')).rejects.toMatchObject({ uncertain: true })
    await expect(searchReferences(env, 'caller', 'timeout')).rejects.toMatchObject({ uncertain: true })
    expect(api).toHaveBeenCalledTimes(2)
  })
})

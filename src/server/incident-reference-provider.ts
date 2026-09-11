import { z } from 'zod'
import { apiWorkerFetch } from 'deepspace/worker'
import type { Env } from '../../worker'
import { referenceIntegration } from '../integrations'
import { referenceSchema, type ReferenceResult } from '../features/incidents/incident-reference-types'

export class ReferenceProviderError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message) }
}

export function parseReferences(data: unknown, query: string): ReferenceResult {
  const parsed = z.object({ results: z.array(z.object({
    title: z.string(), url: z.string(), text: z.string().nullable().optional(),
  })).max(5) }).parse(data)
  const items = parsed.results.map((item) => referenceSchema.parse({
    title: item.title, url: item.url, excerpt: (item.text ?? '').slice(0, 1500),
  }))
  return { query, searchedAt: new Date().toISOString(), items: items.filter((item, index) => items.findIndex((other) => other.url === item.url) === index) }
}

export async function searchReferences(env: Env, jwt: string, query: string): Promise<ReferenceResult> {
  if (!env.APP_IDENTITY_TOKEN) throw new ReferenceProviderError('Reference search is not configured.')
  let response: Response
  try {
    response = await apiWorkerFetch(env, `/api/integrations/${referenceIntegration.endpoint}`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`,
        'x-app-id': env.DEEPSPACE_APP_ID, 'x-app-identity-token': env.APP_IDENTITY_TOKEN },
      body: JSON.stringify({ query, numResults: 5, type: 'auto', contents: { text: { maxCharacters: 1500, includeHtmlTags: false } } }),
    })
  } catch { throw new ReferenceProviderError('Search outcome unknown. Check status; no automatic retry will occur.', true) }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 408) throw new ReferenceProviderError('Search outcome unknown. Another request for this query is blocked.', true)
    throw new ReferenceProviderError(response.status === 402 ? 'Your DeepSpace account has insufficient credits.' : 'Search was rejected. Check account access or try later.')
  }
  try {
    const envelope = z.object({ success: z.literal(true), data: z.unknown() }).parse(await response.json())
    return parseReferences(envelope.data, query)
  } catch { throw new ReferenceProviderError('The search response could not be verified. Another request for this query is blocked.', true) }
}

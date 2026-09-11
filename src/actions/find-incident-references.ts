import type { ActionHandler } from 'deepspace/worker'
import { z } from 'zod'
import { searchQuery } from '../features/incidents/incident-reference-types'
import type { Env } from '../../worker'

export const referenceRequest = z.object({
  incidentId: z.string().min(1).max(200),
  intent: z.enum(['status', 'search']),
  query: searchQuery.optional(),
}).strict().refine((input) => input.intent !== 'search' || !!input.query)

export const findIncidentReferences: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const parsed = referenceRequest.safeParse(params)
  if (!parsed.success) return { success: false, error: 'Invalid reference request.' }
  // One private coordinator per app: concurrent requests from separate tabs,
  // devices and accounts contend on the same input receipt.
  const room = env.INCIDENT_REFERENCE_ROOMS.get(env.INCIDENT_REFERENCE_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/references', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${callerJwt}` },
    body: JSON.stringify(parsed.data),
  }))
  return response.json()
}

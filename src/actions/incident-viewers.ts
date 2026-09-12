import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { viewerRequest } from '../features/incidents/collaboration/viewer-types'
import { incidentDigest } from '../server/incident-identity'

export const incidentViewers: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const input = viewerRequest.safeParse(params)
  if (!input.success) return { success: false, error: 'Invalid presence request.' }
  const scope = await incidentDigest([env.DEEPSPACE_APP_ID, input.data.incidentId, input.data.incidentCreatedAt])
  const room = env.PRESENCE_ROOMS.get(env.PRESENCE_ROOMS.idFromName(`incident-viewers:v1:${scope}`))
  const response = await room.fetch(new Request('https://internal/incident-viewers', {
    method: 'POST', headers: { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data),
  }))
  return response.json()
}

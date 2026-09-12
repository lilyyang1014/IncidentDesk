import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { collaborationRequest } from '../features/incidents/collaboration/collaboration-types'
export const incidentCollaboration: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const input = collaborationRequest.safeParse(params)
  if (!input.success) return { success: false, error: 'Invalid collaboration request.' }
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/incident-collaboration', {
    method: 'POST', headers: { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data),
  }))
  return response.json()
}

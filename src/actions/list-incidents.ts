import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { incidentListRequest } from '../features/incidents/incident-list-types'

export const listIncidents: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const input = incidentListRequest.safeParse(params)
  if (!input.success) return { success: false, error: 'Invalid incident list request.' }
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/incident-list', {
    method: 'POST', headers: { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data),
  }))
  return response.json()
}

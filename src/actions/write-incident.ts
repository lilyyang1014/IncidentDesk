import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { incidentWriteRequest } from '../features/incidents/incident-write-types'
export const saveIncident: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const input = incidentWriteRequest.safeParse(params)
  if (!input.success) return { success: false, error: input.error.issues[0].message }
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/incident-write', {
    method: 'POST', headers: { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data),
  }))
  const result = await response.json() as ActionResult
  return response.status >= 500 ? { success: false, uncertain: true, error: 'Could not confirm the save. Check the saved incident before retrying.' } : result
}

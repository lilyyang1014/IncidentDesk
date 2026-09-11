import type { ActionHandler } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'

export const analysisRequest = z.object({
  incidentId: z.string().min(1).max(200),
  intent: z.enum(['status', 'generate']),
}).strict()

export const analyzeIncident: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const parsed = analysisRequest.safeParse(params)
  if (!parsed.success) return { success: false, error: 'Invalid analysis request.' }
  // One private coordinator per app: concurrent requests from separate tabs,
  // devices and accounts contend on the same input receipt.
  const room = env.INCIDENT_AI_ROOMS.get(env.INCIDENT_AI_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${callerJwt}` },
    body: JSON.stringify(parsed.data),
  }))
  return response.json()
}

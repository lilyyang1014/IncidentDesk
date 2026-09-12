import { z } from 'zod'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { recipientSchema, subjectSchema } from '../features/incidents/incident-email-types'
const id = z.string().min(1).max(200)
export const emailRequest = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('prepare'), incidentId: id, to: recipientSchema, subject: subjectSchema, includeLogs: z.boolean() }).strict(),
  z.object({ intent: z.literal('status'), incidentId: id }).strict(),
  z.object({ intent: z.literal('send'), incidentId: id, draftId: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
])
export const incidentEmail: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const input = emailRequest.safeParse(params)
  if (!input.success) return { success: false, error: 'Invalid email request.' }
  const room = env.INCIDENT_EMAIL_ROOMS.get(env.INCIDENT_EMAIL_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/email', { method: 'POST', headers: { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data) }))
  return response.json()
}

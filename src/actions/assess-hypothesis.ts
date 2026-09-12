import { z } from 'zod'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { assessmentRequest } from '../features/incidents/collaboration/hypothesis-types'

export const assessHypothesis: ActionHandler<Env> = async ({ params, callerJwt, env }) => {
  const parsed = assessmentRequest.safeParse(params)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const headers = { Authorization: `Bearer ${callerJwt}`, 'Content-Type': 'application/json' }
  let verified: unknown
  if (parsed.data.intent === 'save') {
    // Read the saved result before entering RecordRoom's gate. The AI room reads
    // RecordRoom itself; calling it from inside that gate would deadlock.
    const ai = env.INCIDENT_AI_ROOMS.get(env.INCIDENT_AI_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    const response = await ai.fetch(new Request('https://internal/analysis', { method: 'POST', headers,
      body: JSON.stringify({ incidentId: parsed.data.incidentId, intent: 'status' }),
    }))
    const saved = z.object({ success: z.literal(true), data: z.object({
      phase: z.literal('complete'), analysisVersion: z.string(), sourceVersion: z.string(),
      result: z.object({ hypotheses: z.array(z.object({ explanation: z.string(), evidenceLines: z.array(z.number()) })) }),
    }) }).safeParse(await response.json())
    if (!response.ok || !saved.success || saved.data.data.analysisVersion !== parsed.data.analysisVersion) {
      return { success: false, code: 'conflict', error: 'The saved AI result changed or is unavailable. Reopen Analysis before making a judgment.' }
    }
    const hypothesis = saved.data.data.result.hypotheses[parsed.data.hypothesisIndex]
    if (!hypothesis) return { success: false, code: 'invalid', error: 'This hypothesis does not exist in the saved AI result.' }
    verified = { ...hypothesis, sourceVersion: saved.data.data.sourceVersion }
  }
  // This DO path is internal-only. Strict public input never accepts `verified`.
  // RecordRoom rechecks current membership and source before writing.
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await room.fetch(new Request('https://internal/incident-assessment', { method: 'POST', headers,
    body: JSON.stringify({ input: parsed.data, verified }),
  }))
  return response.json()
}

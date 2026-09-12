import { requestIncidentAi } from './incident-ai-client'
import { requestReferences } from './incident-reference-client'

/** Read saved results only. Preview never generates content or sends mail. */
export async function loadHandoffResults(incidentId: string, signal?: AbortSignal) {
  const [ai, references] = await Promise.all([
    requestIncidentAi(incidentId, 'status', signal),
    requestReferences(incidentId, 'report', undefined, signal),
  ])
  return { ai, references }
}
export type HandoffResults = Awaited<ReturnType<typeof loadHandoffResults>>

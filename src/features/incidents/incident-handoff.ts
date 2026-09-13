import { investigationAction } from './collaboration/investigation-client'
import { findingsSnapshotSchema } from './incident-findings-types'
import { requestIncidentAi } from './incident-ai-client'
import { requestReferences } from './incident-reference-client'

/** Read saved results only. Preview never generates content or sends mail. */
export async function loadHandoffResults(incidentId: string, signal?: AbortSignal) {
  const [ai, references] = await Promise.all([
    requestIncidentAi(incidentId, 'status', signal),
    requestReferences(incidentId, 'report', undefined, signal),
  ])
  const findings = ai.phase === 'complete' && ai.result ? findingsSnapshotSchema.parse(await investigationAction('incidentFindings', { incidentId, analysisVersion: ai.analysisVersion }, signal)) : undefined
  return { ai, references, findings }
}
export type HandoffResults = Awaited<ReturnType<typeof loadHandoffResults>>

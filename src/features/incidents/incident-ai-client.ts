import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import type { AiAnalysisState } from './incident-ai-types'

const stateSchema = z.object({
  phase: z.enum(['idle', 'running', 'complete', 'failed', 'unknown']),
  canGenerate: z.boolean(), error: z.string().optional(),
  result: z.object({
    summary: z.string(), model: z.string(), generatedAt: z.string(),
    evidence: z.array(z.object({ line: z.number().int().positive(), quote: z.string() })),
    hypotheses: z.array(z.object({ explanation: z.string(), evidenceLines: z.array(z.number().int().positive()) })),
    suggestedChecks: z.array(z.string()),
  }).optional(),
}).refine((state) => state.phase !== 'complete' || !!state.result)

export async function requestIncidentAi(incidentId: string, intent: 'status' | 'generate', signal?: AbortSignal): Promise<AiAnalysisState> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to access AI analysis.')
  const response = await fetch('/api/actions/analyzeIncident', {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(110000)]) : AbortSignal.timeout(110000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId, intent }),
  })
  const body = z.object({ success: z.boolean(), error: z.string().optional(), data: z.unknown().optional() }).parse(await response.json())
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not load AI analysis. Check status before trying again.')
  const state = stateSchema.safeParse(body.data)
  if (!state.success) throw new Error('Unexpected analysis response. Check status before trying again.')
  return state.data
}

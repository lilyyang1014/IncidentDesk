import { z } from 'zod'
import { assessmentStatus } from './collaboration/hypothesis-types'
export const findingSchema = z.object({ hypothesisIndex: z.number().int().min(0).max(19), explanation: z.string(), status: assessmentStatus,
  reason: z.string().max(1000), actorId: z.string(), actorName: z.string(), judgedAt: z.string(), sequence: z.number().int().positive() })
export const findingsSnapshotSchema = z.object({ analysisVersion: z.string(), sourceVersion: z.string(), capturedAt: z.string(), findings: z.array(findingSchema).max(20) })
export type FindingsSnapshot = z.infer<typeof findingsSnapshotSchema>
export function formatFindings(snapshot?: FindingsSnapshot): string {
  const lines = ['Investigation findings', 'Human judgments, not AI conclusions or proof of root cause.']
  if (!snapshot) return [...lines, 'No completed AI analysis was available for investigation findings.'].join('\n')
  lines.push(`Analysis version: ${snapshot.analysisVersion}`)
  if (!snapshot.findings.length) lines.push('No human judgments recorded for this analysis version.')
  for (const f of snapshot.findings) lines.push('', `Hypothesis ${f.hypothesisIndex + 1}: ${f.explanation}`, `Human judgment: ${f.status} · Revision ${f.sequence}`, `Evidence and reason: ${f.reason}`, `Judged by: ${f.actorName} (${f.actorId})`, `Judged at: ${f.judgedAt}`)
  return lines.join('\n')
}

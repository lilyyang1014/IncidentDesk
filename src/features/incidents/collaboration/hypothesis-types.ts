import { z } from 'zod'

export const assessmentStatus = z.enum(['Unverified', 'Confirmed', 'Ruled out'])
export const assessmentScope = z.object({
  incidentId: z.string().min(1).max(200), incidentCreatedAt: z.string().min(1).max(100),
  analysisVersion: z.string().regex(/^[a-f0-9]{64}$/), hypothesisIndex: z.number().int().min(0).max(19),
})
export const assessmentRequest = z.discriminatedUnion('intent', [
  assessmentScope.extend({ intent: z.literal('save'), requestId: z.uuid(), expectedSequence: z.number().int().min(0),
    status: assessmentStatus, reason: z.string().trim().min(1, 'Explain the evidence behind your judgment.').refine(value => value.length <= 1000, 'Keep the reason within 1,000 characters.'),
  }).strict(),
  assessmentScope.extend({ intent: z.literal('history'), before: z.number().int().positive().optional() }).strict(),
])
export type AssessmentRequest = z.infer<typeof assessmentRequest>
export type AssessmentScope = z.infer<typeof assessmentScope>
export type HypothesisAssessment = AssessmentScope & {
  incidentOwner: string; sequence: number; status: z.infer<typeof assessmentStatus>; reason: string
  sourceVersion: string; explanation: string; evidenceLines: string; previousSequence: number
}
export const HISTORY_PAGE_SIZE = 10

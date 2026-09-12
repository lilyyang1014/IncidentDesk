import { z } from 'zod'
import { INCIDENT_TITLE_LIMIT, INCIDENT_LOG_LIMIT } from './incident-source-limits'

// Match browser maxlength / JavaScript length (UTF-16 code units). Do not trim
// on the server: preserving saved log whitespace keeps evidence line numbers stable.
export const incidentSource = z.object({
  title: z.string().refine(value => value.length <= INCIDENT_TITLE_LIMIT, 'Incident title must be at most 120 characters.').refine(value => !!value.trim(), 'Enter an incident title.'),
  rawLog: z.string().refine(value => value.length <= INCIDENT_LOG_LIMIT, 'Original logs must be at most 20,000 characters.').refine(value => !!value.trim(), 'Enter the original logs.'),
})
const patch = incidentSource.partial().extend({
  status: z.enum(['Pending analysis', 'Analyzing', 'Analysis ready', 'Analysis failed']).optional(),
  analysisSummary: z.string().optional(), analysisSignals: z.string().optional(), analysisEvidence: z.string().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Provide a change.')
export const incidentWriteRequest = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('create'), requestId: z.string().uuid(), data: incidentSource.strict() }).strict(),
  z.object({ intent: z.literal('update'), incidentId: z.string().min(1).max(200), incidentCreatedAt: z.string(),
    expectedSource: z.object({ title: z.string(), rawLog: z.string() }).strict(), data: patch }).strict(),
])
export type IncidentWriteRequest = z.infer<typeof incidentWriteRequest>

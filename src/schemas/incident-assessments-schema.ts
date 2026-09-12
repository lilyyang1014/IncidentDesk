import type { CollectionSchema } from 'deepspace/schema'
import { incidentNotesSchema } from './incident-collaboration-schema'

// Reuse the parent-derived access policy, including revocation of authors.
export const incidentAssessmentsSchema: CollectionSchema = {
  ...incidentNotesSchema,
  name: 'incident_assessments',
  columns: [
    ...incidentNotesSchema.columns.filter(column => column.name !== 'body').map(column => ({
      ...column, ...(column.expression ? { expression: column.expression.replaceAll('c_incident_notes', 'c_incident_assessments') } : {}),
    })),
    ...['analysisVersion', 'sourceVersion', 'status', 'reason', 'explanation', 'evidenceLines'].map(name => ({
      name, id: `col_${name.toLowerCase()}`, storage: 'text' as const, interpretation: 'plain' as const, required: true, immutable: true,
    })),
    ...['hypothesisIndex', 'previousSequence'].map(name => ({ name, storage: 'number' as const, interpretation: 'plain' as const, required: true, immutable: true })),
  ],
  uniqueOn: ['incidentId', 'incidentCreatedAt', 'incidentOwner', 'analysisVersion', 'hypothesisIndex', 'sequence'],
}

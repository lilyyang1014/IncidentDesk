import type { CollectionSchema } from 'deepspace/schema'
import { incidentCollaborators } from './incident-collaboration-schema'

export const incidentsSchema: CollectionSchema = {
  name: 'incidents',
  columns: [
    incidentCollaborators,
    {
      name: 'title',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'rawLog',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'status',
      storage: 'text',
      interpretation: {
        kind: 'select',
        // Legacy intermediate/failure values remain readable and retryable.
        // Local analysis now writes only the complete result and final status.
        options: ['Pending analysis', 'Analyzing', 'Analysis ready', 'Analysis failed'],
      },
      default: 'Pending analysis',
      required: true,
    },
    { name: 'analysisSummary', storage: 'text', interpretation: 'plain', required: false },
    { name: 'analysisSignals', storage: 'text', interpretation: 'plain', required: false },
    { name: 'analysisEvidence', storage: 'text', interpretation: 'plain', required: false },
  ],
  collaboratorsField: 'collaborators',
  permissions: {
    viewer: { read: 'collaborator', create: true, update: 'own', delete: 'own' },
    member: { read: 'collaborator', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

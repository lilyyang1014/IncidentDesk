import type { CollectionSchema } from 'deepspace/schema'

export const incidentsSchema: CollectionSchema = {
  name: 'incidents',
  columns: [
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
  permissions: {
    viewer: { read: 'own', create: true, update: 'own', delete: 'own' },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

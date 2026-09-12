import { z } from 'zod'
export const MAX_COLLABORATORS = 1
export const NOTE_LIMIT = 2000
export const NOTES_PAGE_SIZE = 50
const id = z.string().min(1).max(200)
const base = { incidentId: id, incidentCreatedAt: z.string().min(1).max(100) }
export const collaborationRequest = z.discriminatedUnion('intent', [
  z.object({ ...base, intent: z.literal('add'), userId: id }).strict(),
  z.object({ ...base, intent: z.literal('remove'), userId: id }).strict(),
  z.object({ ...base, intent: z.literal('note'), body: z.string().trim().min(1).max(NOTE_LIMIT), requestId: z.string().uuid() }).strict(),
])
export type CollaborationRequest = z.infer<typeof collaborationRequest>
export type IncidentNote = { incidentId: string; incidentCreatedAt: string; incidentOwner: string; body: string; sequence: number }

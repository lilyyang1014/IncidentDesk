import { z } from 'zod'
export const VIEWER_REFRESH_MS = 10000
export const VIEWER_TTL_MS = 30000
export const viewerRequest = z.object({
  incidentId: z.string().min(1).max(200), incidentCreatedAt: z.string().min(1).max(100),
  sessionId: z.uuid(), intent: z.enum(['heartbeat', 'leave']),
}).strict()
export const viewerSchema = z.object({ userId: z.string(), name: z.string(), image: z.string().optional() })
export type IncidentViewer = z.infer<typeof viewerSchema>

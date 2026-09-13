import { z } from 'zod'

export const INCIDENT_PAGE_SIZE = 20
export const incidentListView = z.enum(['mine', 'shared'])
export type IncidentListView = z.infer<typeof incidentListView>
export const incidentListEntry = z.object({ recordId: z.string().min(1).max(512), createdAt: z.string().min(1).max(64), createdBy: z.string().min(1).max(256) })
export const incidentListCursor = incidentListEntry.extend({ userId: z.string().min(1).max(256), view: incidentListView }).strict()
export const incidentListRequest = z.object({ view: incidentListView, cursor: incidentListCursor.optional() }).strict()
export const incidentListPage = z.object({ entries: z.array(incidentListEntry).max(INCIDENT_PAGE_SIZE), nextCursor: incidentListCursor.nullable() })
export type IncidentListEntry = z.infer<typeof incidentListEntry>
export type IncidentListCursor = z.infer<typeof incidentListCursor>
export type IncidentListPage = z.infer<typeof incidentListPage>

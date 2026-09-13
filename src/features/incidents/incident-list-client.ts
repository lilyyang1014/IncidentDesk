import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import { incidentListPage, type IncidentListCursor, type IncidentListView } from './incident-list-types'

export async function fetchIncidentPage(view: IncidentListView, cursor: IncidentListCursor | null, signal: AbortSignal) {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to load incidents.')
  const response = await fetch('/api/actions/listIncidents', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ view, ...(cursor ? { cursor } : {}) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  })
  const body = z.object({ success: z.boolean(), error: z.string().optional(), data: incidentListPage.optional() }).parse(await response.json())
  if (!response.ok || !body.success || !body.data) throw new Error(body.error ?? 'Could not load incidents. Try again.')
  return body.data
}

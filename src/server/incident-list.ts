import type { ActionResult } from 'deepspace/worker'
import { z } from 'zod'
import { INCIDENT_PAGE_SIZE, incidentListEntry, incidentListRequest } from '../features/incidents/incident-list-types'

type Tool = (userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>

/** Called in the same authenticated RecordRoom gate as membership changes.
 * Query the caller's indexed relation BEFORE LIMIT; unrelated private rows do
 * not consume a permission-filtered SDK scan. Hydrate only explicit IDs through
 * the SDK to retain authoritative read permission checks and envelope parsing.
 */
export async function listIncidentsInRoom(input: z.infer<typeof incidentListRequest>, userId: string, tool: Tool, sql: SqlStorage) {
  if (input.cursor && (input.cursor.userId !== userId || input.cursor.view !== input.view)) {
    return Response.json({ success: false, error: 'This page belongs to another list. Refresh the list.' }, { status: 400 })
  }
  sql.exec('CREATE INDEX IF NOT EXISTS incident_creator_page ON c_incidents (_created_by, _created_at DESC, _row_id DESC)')
  sql.exec('CREATE INDEX IF NOT EXISTS incident_shared_page ON c_incident_members (col_userid, col_incidentcreatedat DESC, col_incidentid DESC, col_incidentowner)')
  const before = input.cursor
  const bound = before ? [before.createdAt, before.recordId] : []
  const rows = input.view === 'mine'
    ? sql.exec<{ id: string }>(`SELECT _row_id AS id FROM c_incidents
        WHERE _created_by = ? ${before ? 'AND (_created_at, _row_id) < (?, ?)' : ''}
        ORDER BY _created_at DESC, _row_id DESC LIMIT ?`, userId, ...bound, INCIDENT_PAGE_SIZE + 1).toArray()
    : sql.exec<{ id: string }>(`SELECT i._row_id AS id FROM c_incident_members m
        JOIN c_incidents i ON i._row_id = m.col_incidentid AND i._created_at = m.col_incidentcreatedat AND i._created_by = m.col_incidentowner
        WHERE m.col_userid = ? AND i._created_by != ? ${before ? 'AND (m.col_incidentcreatedat, m.col_incidentid) < (?, ?)' : ''}
        ORDER BY m.col_incidentcreatedat DESC, m.col_incidentid DESC LIMIT ?`, userId, userId, ...bound, INCIDENT_PAGE_SIZE + 1).toArray()
  const entries = []
  for (const row of rows.slice(0, INCIDENT_PAGE_SIZE)) {
    const result = await tool(userId, 'records.get', { collection: 'incidents', recordId: row.id })
    const parsed = incidentListEntry.safeParse(result.data?.record)
    if (!result.success || !parsed.success) return Response.json({ success: false, error: 'Could not load this list. Refresh and try again.' }, { status: 503 })
    entries.push(parsed.data)
  }
  const last = entries.at(-1)
  return Response.json({ success: true, data: { entries, nextCursor: rows.length > INCIDENT_PAGE_SIZE && last ? { ...last, userId, view: input.view } : null } })
}

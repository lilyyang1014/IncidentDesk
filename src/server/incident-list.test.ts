import { expect, it } from 'vitest'
import { listIncidentsInRoom } from './incident-list'
import { incidentListPage } from '../features/incidents/incident-list-types'

// Load the Node test runtime dynamically; app type-checking intentionally uses
// Workers types without Node globals. This import never enters the app bundle.
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = await import(sqliteModule) as { DatabaseSync: new (path: string) => {
  exec(sql: string): void
  close(): void
  prepare(sql: string): { run(...values: (string | number)[]): unknown; get(...values: (string | number)[]): Record<string, string> | undefined; all(...values: (string | number)[]): unknown[] }
} }

it('paginates identical timestamps with a deterministic ID boundary and indexed lookups', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE c_incidents (_row_id TEXT PRIMARY KEY, _created_at TEXT, _created_by TEXT);
      CREATE TABLE c_incident_members (col_incidentid TEXT, col_incidentcreatedat TEXT, col_incidentowner TEXT, col_userid TEXT);`)
    const timestamp = '2026-09-12T00:00:00.000Z'
    for (let i = 0; i < 42; i++) {
      const id = `incident-${String(i).padStart(3, '0')}`
      db.prepare('INSERT INTO c_incidents VALUES (?, ?, ?)').run(id, timestamp, 'a')
      db.prepare('INSERT INTO c_incident_members VALUES (?, ?, ?, ?)').run(id, timestamp, 'a', 'b')
    }
    const selects: { sql: string; bindings: (string | number)[] }[] = []
    // CREATE INDEX must execute immediately, as in Workers SqlStorage.
    const sql = { exec(statement: string, ...bindings: (string | number)[]) {
      if (statement.startsWith('CREATE')) { db.exec(statement); return { toArray: () => [] } }
      selects.push({ sql: statement, bindings })
      return { toArray: () => db.prepare(statement).all(...bindings) }
    } } as unknown as SqlStorage
    const tool = async (_user: string, _name: string, params: Record<string, unknown>) => {
      const row = db.prepare('SELECT * FROM c_incidents WHERE _row_id = ?').get(params.recordId as string)!
      return { success: true as const, data: { record: { recordId: row._row_id, createdAt: row._created_at, createdBy: row._created_by } } }
    }
    for (const view of ['mine', 'shared'] as const) {
      const user = view === 'mine' ? 'a' : 'b'
      let cursor
      const ids: string[] = []
      do {
        const response = await listIncidentsInRoom({ view, ...(cursor ? { cursor } : {}) }, user, tool, sql)
        const page = incidentListPage.parse((await response.json() as { data: unknown }).data)
        ids.push(...page.entries.map(entry => entry.recordId)); cursor = page.nextCursor
      } while (cursor)
      expect(ids).toEqual(Array.from({ length: 42 }, (_, i) => `incident-${String(41 - i).padStart(3, '0')}`))
    }
    for (const query of selects) {
      const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.bindings))
      expect(plan).toContain(query.sql.includes('JOIN') ? 'incident_shared_page' : 'incident_creator_page')
      expect(plan).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    }
  } finally { db.close() }
})

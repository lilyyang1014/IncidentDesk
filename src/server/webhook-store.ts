import { RECORD_NOT_FOUND, type ActionResult } from 'deepspace/worker'
import { z } from 'zod'
import { type SourceRequest, type WebhookEvent } from '../features/incidents/webhooks/webhook-types'

// Private SQLite only. These tables are never SDK collections or client queries.
export const WEBHOOK_LIMITS = { sources: 100, sourceBurst: 3, sourceIntervalMs: 12000, appBurst: 10, appIntervalMs: 1000, sourceDaily: 100, appDaily: 1000, sourceTotal: 1000, appTotal: 10000, maxAgeMs: 7 * 86400000 } as const
export type WebhookTool = (user: string, name: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
type Source = { owner: string; id: string; version: string; digest: string; enabled: number; changed: number }
type Budget = { tat: number; day: string; count: number; total: number }
type State = { observed: number; app: Budget; owners: Record<string, Budget> }
type Receipt = { source: string; event: string; fingerprint: string; recordid: string; phase: string; created: string | null }
export const webhookError = (status: number, code: string, error: string, retry?: number) => Response.json({ success: false, code, error }, { status, headers: { 'Cache-Control': 'no-store', ...(retry ? { 'Retry-After': String(retry) } : {}) } })
export async function webhookDigest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
export function initializeWebhooks(sql: SqlStorage) {
  sql.exec('CREATE TABLE IF NOT EXISTS webhook_sources (owner TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, enabled INTEGER NOT NULL, changed REAL NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS webhook_receipts (source TEXT NOT NULL, event TEXT NOT NULL, fingerprint TEXT NOT NULL, recordid TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, created TEXT, PRIMARY KEY(source,event))')
  sql.exec('CREATE TABLE IF NOT EXISTS webhook_requests (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
  sql.exec("CREATE TRIGGER IF NOT EXISTS webhook_incident_deleted AFTER DELETE ON c_incidents BEGIN UPDATE webhook_receipts SET phase='removed' WHERE recordid=OLD._row_id; END")
  sql.exec('CREATE TABLE IF NOT EXISTS webhook_budget (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
}
const emptyBudget = (now: number): Budget => ({ tat: now, day: new Date(now).toISOString().slice(0,10), count: 0, total: 0 })
const readState = (sql: SqlStorage, now: number): State => {
  const row = sql.exec<{ value: string }>('SELECT value FROM webhook_budget WHERE id=1').toArray()[0]
  return row ? JSON.parse(row.value) as State : { observed: now, app: emptyBudget(now), owners: {} }
}
export async function manageWebhook(sql: SqlStorage, user: string, input: SourceRequest, clock = Date.now()) {
  const old = sql.exec<Source>('SELECT * FROM webhook_sources WHERE owner=?', user).toArray()[0]
  const view = (source?: Source) => source ? { id: source.id, version: source.version, enabled: !!source.enabled, changedAt: new Date(source.changed).toISOString(), admitted: readState(sql, clock).owners[user]?.total ?? 0 } : null
  if (input.intent === 'status') return Response.json({ success: true, data: { source: view(old) } })
  if ((old?.version ?? null) !== input.expectedVersion) return webhookError(409, 'source_changed', 'Source changed. Check source status before trying again.')
  if (input.intent === 'disable') {
    if (!old) return webhookError(409, 'source_changed', 'No source exists.')
    sql.exec('UPDATE webhook_sources SET enabled=0 WHERE owner=?', user)
    return Response.json({ success: true, data: { source: view({ ...old, enabled: 0 }) } })
  }
  if (old && clock - old.changed < 60000) return webhookError(429, 'rate_limited', 'Wait one minute between token changes.', Math.max(1, Math.ceil((old.changed+60000-clock)/1000)))
  if (!old && sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM webhook_sources').toArray()[0].count >= WEBHOOK_LIMITS.sources) return webhookError(409, 'capacity_reached', 'This app has reached its webhook source limit.')
  const id = old?.id ?? crypto.randomUUID(), version = crypto.randomUUID()
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('')
  const token = `${id}.${secret}`, digest = await webhookDigest(token)
  const source: Source = { owner: user, id, version, digest, enabled: 1, changed: clock }
  sql.exec('INSERT INTO webhook_sources(owner,id,version,digest,enabled,changed) VALUES (?,?,?,?,1,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,digest=excluded.digest,enabled=1,changed=excluded.changed', user,id,version,digest,clock)
  return Response.json({ success: true, data: { source: view(source), token } })
}

/** All checks, admission and SDK writes run in the RecordRoom concurrency gate.
 * transactionSync commits quotas and the reservation together; SDK creation is
 * asynchronous and uses a stable ID, so its uncertain outcome is reconciled.
 */
export async function receiveWebhook(sql: SqlStorage, transaction: (fn: () => void) => void, token: string, input: WebhookEvent, tool: WebhookTool, clock = Date.now()) {
  const sourceId = token.split('.')[0]
  const source = sql.exec<Source>('SELECT * FROM webhook_sources WHERE id=?', sourceId).toArray()[0]
  const digest = await webhookDigest(token)
  let mismatch=0
  for(let i=0;i<64;i++) mismatch |= (source?.digest.charCodeAt(i) ?? 0)^digest.charCodeAt(i)
  if (!source || !source.enabled || mismatch !== 0) return webhookError(401, 'unauthorized', 'Invalid or disabled webhook source.')
  const requestRow=sql.exec<{value:string}>('SELECT value FROM webhook_requests WHERE id=1').toArray()[0]
  const requests: {app:number; owners:Record<string,number>} = requestRow ? JSON.parse(requestRow.value) : {app:clock,owners:{}}
  const requestWait=Math.max(Math.max(clock,requests.app)-49*20-clock,Math.max(clock,requests.owners[source.owner]??clock)-19*100-clock)
  if(requestWait>0)return webhookError(429,'request_rate_limited','Too many webhook requests. Retry later.',Math.max(1,Math.ceil(requestWait/1000)))
  requests.app=Math.max(clock,requests.app)+20;requests.owners[source.owner]=Math.max(clock,requests.owners[source.owner]??clock)+100
  sql.exec('INSERT INTO webhook_requests(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(requests))
  const account = await tool(source.owner, 'records.get', { collection: 'users', recordId: source.owner })
  const role = z.object({ data: z.object({ role: z.enum(['viewer','member','admin']) }) }).safeParse(account.data?.record)
  if (!account.success || !role.success) return webhookError(403, 'source_owner_unavailable', 'Source owner no longer has app access.')
  const fingerprint = await webhookDigest(JSON.stringify(input))
  let receipt = sql.exec<Receipt>('SELECT * FROM webhook_receipts WHERE source=? AND event=?', sourceId,input.eventId).toArray()[0]
  if(receipt?.phase==='removed')return webhookError(410,'incident_removed','The accepted incident was removed. It will not be recreated.')
  if (receipt && receipt.fingerprint !== fingerprint) return webhookError(409,'event_conflict','This event ID was already used for different content.')
  const state = readState(sql,clock), now = Math.max(clock,state.observed)
  if (!receipt) {
    const occurred = Date.parse(input.occurredAt)
    if (occurred < now-WEBHOOK_LIMITS.maxAgeMs || occurred > now+300000) return webhookError(400,'event_time_invalid','New events must be within the last seven days and no more than five minutes in the future.')
    const owner = state.owners[source.owner] ?? emptyBudget(now)
    const day = new Date(now).toISOString().slice(0,10)
    for (const budget of [owner,state.app]) if (budget.day !== day) { budget.day=day;budget.count=0 }
    if (owner.total>=WEBHOOK_LIMITS.sourceTotal || state.app.total>=WEBHOOK_LIMITS.appTotal) return webhookError(409,'capacity_reached','Webhook storage admission limit reached. Contact the app operator; retries do not reset this limit.')
    if (owner.count>=WEBHOOK_LIMITS.sourceDaily || state.app.count>=WEBHOOK_LIMITS.appDaily) return webhookError(429,'daily_limit','Webhook daily limit reached.',Math.ceil((Date.parse(`${day}T00:00:00Z`)+86400000-now)/1000))
    const wait = Math.max(Math.max(now,owner.tat)-(WEBHOOK_LIMITS.sourceBurst-1)*WEBHOOK_LIMITS.sourceIntervalMs-now,Math.max(now,state.app.tat)-(WEBHOOK_LIMITS.appBurst-1)*WEBHOOK_LIMITS.appIntervalMs-now)
    if (wait>0) return webhookError(429,'rate_limited','Webhook intake is busy. Retry the same event later.',Math.max(1,Math.ceil(wait/1000)))
    owner.tat=Math.max(now,owner.tat)+WEBHOOK_LIMITS.sourceIntervalMs;owner.count++;owner.total++
    state.app.tat=Math.max(now,state.app.tat)+WEBHOOK_LIMITS.appIntervalMs;state.app.count++;state.app.total++;state.observed=now;state.owners[source.owner]=owner
    const key = await webhookDigest(JSON.stringify([sourceId,input.eventId]))
    receipt = { source: sourceId, event: input.eventId, fingerprint, recordid: `webhook:${source.owner}:${key}`, phase: 'accepting', created: null }
    transaction(() => {
      sql.exec('INSERT INTO webhook_budget(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(state))
      sql.exec('INSERT INTO webhook_receipts(source,event,fingerprint,recordid,phase) VALUES (?,?,?,?,?)',sourceId,input.eventId,fingerprint,receipt!.recordid,'accepting')
    })
  }
  const found = await tool(source.owner,'records.get',{collection:'incidents',recordId:receipt.recordid})
  if (!found.success && found.error!==RECORD_NOT_FOUND) return webhookError(503,'outcome_unknown','Could not confirm storage. Retry the same event.',5)
  const record = z.object({ recordId:z.string(),createdBy:z.string(),createdAt:z.string() }).safeParse(found.data?.record)
  if (receipt.phase==='accepted') {
    if (!record.success || record.data.createdBy!==source.owner || record.data.createdAt!==receipt.created) return webhookError(410,'incident_removed','The accepted incident was removed or replaced. It will not be recreated.')
    return Response.json({success:true,data:{recordId:receipt.recordid,duplicate:true}},{status:200})
  }
  if (record.success && record.data.createdBy!==source.owner) return webhookError(409,'record_conflict','Could not reconcile the incident owner.')
  if (!record.success) {
    const rawLog=`Source event: ${input.eventId}\nOccurred at: ${input.occurredAt}\n${input.sourceUrl ? `Source URL: ${input.sourceUrl}\n` : ''}\n${input.summary}`
    const saved = await tool(source.owner,'records.create',{collection:'incidents',recordId:receipt.recordid,data:{title:input.title,rawLog,status:'Pending analysis'}})
    if (!saved.success) return webhookError(503,'outcome_unknown','Could not confirm storage. Retry the same event.',5)
  }
  const confirmed = record.success ? record : z.object({recordId:z.string(),createdBy:z.string(),createdAt:z.string()}).safeParse((await tool(source.owner,'records.get',{collection:'incidents',recordId:receipt.recordid})).data?.record)
  if (!confirmed.success || confirmed.data.createdBy!==source.owner) return webhookError(503,'outcome_unknown','Could not confirm storage. Retry the same event.',5)
  sql.exec("UPDATE webhook_receipts SET phase='accepted',created=? WHERE source=? AND event=?",confirmed.data.createdAt,sourceId,input.eventId)
  return Response.json({success:true,data:{recordId:receipt.recordid,duplicate:record.success}},{status:record.success?200:201})
}

/** Private admission state; never exposed as an SDK collection.
 * Called only inside the authenticated RecordRoom concurrency gate.
 * One SQL upsert commits both the bucket and its bounded retry reservations.
 */
export const WRITE_LIMITS = {
  create: { burst: 5, intervalMs: 12_000 },
  note: { burst: 10, intervalMs: 2_000 },
} as const
export type WriteOperation = keyof typeof WRITE_LIMITS
export type AdmitWrite = (operation: WriteOperation, requestKey: string, content: unknown) => Promise<Response | null>
type Receipt = { key: string; fingerprint: string; expires: number }
type Bucket = { tat: number; observed: number; receipts: string }

export async function reserveIncidentWrite(sql: SqlStorage, userId: string, operation: WriteOperation, requestKey: string, content: unknown, clock = Date.now()): Promise<Response | null> {
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)))), b => b.toString(16).padStart(2, '0')).join('')
  sql.exec('CREATE TABLE IF NOT EXISTS incident_write_limits (actor TEXT NOT NULL, operation TEXT NOT NULL, tat REAL NOT NULL, observed REAL NOT NULL, receipts TEXT NOT NULL, expires REAL NOT NULL, PRIMARY KEY(actor, operation))')
  sql.exec('CREATE INDEX IF NOT EXISTS incident_write_limits_expiry ON incident_write_limits(expires)')
  // Bounded opportunistic cleanup; no alarms or unbounded request history.
  sql.exec('DELETE FROM incident_write_limits WHERE rowid IN (SELECT rowid FROM incident_write_limits WHERE expires <= ? ORDER BY expires LIMIT 100)', clock)
  const row = sql.exec<Bucket>('SELECT tat, observed, receipts FROM incident_write_limits WHERE actor = ? AND operation = ?', userId, operation).toArray()[0]
  const now = Math.max(clock, row?.observed ?? clock)
  const receipts: Receipt[] = row ? (JSON.parse(row.receipts) as Receipt[]).filter(r => r.expires > now) : []
  const previous = receipts.find(r => r.key === requestKey)
  if (previous) return previous.fingerprint === fingerprint ? null : Response.json({ success: false, error: 'This request was already used for different content.' }, { status: 409 })
  const { burst, intervalMs } = WRITE_LIMITS[operation]
  const tat = Math.max(now, row?.tat ?? now)
  const wait = tat - (burst - 1) * intervalMs - now
  if (wait > 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil(wait / 1000))
    return Response.json({ success: false, code: 'rate_limited', retryAfterSeconds, error: `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.` }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } })
  }
  const expires = now + burst * intervalMs
  receipts.push({ key: requestKey, fingerprint, expires })
  sql.exec('INSERT INTO incident_write_limits(actor, operation, tat, observed, receipts, expires) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(actor, operation) DO UPDATE SET tat=excluded.tat, observed=excluded.observed, receipts=excluded.receipts, expires=excluded.expires', userId, operation, tat + intervalMs, now, JSON.stringify(receipts), expires)
  // Persist reservation BEFORE the SDK write. Never refund an uncertain write.
  // Matching retries reuse it until expiry; saved records deduplicate indefinitely
  // while retained. After expiry an unsaved retry needs fresh admission.
  return null
}

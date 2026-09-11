export const EXAMPLE_INCIDENTS = [
  {
    title: 'Checkout API failures',
    rawLog: `2026-09-10T10:01:12Z POST /api/checkout 500 Internal Server Error
2026-09-10T10:01:13Z payment provider request timed out
2026-09-10T10:01:15Z checkout request failed after 3 retries
2026-09-10T10:01:20Z error rate increased to 18 percent`,
  },
  {
    title: 'Authentication requests timing out',
    rawLog: `2026-09-10T11:14:02Z POST /api/auth/login 504 Gateway Timeout
2026-09-10T11:14:03Z identity provider request exceeded 5s timeout
2026-09-10T11:14:08Z login attempt failed after upstream timeout
2026-09-10T11:14:30Z authentication error rate increased to 11 percent`,
  },
  {
    title: 'Database connection pool exhausted',
    rawLog: `2026-09-10T12:22:41Z GET /api/orders 503 Service Unavailable
2026-09-10T12:22:41Z database connection pool reached maximum size
2026-09-10T12:22:45Z request queued for 10s waiting for a connection
2026-09-10T12:23:01Z order API recovered after pool pressure dropped`,
  },
  {
    title: 'Background job retry storm',
    rawLog: `2026-09-10T13:05:10Z job invoice-sync attempt 1 failed: upstream 502
2026-09-10T13:05:20Z job invoice-sync scheduled for retry in 10s
2026-09-10T13:05:30Z job invoice-sync attempt 2 failed: upstream 502
2026-09-10T13:05:31Z retry queue depth increased to 240 jobs`,
  },
  {
    title: 'Search index lagging behind writes',
    rawLog: `2026-09-10T14:40:00Z POST /api/catalog/items 201 Created
2026-09-10T14:40:02Z search index update queued for item item_4821
2026-09-10T14:41:45Z search index freshness exceeded 90 seconds
2026-09-10T14:42:10Z item visible in search after delayed indexing`,
  },
]

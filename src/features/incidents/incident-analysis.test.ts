import { describe, expect, it } from 'vitest'
import { analyzeIncidentLogs } from './incident-analysis'

describe('local incident analysis', () => {
  it('returns signals and exact evidence lines from the logs', () => {
    const result = analyzeIncidentLogs([
      '2026-09-10T10:01:12Z POST /api/checkout 500 Internal Server Error',
      '2026-09-10T10:01:13Z payment provider request timed out',
      '2026-09-10T10:01:15Z checkout request failed after 3 retries',
    ].join('\n'))

    expect(result.signals).toEqual(['HTTP 5xx response', 'Timeout mentioned', 'Retry mentioned'])
    expect(result.evidenceLines).toEqual([
      '[line 1] 2026-09-10T10:01:12Z POST /api/checkout 500 Internal Server Error',
      '[line 2] 2026-09-10T10:01:13Z payment provider request timed out',
      '[line 3] 2026-09-10T10:01:15Z checkout request failed after 3 retries',
    ])
  })

  it('reports when no supported signal is present', () => {
    expect(analyzeIncidentLogs('2026-09-10T10:00:00Z health check completed')).toEqual({
      summary: 'No supported signals were detected by the local rules. This does not establish that the system is healthy. Review the original logs manually.',
      signals: [],
      evidenceLines: [],
    })
  })

  it('preserves original line numbers, whitespace, source order, and unique evidence', () => {
    expect(analyzeIncidentLogs('  retry timeout  \r\n\r\nHTTP/1.1 503\nretry').evidenceLines).toEqual([
      '[line 1]   retry timeout  ', '[line 3] HTTP/1.1 503', '[line 4] retry',
    ])
  })

  it('does not mistake arbitrary counts for HTTP failures or zero rates for elevated rates', () => {
    expect(analyzeIncidentLogs('worker processed 500 items successfully').signals).toEqual([])
    expect(analyzeIncidentLogs('error rate: 0 percent').signals).toEqual(['Error rate mentioned'])
  })

  it.each(['HTTP 500', 'HTTP/2 502', 'status=503', '{"status_code":504}', 'GET /orders 503'])('recognizes explicit HTTP status context: %s', (line) => {
    expect(analyzeIncidentLogs(line).signals).toContain('HTTP 5xx response')
  })

  it.each(['', ' \n\t '])('rejects empty logs', (log) => {
    expect(() => analyzeIncidentLogs(log)).toThrow('Original logs are empty')
  })
})

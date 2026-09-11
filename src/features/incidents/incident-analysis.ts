export type IncidentAnalysis = {
  summary: string
  signals: string[]
  evidenceLines: string[]
}

const SIGNAL_RULES = [
  { label: 'HTTP 5xx response', pattern: /\b(?:HTTP(?:\/\d(?:\.\d)?)?\s+|(?:status(?:_code| code)?)["']?\s*[:=]\s*|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+)5\d{2}\b/i },
  { label: 'Timeout mentioned', pattern: /\btimeout\b|timed out/i },
  { label: 'Retry mentioned', pattern: /\bretr(?:y|ies|ied)\b/i },
  { label: 'Error rate mentioned', pattern: /error rate|failure rate/i },
] as const

/** Produces transparent signals from exact log text; it makes no root-cause claim. */
export function analyzeIncidentLogs(rawLog: string): IncidentAnalysis {
  if (!rawLog.trim()) throw new Error('Original logs are empty. Add logs before analyzing.')
  const lines = rawLog.split(/\r\n|\n|\r/)
  const matched = new Set<string>()
  const evidenceLines: string[] = []
  lines.forEach((line, index) => {
    const rules = SIGNAL_RULES.filter(({ pattern }) => pattern.test(line))
    rules.forEach(({ label }) => matched.add(label))
    if (rules.length) evidenceLines.push(`[line ${index + 1}] ${line}`)
  })
  const signals = SIGNAL_RULES.filter(({ label }) => matched.has(label)).map(({ label }) => label)

  const summary = signals.length > 0
    ? `Detected ${signals.join(', ').toLowerCase()} in the incident logs. Review the evidence lines before drawing a root-cause conclusion.`
    : 'No supported signals were detected by the local rules. This does not establish that the system is healthy. Review the original logs manually.'

  return { summary, signals, evidenceLines }
}

import type { AiAnalysis } from '../features/incidents/incident-ai-types'
import type { ReferenceResult } from '../features/incidents/incident-reference-types'
export function formatEmailReport(incident: { recordId: string; createdAt: string; data: { title: string; rawLog: string } }, ai: AiAnalysis | undefined, references: ReferenceResult | undefined, includeLogs: boolean): string {
  const lines = ['Incident handoff', '', incident.data.title, `Incident ID: ${incident.recordId}`, `Created: ${incident.createdAt}`, '', 'AI analysis']
  if (ai) {
    lines.push(ai.summary, `Model: ${ai.model}`, `Analysis saved: ${ai.generatedAt}`, '', 'Log evidence')
    lines.push(...(ai.evidence.length ? ai.evidence.map((item) => `[line ${item.line}] ${item.quote}`) : ['No specific evidence identified.']))
    lines.push('', 'Possible causes — not confirmed', ...ai.hypotheses.map((item) => `- ${item.explanation} (Evidence lines: ${item.evidenceLines.join(', ')})`))
    lines.push('', 'Suggested checks', ...ai.suggestedChecks.map((item) => `- ${item}`))
  } else lines.push('No completed AI analysis was available when this draft was prepared.')
  lines.push('', 'Troubleshooting references')
  if (references) {
    lines.push(`Search: ${references.query}`, `Search saved: ${references.searchedAt}`)
    lines.push(...(references.items.length ? references.items.flatMap((item) => [`- ${item.title}`, item.url, item.excerpt, '']) : ['No references found.']))
  } else lines.push('No completed reference search was available when this draft was prepared.')
  lines.push('', includeLogs ? 'Original logs' : 'Full original logs omitted. AI evidence above may contain log excerpts.')
  if (includeLogs) lines.push(incident.data.rawLog)
  lines.push('', 'AI hypotheses and external references require human verification. This is not a confirmed root-cause report.')
  return lines.join('\n')
}

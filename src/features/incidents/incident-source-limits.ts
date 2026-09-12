// JavaScript string length (UTF-16 code units), shared by UI and backend.
export const INCIDENT_TITLE_LIMIT = 120
export const INCIDENT_LOG_LIMIT = 20000
export function incidentLengthError(title: string, rawLog: string): string | null {
  if (title.length > INCIDENT_TITLE_LIMIT) return 'Incident title exceeds the 120-character limit. Shorten it before saving.'
  if (rawLog.length > INCIDENT_LOG_LIMIT) return 'Original logs exceed the 20,000-character limit. Shorten them before saving.'
  return null
}

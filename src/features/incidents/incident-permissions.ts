/** Shared capability vocabulary. Callers must supply verified server identity. */
export type IncidentAccessRecord = { createdBy: string; data: { collaborators?: unknown; title?: string } }
export function collaboratorIds(value: unknown): string[] {
  if (typeof value === 'string') {
    try { return collaboratorIds(JSON.parse(value)) } catch { return [] }
  }
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id))] : []
}
export function incidentCapabilities(record: IncidentAccessRecord, userId: string, role: string) {
  const creator = !!userId && record.createdBy === userId
  const operator = creator || role === 'admin'
  const read = !!userId && (operator || collaboratorIds(record.data.collaborators).includes(userId))
  return { read, comment: read, manageMembers: creator, operate: operator }
}

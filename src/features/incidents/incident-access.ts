export type IncidentAccessRole = 'admin' | 'member' | 'viewer' | string

export function incidentListCopy(role: IncidentAccessRole) {
  if (role === 'admin') {
    return {
      heading: 'All incidents',
      description: 'Incidents visible to your admin role appear here.',
    }
  }
  return {
    heading: 'My incidents',
    description: 'Only incidents you created appear here.',
  }
}

type CreatorLookup = {
  getEmail: (userId: string) => string | null
  getName: (userId: string) => string | null
}

export function creatorLabel({
  createdBy,
  currentUserId,
  currentUserEmail,
  role,
  lookup,
}: {
  createdBy: string
  currentUserId?: string
  currentUserEmail?: string
  role: IncidentAccessRole
  lookup: CreatorLookup
}) {
  if (createdBy === currentUserId) return currentUserEmail ?? 'You'
  if (role === 'admin') return lookup.getEmail(createdBy) ?? lookup.getName(createdBy) ?? 'Unknown creator'
  return 'Unknown creator'
}

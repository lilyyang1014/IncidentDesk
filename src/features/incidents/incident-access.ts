export type IncidentAccessRole = 'admin' | 'member' | 'viewer' | string

export function incidentListCopy(role: IncidentAccessRole) {
  if (role === 'admin') {
    return {
      heading: 'Incidents',
      description: 'Your personal lists show incidents you created or that others shared with you. Admin access to other incidents is unchanged.',
    }
  }
  return {
    heading: 'Incidents',
    description: 'Track incidents you created or that others shared with you.',
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
  return lookup.getName(createdBy) ?? 'Unknown creator'
}

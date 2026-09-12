import { describe, expect, it, vi } from 'vitest'
import { creatorLabel, incidentListCopy } from './incident-access'

const lookup = {
  getEmail: vi.fn((id: string) => id === 'user-2' ? 'other@example.test' : null),
  getName: vi.fn((id: string) => id === 'user-3' ? 'Other User' : null),
}

describe('incident access display', () => {
  it('describes the admin view as all visible incidents', () => {
    expect(incidentListCopy('admin')).toEqual({
      heading: 'All incidents',
      description: 'Incidents visible to your admin role appear here.',
    })
  })

  it('includes invited incidents for non-admin roles', () => {
    expect(incidentListCopy('member')).toEqual({
      heading: 'My and shared incidents',
      description: 'Incidents you created or were invited to appear here.',
    })
  })

  it('uses the current user email only when the record belongs to them', () => {
    expect(creatorLabel({
      createdBy: 'user-1', currentUserId: 'user-1', currentUserEmail: 'me@example.test', role: 'admin', lookup,
    })).toBe('me@example.test')
  })

  it('resolves another creator for an admin from the record creator ID', () => {
    expect(creatorLabel({
      createdBy: 'user-2', currentUserId: 'user-1', currentUserEmail: 'me@example.test', role: 'admin', lookup,
    })).toBe('other@example.test')
  })

  it('does not expose another creator to a non-admin fallback path', () => {
    expect(creatorLabel({
      createdBy: 'user-2', currentUserId: 'user-1', currentUserEmail: 'me@example.test', role: 'member', lookup,
    })).toBe('Unknown creator')
  })
})

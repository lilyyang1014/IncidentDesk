import { describe, expect, it } from 'vitest'
import { incidentIdFromSearch, incidentSearch } from './incident-route'

describe('incident detail URLs', () => {
  it('reads the incident ID from the query string', () => {
    expect(incidentIdFromSearch('?incidentId=incident-123')).toBe('incident-123')
    expect(incidentIdFromSearch('')).toBeNull()
  })

  it('encodes an incident ID as a shareable query string', () => {
    expect(incidentSearch('incident 123')).toBe('?incidentId=incident+123')
  })
})

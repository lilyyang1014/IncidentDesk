export function incidentIdFromSearch(search: string) {
  return new URLSearchParams(search).get('incidentId')
}

export function incidentSearch(incidentId: string) {
  return `?${new URLSearchParams({ incidentId }).toString()}`
}

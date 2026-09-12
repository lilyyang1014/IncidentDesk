export async function incidentDigest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function sourceIdentity(record: { recordId: string; createdAt: string; createdBy: string; data: { title: string; rawLog: string } }) {
  return [record.recordId, record.createdAt, record.createdBy, record.data.title, record.data.rawLog]
}

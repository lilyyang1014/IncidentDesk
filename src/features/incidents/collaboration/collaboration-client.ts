import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import type { CollaborationRequest } from './collaboration-types'
export async function changeCollaboration(input: CollaborationRequest, signal?: AbortSignal): Promise<void> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to collaborate.')
  const response = await fetch('/api/actions/incidentCollaboration', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    body: JSON.stringify(input),
  })
  const body = z.object({ success: z.boolean(), error: z.string().optional() }).parse(await response.json())
  if (!response.ok || !body.success) throw new Error(body.error ?? 'Could not confirm the change. Check the saved state before retrying.')
}

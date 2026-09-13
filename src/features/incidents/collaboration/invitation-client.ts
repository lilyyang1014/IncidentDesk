import { getAuthToken } from 'deepspace'
import { z } from 'zod'
import { invitationResult, type InvitationRequest } from './invitation-types'

export async function requestInvitation(input: InvitationRequest, signal?: AbortSignal) {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in again to manage invitations.')
  const response = await fetch('/api/incident-invitations', {
    method: 'POST', credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    body: JSON.stringify(input),
  })
  const body = z.object({ success: z.boolean(), error: z.string().optional(), data: invitationResult.optional() }).parse(await response.json())
  if (!response.ok || !body.success || !body.data) throw new Error(body.error ?? 'Could not confirm the invitation. Check its status before trying again.')
  return body.data
}

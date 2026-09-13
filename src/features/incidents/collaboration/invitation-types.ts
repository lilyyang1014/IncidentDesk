import { z } from 'zod'

// Treat casing consistently, but never merge provider-specific dots or aliases.
export const invitationEmail = z.string().trim().max(254).email().transform(value => value.toLowerCase())
export const invitationToken = z.string().regex(/^[a-f0-9]{64}$/)
const source = { incidentId: z.string().min(1).max(200), incidentCreatedAt: z.string().min(1).max(100) }
export const invitationRequest = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('status'), ...source }).strict(),
  z.object({ intent: z.literal('create'), ...source, email: invitationEmail, requestId: z.string().uuid(), expectedId: invitationToken.nullable() }).strict(),
  z.object({ intent: z.literal('cancel'), ...source, token: invitationToken }).strict(),
  z.object({ intent: z.literal('inspect'), token: invitationToken }).strict(),
  z.object({ intent: z.literal('accept'), token: invitationToken, confirmed: z.literal(true) }).strict(),
])
export const invitationView = z.object({
  token: invitationToken,
  email: invitationEmail,
  phase: z.enum(['pending', 'accepting', 'accepted', 'cancelled', 'expired', 'revoked']),
  expiresAt: z.number(),
  incidentId: z.string(),
})
export const invitationResult = z.object({ invitation: invitationView.nullable() })
export type InvitationRequest = z.infer<typeof invitationRequest>
export type InvitationView = z.infer<typeof invitationView>
export type InvitationResult = z.infer<typeof invitationResult>

export function invitationLink(origin: string, token: string) {
  return `${origin}/invite#token=${invitationToken.parse(token)}`
}

export function invitationFromHash(hash: string): string | null {
  const parsed = invitationToken.safeParse(new URLSearchParams(hash.replace(/^#/, '')).get('token'))
  return parsed.success ? parsed.data : null
}

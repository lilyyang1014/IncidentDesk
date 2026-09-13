import { z } from 'zod'
export const recipientSchema = z.string().trim().max(254).email().regex(/^[^\s,;<>\r\n]+@[^\s,;<>\r\n]+$/)
export const subjectSchema = z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/)
export const googleAuthUrl = z.string().url().max(12000).refine((value) => {
  const url = new URL(value)
  return url.origin === 'https://accounts.google.com' && !url.username && !url.password
})
export const emailDraftSchema = z.object({
  id: z.string(), to: recipientSchema, subject: subjectSchema, content: z.string().max(100000),
  html: z.string().max(500000).optional(),
  includeLogs: z.boolean(), createdAt: z.string(),
})
export type EmailDraft = z.infer<typeof emailDraftSchema>
export const emailStateSchema = z.object({
  draft: emailDraftSchema.nullable(),
  phase: z.enum(['idle', 'ready', 'sending', 'oauth', 'accepted', 'failed', 'unknown']),
  error: z.string().optional(), authUrl: googleAuthUrl.optional(), messageId: z.string().optional(),
})
export type EmailState = z.infer<typeof emailStateSchema>

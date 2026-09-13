import { z } from 'zod'

export const WEBHOOK_BODY_LIMIT = 32 * 1024
export const webhookEvent = z.object({
  eventId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  occurredAt: z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()),
  title: z.string().trim().min(1).max(120),
  summary: z.string().min(1).max(19000).refine(value => !!value.trim()),
  sourceUrl: z.string().url().max(512).refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }).optional(),
}).strict()
export type WebhookEvent = z.infer<typeof webhookEvent>
export const sourceRequest = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('status') }).strict(),
  z.object({ intent: z.literal('rotate'), expectedVersion: z.string().uuid().nullable() }).strict(),
  z.object({ intent: z.literal('disable'), expectedVersion: z.string().uuid() }).strict(),
])
export type SourceRequest = z.infer<typeof sourceRequest>
export const sourceResult = z.object({
  source: z.object({ id: z.string().uuid(), version: z.string().uuid(), enabled: z.boolean(), changedAt: z.string(), admitted: z.number().int() }).nullable(),
  token: z.string().optional(),
})
export type SourceResult = z.infer<typeof sourceResult>

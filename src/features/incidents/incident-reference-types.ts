import { z } from 'zod'

export const searchQuery = z.string().trim().min(3).max(300)
export const referenceSchema = z.object({
  title: z.string().min(1).max(1000),
  url: z.string().max(4000).url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  }),
  excerpt: z.string().max(1500),
})
export const referenceResultSchema = z.object({
  query: searchQuery, searchedAt: z.string(), items: z.array(referenceSchema).max(5),
})
export const referenceStateSchema = z.object({
  phase: z.enum(['idle', 'running', 'complete', 'failed', 'unknown']),
  canSearch: z.boolean(), query: z.string(), error: z.string().optional(),
  result: referenceResultSchema.optional(),
}).refine((state) => state.phase !== 'complete' || !!state.result)
export type ReferenceResult = z.infer<typeof referenceResultSchema>
export type ReferenceState = z.infer<typeof referenceStateSchema>

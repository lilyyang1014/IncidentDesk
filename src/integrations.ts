/**
 * Integration Allowlist and Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays when explicitly configured. Works for anonymous users.
 * - 'user': The calling user pays. Requires sign-in.
 *
 * Integrations not listed here are rejected before any provider request.
 *
 * IMPORTANT: any integration backed by per-user OAuth tokens (Google,
 * etc.) must be 'user' — the api-worker looks up the row keyed by the
 * JWT subject. With 'developer' the app owner's JWT is forwarded and
 * the handler operates on the app owner's connected account regardless
 * of who's signed in client-side.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {
  google: { billing: 'user' },
  // openai: { billing: 'developer' },
}

export const INTEGRATION_NOT_ENABLED = {
  success: false as const,
  error: 'This integration is not enabled for this app.',
  code: 'integration_not_enabled',
}

/** Both entry points accept only a literal provider/endpoint pair. Disallow
 * path separators, escapes and dot segments before constructing a proxy URL.
 * Own-property lookup excludes inherited names such as constructor. */
export function integrationBilling(endpoint: string): 'developer' | 'user' | null {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(endpoint)) return null
  const name = endpoint.split('/')[0]
  if (!Object.hasOwn(integrations, name)) return null
  const billing = integrations[name]?.billing
  return billing === 'developer' || billing === 'user' ? billing : null
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { ActionTools } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import { integrations, INTEGRATION_NOT_ENABLED } from '../integrations'
import { registerAuthAndIntegrationRoutes } from './http-routes'
import { registerActionRoutes } from './action-routes'

const mocks = vi.hoisted(() => ({ api: vi.fn(), verify: vi.fn(), normalize: vi.fn() }))
vi.mock('deepspace/worker', () => ({
  apiWorkerFetch: mocks.api,
  verifyJwt: mocks.verify,
  normalizeApiError: mocks.normalize,
  authWorkerFetch: vi.fn(),
  BROWSER_PROXY_ROUTES: [],
  isPlatformReservedPath: vi.fn(),
  platformWorkerFetch: vi.fn(),
  resolveAppRole: vi.fn(),
  resolveSessionReadAuth: vi.fn(),
  SESSION_COOKIE: 'test-session',
  verifyAgentToken: vi.fn(),
}))
// Test-only action exercises the real private action-tools integration helper.
// No action is added to the application registry.
vi.mock('../actions/index.js', () => ({
  actions: {
    probe: ({ tools, params }: { tools: ActionTools; params: { endpoint: string } }) =>
      tools.integration(params.endpoint, { query: 'test' }),
  },
}))

const env = {
  APP_OWNER_JWT: 'fake-owner-token',
  APP_IDENTITY_TOKEN: 'fake-app-token',
  DEEPSPACE_APP_ID: 'test-app',
  RECORD_ROOMS: { idFromName: () => 'test-room', get: () => ({ fetch: vi.fn() }) },
} as unknown as Env

function browserApp() {
  const app = new Hono<AppContext>()
  registerAuthAndIntegrationRoutes(app)
  return app
}
function actionApp() {
  const app = new Hono<AppContext>()
  registerActionRoutes(app, async () => ({ userId: 'test-user', claims: { sub: 'test-user' } }))
  return app
}
function actionRequest(endpoint: string) {
  return actionApp().request('/api/actions/probe', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }, env)
}

beforeEach(() => {
  vi.resetAllMocks()
  // Any accidental direct network use fails locally instead of reaching a provider.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is disabled in this test') }))
  mocks.api.mockImplementation(async () => Response.json({ success: true, data: { ok: true } }))
  mocks.verify.mockResolvedValue({ result: { userId: 'test-user' } })
})
afterEach(() => {
  delete integrations.test_provider
  vi.unstubAllGlobals()
})

describe('browser integration allowlist', () => {
  it.each(['google', 'openai', 'unknown-provider', 'constructor', '__proto__', 'toString'])('rejects unconfigured %s before forwarding or resolving identity', async (name) => {
    const res = await browserApp().request(`/api/integrations/${name}/probe`, {
      method: 'POST', headers: { Authorization: 'Bearer fake-user-token' }, body: '{}',
    }, env)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(INTEGRATION_NOT_ENABLED)
    expect(mocks.api).not.toHaveBeenCalled()
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST', 'DELETE'])('rejects anonymous unconfigured requests using %s', async (method) => {
    const res = await browserApp().request('/api/integrations/not-enabled/probe', { method }, env)
    expect(res.status).toBe(403)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it.each(['probe%2F..%2Fopenai', '%252e%252e', 'probe%3Fother=1'])('rejects escaped endpoint paths: %s', async (endpoint) => {
    const res = await browserApp().request(`/api/integrations/google/${endpoint}`, {}, env)
    expect(res.status).toBe(403)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('still requires authentication for configured user billing', async () => {
    integrations.test_provider = { billing: 'user' }
    const res = await browserApp().request('/api/integrations/test_provider/probe', {}, env)
    expect(res.status).toBe(401)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('forwards a configured user request with the verified caller token and original body', async () => {
    integrations.test_provider = { billing: 'user' }
    const res = await browserApp().request('/api/integrations/test_provider/probe', {
      method: 'POST', headers: { Authorization: 'Bearer fake-user-token' }, body: '{"query":"test"}',
    }, env)
    expect(res.status).toBe(200)
    expect(mocks.api).toHaveBeenCalledWith(env, '/api/integrations/test_provider/probe', expect.objectContaining({
      body: '{"query":"test"}', headers: expect.objectContaining({ Authorization: 'Bearer fake-user-token' }),
    }))
  })

  it('rejects an invalid bearer even for configured user billing', async () => {
    integrations.test_provider = { billing: 'user' }
    mocks.verify.mockResolvedValue({ result: null })
    const res = await browserApp().request('/api/integrations/test_provider/probe', {
      headers: { Authorization: 'Bearer invalid' },
    }, env)
    expect(res.status).toBe(401)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('uses developer billing only for an explicit configuration', async () => {
    integrations.test_provider = { billing: 'developer' }
    const res = await browserApp().request('/api/integrations/test_provider/probe', {}, env)
    expect(res.status).toBe(200)
    expect(mocks.api).toHaveBeenCalledWith(env, '/api/integrations/test_provider/probe', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fake-owner-token' }),
    }))
  })

  it('keeps catalog discovery available', async () => {
    const res = await browserApp().request('/api/integrations', {}, env)
    expect(res.status).toBe(200)
    expect(mocks.api).toHaveBeenCalledWith(env, '/api/integrations')
  })
})

describe('server action integration allowlist', () => {
  it.each(['google/probe', 'google/gmail-send', 'openai/probe', 'constructor/probe', '__proto__/probe', 'google/../openai/probe', 'google/%2e%2e', 'google/probe?redirect=openai', '/google/probe'])('refuses %s without forwarding', async (endpoint) => {
    const res = await actionRequest(endpoint)
    expect(await res.json()).toEqual(INTEGRATION_NOT_ENABLED)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('preserves user billing for configured services', async () => {
    integrations.test_provider = { billing: 'user' }
    const res = await actionRequest('test_provider/probe')
    expect(await res.json()).toEqual({ success: true, data: { ok: true } })
    expect(mocks.api).toHaveBeenCalledWith(env, '/api/integrations/test_provider/probe', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fake-user-token' }),
    }))
  })

  it('preserves explicitly configured developer billing', async () => {
    integrations.test_provider = { billing: 'developer' }
    await actionRequest('test_provider/probe')
    expect(mocks.api).toHaveBeenCalledWith(env, '/api/integrations/test_provider/probe', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fake-owner-token' }),
    }))
  })
})

describe('Gmail connection status remains independent of generic integration access', () => {
  it('forwards only the authenticated caller token for status reads', async () => {
    const status = { google: { connected: true, gmailSend: true, email: 'sender@example.test' } }
    mocks.api.mockResolvedValueOnce(Response.json(status))
    const response = await browserApp().request('/api/integrations/status', {
      headers: { Authorization: 'Bearer fake-user-token' },
    }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(status)
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith(env, '/api/integrations/status', {
      headers: { Authorization: 'Bearer fake-user-token' },
    })
  })
  it('rejects anonymous status reads without forwarding', async () => {
    expect((await browserApp().request('/api/integrations/status', {}, env)).status).toBe(401)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it.each(['GET', 'POST', 'DELETE'])('blocks the generic Google path for %s', async (method) => {
    const response = await browserApp().request('/api/integrations/google/gmail-send', {
      method, headers: { Authorization: 'Bearer fake-user-token' },
    }, env)
    expect(response.status).toBe(403)
    expect(mocks.api).not.toHaveBeenCalled()
  })
})

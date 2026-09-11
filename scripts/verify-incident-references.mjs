// Run after npm run build. Uses real local Workers/DOs and ephemeral test keys.
// All outbound services are replaced at the provider boundary; never bills APIs.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('ES256')
const issuer = 'https://incident-references.test'
const tokens = {}
for (const user of ['owner', 'member-a', 'member-b']) {
  tokens[user] = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(user).setIssuer(issuer).setExpirationTime('5m').sign(privateKey)
}
const persistence = await mkdtemp(join(tmpdir(), 'incident-references-runtime-'))
let providerCalls = 0
const options = {
  modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true },
    INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true },
  },
  resourcePersistencePath: persistence,
  bindings: { DEEPSPACE_APP_ID: 'app_test_incident_ai', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer,
    AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), APP_IDENTITY_TOKEN: 'test-identity-only', APP_NAME: 'test' },
  outboundService: () => new Response('External network disabled', { status: 503 }),
  serviceBindings: {
    API_WORKER: async (request) => {
      assert.equal(new URL(request.url).pathname, '/api/integrations/exa/search')
      assert.equal(request.headers.get('Authorization'), `Bearer ${tokens['member-a']}`)
      providerCalls++
      await new Promise((resolve) => setTimeout(resolve, 200))
      const body = await request.json()
      assert.equal(body.query, 'database timeout')
      assert.equal(body.numResults, 5)
      assert.equal(body.rawLog, undefined)
      return Response.json({ success: true, data: { results: [{ title: 'Timeout documentation', url: 'https://example.test/timeout', text: 'Check dependency latency.' }] } })
    },
  },
}
const runtimeOptions = { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } }
let runtime = new Miniflare(runtimeOptions)
async function action(user, intent) {
  const response = await runtime.dispatchFetch('http://local.test/api/actions/findIncidentReferences', {
    method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: 'test-incident', intent, ...(intent === 'search' ? { query: 'database timeout' } : {}) }),
  })
  return response.json()
}
try {
  const records = await runtime.getDurableObjectNamespace('RECORD_ROOMS')
  const stub = records.get(records.idFromName('app:app_test_incident_ai'))
  async function create(collection, recordId, data, user) {
    const response = await stub.fetch('https://internal/api/tools/execute', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Action': 'true', 'X-User-Id': user },
      body: JSON.stringify(collection === 'users'
        ? { tool: 'users.register', params: { userId: recordId, name: data.name, email: data.email, isAdmin: false } }
        : { tool: 'records.create', params: { collection, recordId, data } }) })
    const created = await response.json()
    assert.equal(created.success, true, JSON.stringify(created))
  }
  await create('users', 'member-a', { role: 'member', name: 'Test A', email: 'a@example.test' }, 'owner')
  await create('users', 'member-b', { role: 'member', name: 'Test B', email: 'b@example.test' }, 'owner')
  await create('incidents', 'test-incident', { title: 'Offline AI verification', rawLog: 'Started\n\n  request timed out  ', status: 'Pending analysis' }, 'member-a')
  assert.equal((await action('member-b', 'search')).success, false)
  assert.equal(providerCalls, 0)
  assert.equal((await action('member-a', 'status')).data.phase, 'idle')
  const replies = await Promise.all([action('member-a', 'search'), action('member-a', 'search')])
  assert(replies.some((reply) => reply.data?.phase === 'complete'), JSON.stringify(replies))
  assert.equal(providerCalls, 1)
  await runtime.dispose()
  runtime = new Miniflare(runtimeOptions)
  const restored = await action('member-a', 'status')
  assert.equal(restored.success, true, JSON.stringify(restored))
  assert.equal(restored.data.phase, 'complete')
  assert.equal(restored.data.query, 'database timeout')
  assert.equal(restored.data.result.items[0].url, 'https://example.test/timeout')
  assert.equal((await action('member-b', 'status')).success, false)
  assert.equal((await action('owner', 'status')).data.phase, 'complete')
  assert.equal((await action('member-a', 'search')).data.phase, 'complete')
  assert.equal(providerCalls, 1)
  console.log('PASS: real JWT verification, record access, duplicate prevention, durable restart recovery; 1 mocked provider call, 0 external calls.')
} finally {
  await runtime.dispose()
  await rm(persistence, { recursive: true, force: true })
}

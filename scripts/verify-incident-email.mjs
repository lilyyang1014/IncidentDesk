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
const persistence = await mkdtemp(join(tmpdir(), 'incident-email-runtime-'))
let providerCalls = 0
let reviewedBody
const options = {
  modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true },
    INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true },
    INCIDENT_AI_ROOMS: { className: 'AppIncidentAiRoom', useSQLite: true },
    INCIDENT_EMAIL_ROOMS: { className: 'AppIncidentEmailRoom', useSQLite: true },
  },
  resourcePersistencePath: persistence,
  bindings: { DEEPSPACE_APP_ID: 'app_test_incident_ai', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer,
    AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), APP_IDENTITY_TOKEN: 'test-identity-only', APP_NAME: 'test' },
  outboundService: () => new Response('External network disabled', { status: 503 }),
  serviceBindings: {
    API_WORKER: async (request) => {
      assert.equal(new URL(request.url).pathname, '/api/integrations/google/gmail-send')
      assert.equal(request.headers.get('Authorization'), `Bearer ${tokens['member-a']}`)
      providerCalls++
      const body = await request.json()
      assert.equal(body.to, 'recipient@example.test')
      assert.equal(body.subject, 'Reviewed incident report')
      assert.equal(body.content, reviewedBody)
      assert(!body.content.includes('  request timed out  '))
      await new Promise((resolve) => setTimeout(resolve, 200))
      return Response.json({ success: true, data: { id: 'mock-gmail-message-id' } })
    },
  },
}
const runtimeOptions = { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } }
let runtime = new Miniflare(runtimeOptions)
async function action(user, intent, extra = {}) {
  const response = await runtime.dispatchFetch('http://local.test/api/actions/incidentEmail', {
    method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: 'test-incident', intent, ...extra }),
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
  const params = { to: 'recipient@example.test', subject: 'Reviewed incident report', includeLogs: false }
  assert.equal((await action('member-b', 'prepare', params)).success, false)
  assert.equal(providerCalls, 0)
  assert.equal((await action('member-a', 'status')).data.phase, 'idle')
  const prepared = await action('member-a', 'prepare', params)
  assert.equal(prepared.success, true, JSON.stringify(prepared))
  assert.equal(prepared.data.phase, 'ready')
  reviewedBody = prepared.data.draft.content
  const draftId = prepared.data.draft.id
  assert.equal(providerCalls, 0)
  assert.equal((await action('member-a', 'send', { draftId })).success, false)
  assert.equal((await action('owner', 'send', { draftId, confirmed: true })).success, false)
  const replies = await Promise.all([
    action('member-a', 'send', { draftId, confirmed: true }),
    action('member-a', 'send', { draftId, confirmed: true }),
  ])
  assert(replies.some((reply) => reply.data?.phase === 'accepted'), JSON.stringify(replies))
  assert.equal(providerCalls, 1)
  await runtime.dispose()
  runtime = new Miniflare(runtimeOptions)
  const restored = await action('member-a', 'status')
  assert.equal(restored.success, true, JSON.stringify(restored))
  assert.equal(restored.data.phase, 'accepted')
  assert.equal(restored.data.draft.content, reviewedBody)
  assert.equal((await action('member-b', 'status')).success, false)
  assert.equal((await action('member-a', 'send', { draftId, confirmed: true })).data.phase, 'accepted')
  const duplicate = await action('member-a', 'prepare', params)
  assert.equal(duplicate.data.draft.id, draftId)
  assert.equal(duplicate.data.phase, 'accepted')
  const bypass = await runtime.dispatchFetch('http://local.test/api/integrations/google/gmail-send', {
    method: 'POST', headers: { Authorization: `Bearer ${tokens['member-a']}`, 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  })
  assert.equal(bypass.status, 403)
  assert.equal(providerCalls, 1)
  console.log('PASS: saved exact draft, explicit confirmation, access control, duplicate prevention and restart recovery; 1 simulated Gmail call, 0 external calls.')

} finally {
  await runtime.dispose()
  await rm(persistence, { recursive: true, force: true })
}

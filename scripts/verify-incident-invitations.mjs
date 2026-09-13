// Isolated real Worker/SQLite/JWT/WebSocket test. Auth responses are synthetic;
// no live auth, paid integration, email, or external network is permitted.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('ES256')
const issuer = 'https://invitation-auth.test'
const tokens = {}
for (const id of ['owner', 'a', 'b', 'c', 'unregistered']) tokens[id] = await new SignJWT({ email: `${id}@example.test`, name: `Invitation ${id}` }).setProtectedHeader({ alg: 'ES256' }).setSubject(id).setIssuer(issuer).setExpirationTime('30m').sign(privateKey)
const cookieName = '__Secure-better-auth.session_token'
let authCalls = 0, externalCalls = 0
let verified = true
const persistence = await mkdtemp(join(tmpdir(), 'incident-invitations-'))
const options = {
  modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: persistence,
  durableObjects: { RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true }, INCIDENT_AI_ROOMS: { className: 'AppIncidentAiRoom', useSQLite: true }, INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true }, INCIDENT_EMAIL_ROOMS: { className: 'AppIncidentEmailRoom', useSQLite: true } },
  bindings: { DEEPSPACE_APP_ID: 'app_invitation_test', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer, AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), AUTH_WORKER_URL: issuer, APP_NAME: 'test' },
  outboundService: request => {
    const url = new URL(request.url)
    if (url.origin === issuer && url.pathname === '/api/auth/get-session') {
      authCalls++
      assert.equal(url.searchParams.get('disableCookieCache'), 'true')
      assert.equal(url.searchParams.get('disableRefresh'), 'true')
      const cookie = request.headers.get('Cookie') ?? ''
      assert.equal(request.headers.get('Authorization'), null)
      const id = cookie.match(/^__Secure-better-auth\.session_token=([a-z]+)$/)?.[1]
      if (!tokens[id]) return Response.json(null, { status: 401 })
      return Response.json({ user: { id, email: `${id}@example.test`, emailVerified: verified }, session: { userId: id, expiresAt: new Date(Date.now() + 600000).toISOString() } })
    }
    externalCalls++
    return new Response('External network disabled', { status: 503 })
  },
}
const config = { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } }
let runtime = new Miniflare(config), stub
const sockets = []
async function setup() { const ns = await runtime.getDurableObjectNamespace('RECORD_ROOMS'); stub = ns.get(ns.idFromName('app:app_invitation_test')) }
async function tool(user, name, params, privileged = false) {
  return (await stub.fetch('https://internal/api/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': user, ...(privileged ? { 'X-App-Action': 'true' } : {}) }, body: JSON.stringify({ tool: name, params }) })).json()
}
async function invite(user, input, cookieUser = user) {
  const response = await runtime.dispatchFetch('http://local.test/api/incident-invitations', { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json', ...(cookieUser ? { Cookie: `${cookieName}=${cookieUser}` } : {}) }, body: JSON.stringify(input) })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return { status: response.status, ...await response.json() }
}
async function action(user, name, input) {
  return (await runtime.dispatchFetch(`http://local.test/api/actions/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json()
}
async function socket(user) {
  const response = await runtime.dispatchFetch(`http://local.test/ws/app:app_invitation_test?token=${tokens[user]}`, { headers: { Upgrade: 'websocket' } })
  assert.equal(response.status, 101)
  const ws = response.webSocket; ws.accept(); sockets.push(ws)
  const query = { collection: 'incidents', where: { recordId: 'incident' }, limit: 1 }
  const subscriptionId = randomUUID(), frames = [], waiters = new Set()
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return
    const message = JSON.parse(event.data); frames.push(message)
    if (message.type === 'records.resubscribe') ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
    for (const waiter of waiters) waiter()
  })
  const wait = (test, start = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Socket update timed out')) }, 6000)
    const check = () => { const found = frames.slice(start).find(test); if (found) { clearTimeout(timer); waiters.delete(check); resolve(found) } }
    waiters.add(check); check()
  })
  ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
  await wait(frame => frame.type === 'core.query_result')
  return { frames, wait }
}
try {
  await setup()
  for (const id of ['a', 'c']) assert.equal((await tool('owner', 'users.register', { userId: id, email: `${id}@example.test`, name: id, isAdmin: false }, true)).success, true)
  assert.equal((await tool('a', 'records.create', { collection: 'incidents', recordId: 'incident', data: { title: 'Invitation verification', rawLog: 'Fictional data only', status: 'Pending analysis' } }, true)).success, true)
  const record = (await tool('a', 'records.get', { collection: 'incidents', recordId: 'incident' })).data.record
  const source = { incidentId: record.recordId, incidentCreatedAt: record.createdAt }
  const create = { intent: 'create', ...source, email: ' B@Example.test ', expectedId: null, requestId: randomUUID() }
  assert.equal((await tool('owner', 'records.get', { collection: 'users', recordId: 'b' }, true)).success, false, 'B has never entered this app')
  assert.equal((await invite('c', create)).status, 403)
  assert.equal((await invite('owner', create)).status, 403, 'Admin cannot invite into someone else’s incident')
  assert.equal((await invite('unregistered', create)).status, 403)
  const created = await invite('a', create)
  assert.equal(created.success, true, JSON.stringify(created))
  const token = created.data.invitation.token
  assert.equal(created.data.invitation.email, 'b@example.test')
  assert.equal(authCalls, 0, 'Creating invitations does not call authentication or providers')
  assert.equal((await invite('a', create)).data.invitation.token, token)
  assert.equal((await action('a', 'incidentCollaboration', { ...source, intent: 'add', userId: 'c' })).success, false, 'Pending invite reserves the slot against the old add path')
  assert.equal((await invite('b', { intent: 'inspect', token }, 'c')).status, 403, 'JWT/session identities must match')
  assert.equal((await invite('b', { intent: 'inspect', token }, null)).status, 403)
  verified = false
  assert.equal((await invite('b', { intent: 'inspect', token })).status, 403)
  verified = true
  assert.equal((await invite('c', { intent: 'inspect', token })).status, 403)
  const b = await socket('b') // Actual first app connection creates B's app membership.
  assert.equal(b.frames.find(frame => frame.type === 'core.query_result').payload.records.length, 0)
  const inspected = await invite('b', { intent: 'inspect', token })
  assert.equal(inspected.success, true, JSON.stringify(inspected))
  assert.equal(inspected.data.invitation.phase, 'pending')
  assert.equal((await tool('b', 'records.get', { collection: 'incidents', recordId: 'incident' })).success, false)
  assert.equal((await invite('b', { intent: 'accept', token })).status, 400)
  assert.equal((await invite('b', { intent: 'accept', token, confirmed: true, email: 'b@example.test' })).status, 400)
  const start = b.frames.length
  const accepted = await Promise.all(Array.from({ length: 6 }, () => invite('b', { intent: 'accept', token, confirmed: true })))
  for (const result of accepted) assert.equal(result.data?.invitation.phase, 'accepted', JSON.stringify(result))
  await b.wait(frame => frame.type === 'core.query_result' && frame.payload.records.length === 1, start)
  const members = await tool('owner', 'records.query', { collection: 'incident_members', where: { incidentId: 'incident' } }, true)
  assert.equal(members.data.records.length, 1, 'Concurrent acceptance creates exactly one membership')
  assert.equal((await action('b', 'listIncidents', { view: 'shared' })).data.entries[0].recordId, 'incident')
  assert.equal((await action('b', 'incidentCollaboration', { ...source, intent: 'note', requestId: randomUUID(), body: 'Fictional invited-user note' })).success, true)
  assert.equal((await action('b', 'incidentCollaboration', { ...source, intent: 'add', userId: 'c' })).success, false)
  assert.equal((await action('b', 'incidentEmail', { incidentId: 'incident', intent: 'status' })).success, false)
  assert.equal((await invite('a', { intent: 'cancel', ...source, token })).status, 409)
  for (const ws of sockets.splice(0)) ws.close(1000)
  await runtime.dispose(); runtime = new Miniflare(config); await setup()
  assert.equal((await invite('a', { intent: 'status', ...source })).data.invitation.phase, 'accepted')
  assert.equal((await invite('b', { intent: 'accept', token, confirmed: true })).data.invitation.phase, 'accepted')
  assert.equal((await action('a', 'incidentCollaboration', { ...source, intent: 'remove', userId: 'b' })).success, true)
  assert.equal((await invite('b', { intent: 'accept', token, confirmed: true })).success, false, 'Old links cannot restore removed access')
  assert.equal((await tool('b', 'records.get', { collection: 'incidents', recordId: 'incident' })).success, false)
  assert.equal((await tool('a', 'records.query', { collection: 'incident_notes', where: { incidentId: 'incident' } })).data.records.length, 1)
  // A second source and creator exercise cancellation after restart without
  // waiting through or weakening the real creation cooldown.
  assert.equal((await tool('c', 'records.create', { collection: 'incidents', recordId: 'cancel-incident', data: { title: 'Cancel test', rawLog: 'Fictional', status: 'Pending analysis' } }, true)).success, true)
  const cancelRecord = (await tool('c', 'records.get', { collection: 'incidents', recordId: 'cancel-incident' })).data.record
  const cancelSource = { incidentId: cancelRecord.recordId, incidentCreatedAt: cancelRecord.createdAt }
  const pending = await invite('c', { intent: 'create', ...cancelSource, email: 'b@example.test', requestId: randomUUID(), expectedId: null })
  const cancelToken = pending.data.invitation.token
  await runtime.dispose(); runtime = new Miniflare(config); await setup()
  assert.equal((await invite('c', { intent: 'status', ...cancelSource })).data.invitation.token, cancelToken)
  assert.equal((await invite('c', { intent: 'cancel', ...cancelSource, token: cancelToken })).data.invitation.phase, 'cancelled')
  assert.equal((await invite('b', { intent: 'accept', token: cancelToken, confirmed: true })).success, false)
  const oversized = await runtime.dispatchFetch('http://local.test/api/incident-invitations', { method: 'POST', headers: { Authorization: `Bearer ${tokens.a}` }, body: 'x'.repeat(4097) })
  assert.equal(oversized.status, 413)
  assert.equal(externalCalls, 0)
  console.log(JSON.stringify({ passed: true, coverage: 'first-time user, verified session, creator/recipient isolation, six concurrent accepts, live grants, restart, cancellation, removal, preserved notes, bounded request', mockedAuthCalls: authCalls, externalCalls }))
} finally {
  for (const ws of sockets) ws.close(1000)
  await runtime.dispose(); await rm(persistence, { recursive: true, force: true })
}

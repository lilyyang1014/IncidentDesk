// Real local Worker/SQLite/WebSockets, ephemeral identities, no external services.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('ES256')
const issuer = 'https://collaboration.test'
const tokens = {}
for (const id of ['owner', ...Array.from({length: 41}, (_, i) => `bench-${i}`)]) tokens[id] = await new SignJWT({ name: `Test ${id}`, email: `${id}@example.test` }).setProtectedHeader({ alg: 'ES256' }).setSubject(id).setIssuer(issuer).setExpirationTime('15m').sign(privateKey)
const persistence = await mkdtemp(join(tmpdir(), 'incident-collaboration-'))
let externalCalls = 0
const options = { modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: persistence,
  durableObjects: { RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true }, INCIDENT_AI_ROOMS: { className: 'AppIncidentAiRoom', useSQLite: true }, INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true }, INCIDENT_EMAIL_ROOMS: { className: 'AppIncidentEmailRoom', useSQLite: true } },
  bindings: { DEEPSPACE_APP_ID: 'app_collaboration_test', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer, AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), APP_NAME: 'test', APP_IDENTITY_TOKEN: 'test-only' },
  outboundService: () => { externalCalls++; return new Response('External network disabled', { status: 503 }) },
}
const config = { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } }
let runtime = new Miniflare(config)
let stub
async function setupStub() {
  const ns = await runtime.getDurableObjectNamespace('RECORD_ROOMS'); stub = ns.get(ns.idFromName('app:app_collaboration_test'))
}
async function tool(user, tool, params, privileged = false) {
  const res = await stub.fetch('https://internal/api/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': user, ...(privileged ? { 'X-App-Action': 'true' } : {}) }, body: JSON.stringify({ tool, params }) })
  return res.json()
}
async function action(user, name, input) {
  const res = await runtime.dispatchFetch(`http://local.test/api/actions/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  return res.json()
}
// Bounded local warm-path benchmark; no providers, no production traffic.
try {
  await setupStub()
  const times = []
  for (let i = 0; i < 41; i++) {
    const user = `bench-${i}`
    assert.equal((await tool('owner', 'users.register', { userId: user, name: user, email: `${user}@example.test`, isAdmin: false }, true)).success, true)
    for (let j = 0; j < 5; j++) {
      const start = performance.now()
      const result = await action(user, 'saveIncident', {intent:'create', requestId:randomUUID(), data:{title:'Fictional benchmark',rawLog:'x'.repeat(1000)}})
      const elapsed = performance.now() - start
      assert.equal(result.success, true, JSON.stringify(result))
      if (i > 0) times.push(elapsed)
    }
  }
  times.sort((a,b)=>a-b)
  console.log(JSON.stringify({environment:'isolated local Miniflare/SQLite',operation:'authenticated create action round trip',samples:times.length,warmup:5,concurrency:1,logCharacters:1000,totalIncidents:205,p50Ms:times[Math.ceil(times.length*0.5)-1],p95Ms:times[Math.ceil(times.length*0.95)-1],externalCalls}))
} finally {await runtime.dispose(); await rm(persistence,{recursive:true,force:true})}

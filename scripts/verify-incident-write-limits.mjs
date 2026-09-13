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
for (const id of ['owner', 'a', 'b', 'c', 'unregistered']) tokens[id] = await new SignJWT({ name: `Test ${id}`, email: `${id}@example.test` }).setProtectedHeader({ alg: 'ES256' }).setSubject(id).setIssuer(issuer).setExpirationTime('15m').sign(privateKey)
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

try {
  await setupStub()
  for(const user of ['a','b','c']) assert.equal((await tool('owner','users.register',{userId:user,name:user,email:`${user}@example.test`,isAdmin:false},true)).success,true)
  const input=i=>({intent:'create',requestId:randomUUID(),data:{title:`Fictional rate test ${i}`,rawLog:'No real logs or provider calls.'}})
  const requests=Array.from({length:12},(_,i)=>input(i))
  const results=await Promise.all(requests.map(req=>action('a','saveIncident',req)))
  assert.equal(results.filter(r=>r.success).length,5)
  assert.equal(results.filter(r=>r.code==='rate_limited').length,7)
  const successful=results.findIndex(r=>r.success)
  const saved=results[successful].data.recordId
  const replay=await action('a','saveIncident',requests[successful])
  assert.equal(replay.data.recordId,saved)
  assert.equal((await action('a','saveIncident',{...requests[successful],data:{title:'Changed',rawLog:'Different'}})).success,false)
  assert.equal((await action('b','saveIncident',input('other account'))).success,true)
  assert.equal((await action('unregistered','saveIncident',input('denied'))).success,false)
  const rec=(await tool('a','records.get',{collection:'incidents',recordId:saved})).data.record
  const scope={incidentId:saved,incidentCreatedAt:rec.createdAt}
  assert.equal((await action('a','incidentCollaboration',{...scope,intent:'add',userId:'b'})).success,true)
  const notes=Array.from({length:20},(_,i)=>({...scope,intent:'note',body:`Fictional note ${i}`,requestId:randomUUID()}))
  const noteResults=await Promise.all(notes.map(req=>action('a','incidentCollaboration',req)))
  assert.equal(noteResults.filter(r=>r.success).length,10)
  assert.equal(noteResults.filter(r=>r.code==='rate_limited').length,10)
  assert.equal((await action('a','incidentCollaboration',notes[noteResults.findIndex(r=>r.success)])).success,true)
  assert.equal((await action('b','incidentCollaboration',{...scope,intent:'note',body:'Other account',requestId:randomUUID()})).success,true)
  const response=await runtime.dispatchFetch('http://local.test/api/actions/saveIncident',{method:'POST',headers:{Authorization:`Bearer ${tokens.a}`,'Content-Type':'application/json'},body:JSON.stringify(input('header'))})
  assert.equal(response.status,429)
  assert.ok(Number(response.headers.get('Retry-After'))>0)
  // Generic record writes cannot bypass the guarded actions.
  assert.equal((await tool('a','records.create',{collection:'incidents',recordId:'bypass',data:{title:'x',rawLog:'x'}})).success,false)
  assert.equal((await tool('a','records.create',{collection:'incident_notes',recordId:'bypass-note',data:{...scope,body:'x',sequence:99,incidentOwner:'a'}})).success,false)
  await runtime.dispose(); runtime=new Miniflare(config); await setupStub()
  assert.equal((await action('a','saveIncident',input('restart'))).code,'rate_limited')
  assert.equal((await action('a','saveIncident',requests[successful])).data.recordId,saved)
  assert.equal((await tool('a','records.query',{collection:'incident_notes',where:{incidentId:saved},limit:50})).data.records.length,11)
  assert.equal((await action('a','incidentCollaboration',{...scope,intent:'remove',userId:'b'})).success,true)
  assert.equal((await action('b','incidentCollaboration',{...scope,intent:'note',body:'Revoked',requestId:randomUUID()})).success,false)
  // Real elapsed refill, not a production/test clock override in application code.
  await new Promise(resolve=>setTimeout(resolve,12500))
  assert.equal((await action('a','saveIncident',input('refill'))).success,true)
  assert.equal(externalCalls,0)
  console.log('PASS: concurrent limits, independent buckets, idempotent replay, HTTP 429/Retry-After, generic bypass denial, restart persistence, revocation, real-time refill; zero external calls')
} finally { await runtime.dispose(); await rm(persistence,{recursive:true,force:true}) }

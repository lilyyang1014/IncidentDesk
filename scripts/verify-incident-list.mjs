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
const persistence = await mkdtemp(join(tmpdir(), 'incident-list-'))
let externalCalls = 0
let providerCalls = 0
const options = { modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: persistence,
  durableObjects: { PRESENCE_ROOMS: { className: 'AppPresenceRoom', useSQLite: true }, RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true }, INCIDENT_AI_ROOMS: { className: 'AppIncidentAiRoom', useSQLite: true }, INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true }, INCIDENT_EMAIL_ROOMS: { className: 'AppIncidentEmailRoom', useSQLite: true } },
  bindings: { DEEPSPACE_APP_ID: 'app_collaboration_test', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer, AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), APP_NAME: 'test', APP_IDENTITY_TOKEN: 'test-only' },
  serviceBindings: { API_WORKER: async () => { providerCalls++; throw new Error('No provider calls permitted') } },
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
const sockets = []
async function socket(user) {
  const response = await runtime.dispatchFetch(`http://local.test/ws/app:app_collaboration_test?token=${tokens[user]}`, { headers: { Upgrade: 'websocket' } })
  assert.equal(response.status, 101)
  const ws = response.webSocket; ws.accept(); sockets.push(ws)
  const messages = [], subscriptions = new Map(), waiters = new Set()
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return
    const msg = JSON.parse(event.data); messages.push(msg)
    if (msg.type === 'records.resubscribe') for (const [subscriptionId, query] of subscriptions) ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
    for (const waiter of waiters) waiter()
  })
  const wait = (predicate, start = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Timed out waiting for socket frame')) }, 5000)
    const check = () => { const hit = messages.slice(start).find(predicate); if (hit) { clearTimeout(timer); waiters.delete(check); resolve(hit) } }
    waiters.add(check); check()
  })
  const query = async (collection, where = {}) => {
    const subscriptionId = randomUUID(); const query = { collection, where, orderBy: collection === 'incident_notes' ? 'sequence' : 'createdAt', orderDir: 'desc', limit: 50 }
    subscriptions.set(subscriptionId, query)
    ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
    return (await wait(msg => msg.type === 'core.query_result' && msg.payload.subscriptionId === subscriptionId)).payload.records
  }
  return { ws, messages, query, wait, subscriptions }
}
const page = async (user, view = 'mine', cursor) => {
  const response = await action(user, 'listIncidents', { view, ...(cursor ? { cursor } : {}) })
  assert.equal(response.success, true, JSON.stringify(response))
  return response.data
}
const create = async (user, id) => {
  const response = await tool(user, 'records.create', { collection: 'incidents', recordId: id, data: { title: `Pagination fixture ${id}`, rawLog: 'Fictional pagination test only', status: 'Pending analysis' } }, true)
  assert.equal(response.success, true, JSON.stringify(response))
  return response.data.record
}
const member = (user, record, intent, userId) => action(user, 'incidentCollaboration', { incidentId: record.recordId, incidentCreatedAt: record.createdAt, intent, userId })
const expected = rows => [...rows].sort((a,b) => a.createdAt === b.createdAt ? (a.recordId < b.recordId ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1)).map(r=>r.recordId)
try {
  await setupStub()
  for (const user of ['owner','a','b','c']) assert.equal((await tool('owner','users.register',{userId:user,name:`Test ${user}`,email:`${user}@example.test`,isAdmin:user==='owner'},true)).success,true)
  assert.equal((await page('a')).entries.length,0)
  const own = await Promise.all(Array.from({length:45},(_,i)=>create('a', `mine-${String(i).padStart(3,'0')}`)))
  const shared = await Promise.all(Array.from({length:23},(_,i)=>create('b', `shared-${String(i).padStart(3,'0')}`)))
  for (const record of shared) assert.equal((await member('b',record,'add','a')).success,true)
  console.log('Seeding 5,100 unrelated newer private incidents in isolated SQLite...')
  for (let batch=0;batch<102;batch++) await Promise.all(Array.from({length:50},(_,i)=>create('c',`private-${batch*50+i}`)))
  const legacy = await tool('a','records.query',{collection:'incidents',orderBy:'createdAt',orderDir:'desc',limit:50})
  assert.equal(legacy.data.records.length,0,'Reproduce the old SDK filtered scan ceiling')
  const first = await page('a')
  assert.equal(first.entries.length,20)
  assert.deepEqual(first.entries.map(e=>e.recordId),expected(own).slice(0,20))
  const fresh = await create('a','new-between-pages')
  const second = await page('a','mine',first.nextCursor)
  const third = await page('a','mine',second.nextCursor)
  const all = [...first.entries,...second.entries,...third.entries]
  assert.deepEqual(all.map(e=>e.recordId),expected(own),'Cursor chain has no duplicates or gaps despite a new head record')
  assert.equal(third.nextCursor,null)
  assert.equal(new Set(all.map(e=>e.recordId)).size,45)
  assert.equal((await page('a')).entries[0].recordId,fresh.recordId)
  const s1=await page('a','shared'), s2=await page('a','shared',s1.nextCursor)
  assert.deepEqual([...s1.entries,...s2.entries].map(e=>e.recordId),expected(shared))
  assert.equal(s2.nextCursor,null)
  assert.equal((await page('b','shared')).entries.length,0)
  assert.equal((await page('owner')).entries.length,0,'Admin My incidents is still personal')
  assert.equal((await page('owner','shared')).entries.length,0,'Admin Shared with me requires actual membership')
  for(const payload of [{view:'all'}, {view:'mine',userId:'c'}, {view:'shared',cursor:first.nextCursor}, {view:'mine',cursor:{...first.nextCursor,userId:'b'}}]) {
    assert.equal((await action('a','listIncidents',payload)).success,false)
  }
  assert.equal((await action('unregistered','listIncidents',{view:'mine'})).success,false)
  const anonymous=await runtime.dispatchFetch('http://local.test/api/actions/listIncidents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({view:'mine'})})
  assert(anonymous.status>=400)
  // Live exact-ID subscription clears when the current member is removed.
  const live=await socket('a'), target=shared[0]
  assert.equal((await live.query('incidents',{recordId:target.recordId})).length,1)
  const start=live.messages.length
  assert.equal((await member('b',target,'remove','a')).success,true)
  await live.wait(m=>m.type==='core.query_result' && m.payload.records.length===0,start)
  let next=await page('a','shared'); const remaining=[...next.entries]
  while(next.nextCursor){next=await page('a','shared',next.nextCursor);remaining.push(...next.entries)}
  assert(!remaining.some(e=>e.recordId===target.recordId))
  assert.equal(remaining.length,22)
  // Cursor rows may disappear: the boundary remains usable, not an offset.
  const boundary = first.entries.at(-1)
  assert.equal((await tool('a','records.delete',{collection:'incidents',recordId:boundary.recordId})).success,true)
  assert.deepEqual((await page('a','mine',first.nextCursor)).entries,second.entries)
  // Reusing a deleted parent's ID must not inherit orphaned memberships.
  const orphan=shared[1]
  assert.equal((await tool('b','records.delete',{collection:'incidents',recordId:orphan.recordId})).success,true)
  await create('c',orphan.recordId)
  next=await page('a','shared'); const afterRecreate=[...next.entries]
  while(next.nextCursor){next=await page('a','shared',next.nextCursor);afterRecreate.push(...next.entries)}
  assert(!afterRecreate.some(e=>e.recordId===orphan.recordId))
  for(const ws of sockets) ws.close()
  await runtime.dispose();runtime=new Miniflare(config);await setupStub()
  assert.equal((await page('a')).entries[0].recordId,fresh.recordId,'Index and data survive restart')
  assert.equal(externalCalls,0);assert.equal(providerCalls,0)
  console.log('PASS: 5,100 private rows, owner/shared isolation, 20-row cursor pages, insertion/deletion while paging, revocation, orphan protection, restart; no external calls.')
} finally {
  for(const ws of sockets) {try{ws.close()}catch{}}
  await runtime.dispose();await rm(persistence,{recursive:true,force:true})
}

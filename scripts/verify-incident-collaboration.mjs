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
let source
const collab = (user, input) => action(user, 'incidentCollaboration', { ...source, ...input })
const read = (user, collection, where = {}) => tool(user, 'records.query', { collection, where, orderBy: collection === 'incident_notes' ? 'sequence' : 'createdAt', orderDir: 'desc', limit: 50 })
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
try {
  await setupStub()
  for (const user of ['a','b','c']) assert.equal((await tool('owner', 'users.register', { userId: user, name: `Test ${user}`, email: `${user}@example.test`, isAdmin: false }, true)).success, true)
  const created = await tool('a', 'records.create', { collection: 'incidents', recordId: 'incident', data: { title: 'Collaboration verification', rawLog: 'request timed out', status: 'Pending analysis' } })
  assert.equal(created.success, true, JSON.stringify(created))
  source = { incidentId: 'incident', incidentCreatedAt: created.data.record.createdAt }
  assert.deepEqual(created.data.record.data.collaborators, [])
  const [a,b,c] = await Promise.all(['a','b','c'].map(socket))
  assert.equal((await b.query('incidents')).length, 0)
  assert.equal((await c.query('incidents')).length, 0)
  assert.equal((await b.query('incident_notes', { incidentId: 'incident' })).length, 0)
  const bStart = b.messages.length
  assert.equal((await collab('b', { intent: 'add', userId: 'b' })).success, false)
  assert.equal((await collab('owner', { intent: 'add', userId: 'b' })).success, false, 'Admins do not manage another creator membership')
  assert.equal((await collab('a', { intent: 'add', userId: 'unregistered' })).success, false)
  assert.equal((await collab('a', { intent: 'add', userId: 'a' })).success, false)
  assert.equal((await collab('a', { intent: 'add', userId: 'b' })).success, true)
  await b.wait(m => m.type === 'core.query_result' && m.payload.records.some(r => r.recordId === 'incident'), bStart)
  assert.equal((await read('b','incidents')).data.records.length, 1)
  assert.equal((await read('c','incidents')).data.records.length, 0)
  for (const name of ['analyzeIncident', 'findIncidentReferences']) {
    const intent = name === 'analyzeIncident' ? 'generate' : 'search'
    assert.equal((await action('b', name, { incidentId: 'incident', intent, ...(intent === 'search' ? { query: 'Spring Boot timeout' } : {}) })).success, false)
    const status = await action('b', name, { incidentId: 'incident', intent: 'status' })
    assert.equal(status.success, true, JSON.stringify(status))
    assert.equal(status.data[name === 'analyzeIncident' ? 'canGenerate' : 'canSearch'], false)
  }
  assert.equal((await action('b', 'incidentEmail', { incidentId: 'incident', intent: 'status' })).success, false)
  assert.equal((await action('b', 'incidentEmail', { incidentId: 'incident', intent: 'prepare', to: 'b@example.test', subject: 'Test', includeLogs: false })).success, false)
  assert.equal((await collab('a', { intent: 'add', userId: 'c' })).success, false)
  assert.equal((await collab('b', { intent: 'remove', userId: 'b' })).success, false)
  assert.equal((await tool('b', 'records.update', { collection: 'incidents', recordId: 'incident', data: { rawLog: 'forged' } })).success, false)
  for (const user of ['a','b','owner']) for (const collection of ['incident_members','incident_notes']) {
    assert.equal((await tool(user, 'records.create', { collection, recordId: `forge-${user}-${collection}`, data: { incidentId: 'incident', incidentCreatedAt: source.incidentCreatedAt, incidentOwner: 'a', userId: 'c', body: 'forged', sequence: 90 } })).success, false)
  }
  // Clients cannot forge the computed ACL on a source record.
  await tool('a', 'records.update', { collection: 'incidents', recordId: 'incident', data: { collaborators: ['c'] } })
  assert.deepEqual((await read('a','incidents')).data.records[0].data.collaborators, ['b'])
  assert.equal((await read('c','incidents')).data.records.length, 0)
  const attempts = ['a','b'].map(user => ({ user, intent: 'note', body: `Checked by ${user}`, requestId: randomUUID() }))
  const starts = [a.messages.length,b.messages.length,c.messages.length]
  const responses = await Promise.all(attempts.map(({ user, ...input }) => collab(user,input)))
  assert(responses.every(r => r.success), JSON.stringify(responses))
  for (const [i,peer] of [a,b].entries()) await peer.wait(m => m.type === 'core.record_change' && m.payload.collection === 'incident_notes' && m.payload.record.data.body === 'Checked by b', starts[i])
  const notes = (await read('b','incident_notes',{ incidentId:'incident' })).data.records
  assert.equal(notes.length,2); assert.deepEqual(notes.map(r=>r.data.sequence), [2,1]); assert.deepEqual(new Set(notes.map(r=>r.createdBy)),new Set(['a','b']))
  assert.equal((await read('c','incident_notes')).data.records.length,0)
  assert.equal(c.messages.slice(starts[2]).filter(m=>m.type==='core.record_change' && m.payload.collection==='incident_notes').length,0)
  const {user,...retry} = attempts[1]
  assert.equal((await collab(user,retry)).success,true)
  assert.equal((await collab(user,{...retry,body:'Changed retry'})).success,false)
  assert.equal((await read('b','incident_notes')).data.records.length,2)
  for(const body of ['', ' '.repeat(5), 'x'.repeat(2001)]) assert.equal((await collab('b',{intent:'note',body,requestId:randomUUID()})).success,false)
  assert.equal((await collab('b',{intent:'note',body:'spoof',requestId:randomUUID(),author:'a'})).success,false)
  assert.equal((await tool('b','records.update',{collection:'incident_notes',recordId:notes[0].recordId,data:{body:'edited'}})).success,false)
  assert.equal((await tool('b','records.delete',{collection:'incident_notes',recordId:notes[0].recordId})).success,false)
  const revokedAt=b.messages.length
  assert.equal((await collab('a',{intent:'remove',userId:'b'})).success,true)
  await b.wait(m=>m.type==='core.query_result' && m.payload.records.length===0,revokedAt)
  assert.equal((await b.query('incidents')).length,0)
  assert.equal((await b.query('incident_notes')).length,0,'Removed author cannot read own historical note')
  assert.equal((await collab('b',{intent:'note',body:'after removal',requestId:randomUUID()})).success,false)
  assert.equal((await action('b','analyzeIncident',{incidentId:'incident',intent:'status'})).success,false)
  assert.equal((await action('b','findIncidentReferences',{incidentId:'incident',intent:'report'})).success,false)
  const race=await Promise.all(['b','c'].map(userId=>collab('a',{intent:'add',userId})))
  assert.equal(race.filter(r=>r.success).length,1,'Concurrent additions obey one-member policy')
  const winner=(await read('a','incidents')).data.records[0].data.collaborators[0]
  for(const ws of sockets) ws.close()
  await runtime.dispose();runtime=new Miniflare(config);await setupStub()
  assert.equal((await read(winner,'incident_notes')).data.records.length,2,'Persisted after restart')
  assert.equal((await collab('a',{intent:'remove',userId:winner})).success,true)
  assert.equal((await read(winner,'incident_notes')).data.records.length,0)
  // Deletion/recreation cannot transfer old notes or grants to a new source.
  assert.equal((await collab('a',{intent:'add',userId:'b'})).success,true)
  assert.equal((await tool('a','records.delete',{collection:'incidents',recordId:'incident'})).success,true)
  assert.equal((await read('b','incident_notes')).data.records.length,0)
  assert.equal((await read('a','incident_notes')).data.records.length,0)
  const recreated=await tool('c','records.create',{collection:'incidents',recordId:'incident',data:{title:'Different incident',rawLog:'other',status:'Pending analysis'}})
  assert.equal(recreated.success,true)
  assert.deepEqual(recreated.data.record.data.collaborators,[])
  assert.equal((await collab('a',{intent:'add',userId:'b'})).success,false)
  assert.equal(externalCalls,0)
  console.log('PASS: real JWT, creator-only membership, concurrent limit, shared reads, immutable/idempotent notes, two-user live delivery, excluded user, revocation, restart and deletion isolation; 0 external calls.')
} finally { await runtime.dispose();await rm(persistence,{recursive:true,force:true}) }

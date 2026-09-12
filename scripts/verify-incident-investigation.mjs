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
let providerCalls = 0
const options = { modules: true, scriptPath: resolve('dist/incidentdesk/index.js'), cf: false,
  compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: persistence,
  durableObjects: { PRESENCE_ROOMS: { className: 'AppPresenceRoom', useSQLite: true }, RECORD_ROOMS: { className: 'AppRecordRoom', useSQLite: true }, INCIDENT_AI_ROOMS: { className: 'AppIncidentAiRoom', useSQLite: true }, INCIDENT_REFERENCE_ROOMS: { className: 'AppIncidentReferenceRoom', useSQLite: true }, INCIDENT_EMAIL_ROOMS: { className: 'AppIncidentEmailRoom', useSQLite: true } },
  bindings: { DEEPSPACE_APP_ID: 'app_collaboration_test', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer, AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), APP_NAME: 'test', APP_IDENTITY_TOKEN: 'test-only' },
  serviceBindings: { API_WORKER: async request => {
    assert.equal(new URL(request.url).pathname, '/api/integrations/openai/chat-completion')
    providerCalls++
    return Response.json({success:true,data:{model:'mock-only',choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      summary:'The log contains a timeout.', evidence:[{line:1,quote:'request timed out'}],
      hypotheses:[{explanation:'A dependency may be slow.',evidenceLines:[1]}], suggestedChecks:['Measure dependency latency.'],
    })}}]}})
  } },
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
  for (const user of ['a','b','c']) assert.equal((await tool('owner','users.register',{userId:user,name:`Test ${user}`,email:`${user}@example.test`,isAdmin:false},true)).success,true)
  const created = await tool('a','records.create',{collection:'incidents',recordId:'incident',data:{title:'Judgment verification',rawLog:'request timed out',status:'Pending analysis'}},true)
  assert.equal(created.success,true,JSON.stringify(created))
  source={incidentId:'incident',incidentCreatedAt:created.data.record.createdAt}
  assert.equal((await collab('a',{intent:'add',userId:'b'})).success,true)
  const ai=await action('a','analyzeIncident',{incidentId:'incident',intent:'generate'})
  assert.equal(ai.data.phase,'complete',JSON.stringify(ai))
  assert.equal(providerCalls,1)
  const scope={...source,analysisVersion:ai.data.analysisVersion,hypothesisIndex:0}
  const review=(user,input)=>action(user,'assessHypothesis',{...scope,...input})
  const history=(user,before)=>review(user,{intent:'history',...(before?{before}:{})})
  const save={intent:'save',requestId:randomUUID(),expectedSequence:0,status:'Confirmed',reason:'Measured dependency latency: 10 seconds.'}
  assert.equal((await review('c',save)).success,false)
  assert.equal((await review('unregistered',save)).success,false)
  for(const patch of [{reason:' \n '},{reason:'x'.repeat(1001)},{reason:'😀'.repeat(501)},{status:'Definitely true'},{hypothesisIndex:1},{analysisVersion:'a'.repeat(64)},{author:'a'},{verified:{sourceVersion:ai.data.sourceVersion}}])
    assert.equal((await review('b',{...save,...patch})).success,false,JSON.stringify(patch))
  const [a,b,c]=await Promise.all(['a','b','c'].map(socket))
  for(const peer of [a,b,c]) assert.equal((await peer.query('incident_assessments',{incidentId:'incident'})).length,0)
  const start=b.messages.length
  const saved=await review('a',save)
  assert.equal(saved.success,true,JSON.stringify(saved))
  await b.wait(m=>m.type==='core.record_change' && m.payload.collection==='incident_assessments',start)
  assert.equal((await review('a',save)).success,true)
  assert.equal((await history('a')).data.records.length,1)
  assert.equal((await review('a',{...save,reason:'Different retry'})).success,false)
  const simultaneous=await Promise.all(['a','b'].map(user=>review(user,{...save,requestId:randomUUID(),expectedSequence:1,reason:`Checked by ${user}`})))
  assert.equal(simultaneous.filter(r=>r.success).length,1,'Exactly one competing assessment wins')
  assert.equal(simultaneous.find(r=>!r.success).code,'conflict')
  // Both identities, reopen reason, 1,000 UTF-16 boundary and immutable history.
  const bSave={...save,requestId:randomUUID(),expectedSequence:2,status:'Ruled out',reason:'😀'.repeat(500)}
  assert.equal((await review('b',bSave)).success,true)
  for(let sequence=3;sequence<12;sequence++) assert.equal((await review('a',{...save,requestId:randomUUID(),expectedSequence:sequence,status:'Unverified',reason:`Additional investigation ${sequence}`})).success,true)
  const page1=await history('b')
  assert.equal(page1.data.records.length,10);assert.equal(page1.data.hasMore,true)
  assert.deepEqual(page1.data.records.map(r=>r.data.sequence),[12,11,10,9,8,7,6,5,4,3])
  assert.equal(page1.data.records[9].createdBy,'b')
  assert.equal(page1.data.records[9].data.reason.length,1000)
  assert.equal(page1.data.records[0].data.explanation,ai.data.result.hypotheses[0].explanation)
  assert.equal(page1.data.records[0].data.sourceVersion,ai.data.sourceVersion)
  assert.equal((await review('a',{...save,requestId:randomUUID(),expectedSequence:12,reason:'New while paging'})).success,true)
  const page2=await history('a',3)
  assert.deepEqual(page2.data.records.map(r=>r.data.sequence),[2,1]);assert.equal(page2.data.hasMore,false)
  const first=page2.data.records[1]
  for(const user of ['a','b','owner']) {
    assert.equal((await tool(user,'records.create',{collection:'incident_assessments',recordId:'forged',data:first.data})).success,false)
    assert.equal((await tool(user,'records.update',{collection:'incident_assessments',recordId:first.recordId,data:{reason:'changed'}})).success,false)
    assert.equal((await tool(user,'records.delete',{collection:'incident_assessments',recordId:first.recordId})).success,false)
  }
  assert.equal((await history('c')).success,false)
  assert.equal((await read('c','incident_assessments')).data.records.length,0)
  assert.equal(c.messages.filter(m=>m.type==='core.record_change'&&m.payload.collection==='incident_assessments').length,0)
  // Presence never invokes providers, persists no heartbeats, deduplicates tabs.
  const aTab=randomUUID(),aTab2=randomUUID(),bTab=randomUUID()
  const presence=(user,sessionId,intent='heartbeat',extra={})=>action(user,'incidentViewers',{...source,sessionId,intent,...extra})
  assert.equal((await presence('c',randomUUID())).success,false)
  assert.equal((await presence('a',aTab,'heartbeat',{userId:'c'})).success,false)
  assert.equal((await presence('a',aTab)).data.viewers.length,1)
  assert.equal((await presence('a',aTab2)).data.viewers.length,1)
  const both=await presence('b',bTab)
  assert.equal(both.success,true,JSON.stringify(both))
  assert.deepEqual(new Set(both.data.viewers.map(v=>v.userId)),new Set(['a','b']))
  assert(!JSON.stringify(both).includes('example.test'),'Presence must never expose emails')
  await presence('a',aTab,'leave')
  assert.equal((await presence('b',bTab)).data.viewers.length,2,'Leaving one tab preserves the other')
  await presence('a',aTab2,'leave')
  assert.equal((await presence('b',bTab)).data.viewers.length,1)
  const another=await tool('c','records.create',{collection:'incidents',recordId:'other',data:{title:'Other incident',rawLog:'other',status:'Pending analysis'}},true)
  const otherPresence=await action('c','incidentViewers',{incidentId:'other',incidentCreatedAt:another.data.record.createdAt,sessionId:randomUUID(),intent:'heartbeat'})
  assert.deepEqual(otherPresence.data.viewers.map(v=>v.userId),['c'])
  // A revoked author can neither read history nor submit another assessment.
  const revokedAt=b.messages.length
  assert.equal((await collab('a',{intent:'remove',userId:'b'})).success,true)
  await b.wait(m=>m.type==='core.query_result'&&m.payload.records.length===0,revokedAt)
  assert.equal((await b.query('incident_assessments')).length,0)
  assert.equal((await history('b')).success,false)
  assert.equal((await review('b',{...save,requestId:randomUUID(),expectedSequence:13})).success,false)
  assert.equal((await presence('b',bTab)).success,false)
  assert.deepEqual((await presence('a',aTab)).data.viewers.map(v=>v.userId),['a'])
  assert.equal((await history('a')).data.records[0].data.sequence,13)
  // Check source again inside RecordRoom, after the read-only AI lookup.
  const update={intent:'update',...source,expectedSource:{title:'Judgment verification',rawLog:'request timed out'},data:{rawLog:'changed logs'}}
  assert.equal((await action('a','saveIncident',update)).success,true)
  assert.equal((await review('a',{...save,requestId:randomUUID(),expectedSequence:13})).success,false)
  const staleInternal=await stub.fetch('https://internal/incident-assessment',{method:'POST',headers:{Authorization:`Bearer ${tokens.a}`,'Content-Type':'application/json'},body:JSON.stringify({input:{...scope,...save,requestId:randomUUID(),expectedSequence:13},verified:{sourceVersion:ai.data.sourceVersion,...ai.data.result.hypotheses[0]}})})
  assert.equal(staleInternal.status,409)
  assert.equal((await history('a')).data.records[0].data.sequence,13,'Old audit remains saved')
  for(const ws of sockets) ws.close()
  await runtime.dispose();runtime=new Miniflare(config);await setupStub()
  assert.equal((await history('a')).data.records[0].data.sequence,13,'History survives a Worker restart')
  assert.equal((await review('b',bSave)).success,false,'Restart does not restore revoked access')
  assert.equal((await presence('a',aTab)).data.viewers.length,1,'Ephemeral viewers rebuild after restart')
  assert.equal((await tool('a','records.delete',{collection:'incidents',recordId:'incident'})).success,true)
  assert.equal((await history('a')).success,false)
  assert.equal((await presence('a',aTab)).success,false)
  const recreated=await tool('c','records.create',{collection:'incidents',recordId:'incident',data:{title:'New source',rawLog:'new',status:'Pending analysis'}},true)
  assert.equal(recreated.success,true)
  assert.equal((await history('c')).success,false)
  assert.equal((await read('c','incident_assessments')).data.records.length,0)
  assert.equal(providerCalls,1,'All judgment/presence/status operations are provider-free')
  assert.equal(externalCalls,0)
  console.log('PASS: version-bound immutable judgments, real two-user live sync, conflict rejection, deduplication, bounded keyset history, revocation/deletion/restart, scoped authenticated ephemeral presence, tab deduplication and leave; 1 mocked AI call, 0 external calls.')
} finally { await runtime.dispose();await rm(persistence,{recursive:true,force:true}) }

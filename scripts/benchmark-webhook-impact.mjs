// Real local Worker/SQLite/WebSockets, ephemeral identities, no external services.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir, arch, platform, cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('ES256')
const issuer = 'https://collaboration.test'
const tokens = {}
for (const id of ['owner', 'observer', ...Array.from({length: 41}, (_, i) => `bench-${i}`)]) tokens[id] = await new SignJWT({ name: `Test ${id}`, email: `${id}@example.test` }).setProtectedHeader({ alg: 'ES256' }).setSubject(id).setIssuer(issuer).setExpirationTime('15m').sign(privateKey)
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
// Reproducible closed-loop benchmark. Fresh SQLite per invocation, warm samples.
const label = process.argv[2] ?? 'baseline'
const withLoad = process.argv.includes('--load')
const paced = process.argv.includes('--pace')
const pause = ms => new Promise(resolve => setTimeout(resolve,ms))
const samples = { create: [], discussionAck: [], discussionVisible: [], webhook: [], webhookSaved: [], webhookRejected: [] }
const sockets = []
let loadRunning = true, loadAttempts = 0, loadAccepted = 0, loadLimited = 0, loadErrors = 0
const percentile = (values, q) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1]
const summary = values => ({ samples: values.length, p50Ms: percentile(values,.5), p95Ms: percentile(values,.95) })
const sources = []
async function sourceCall(user, input) {
  return (await runtime.dispatchFetch('http://local.test/api/webhook-source', {method:'POST',headers:{Authorization:`Bearer ${tokens[user]}`, 'Content-Type':'application/json'},body:JSON.stringify(input)})).json()
}
try {
  await setupStub()
  for (const user of ['observer', ...Array.from({length:41},(_,i)=>`bench-${i}`)]) {
    assert.equal((await tool('owner','users.register',{userId:user,name:user,email:`${user}@example.test`,isAdmin:false},true)).success,true)
  }
  for(let i=0;i<1000;i++) assert.equal((await tool('bench-0','records.create',{collection:'incidents',recordId:`seed-${i}`,data:{title:'Fictional seed',rawLog:'x'.repeat(1000),status:'Pending analysis'}},true)).success,true)
  const incidents=[]
  for(let i=0;i<41;i++) {
    const user=`bench-${i}`, recordId=`discussion-${i}`
    assert.equal((await tool(user,'records.create',{collection:'incidents',recordId,data:{title:'Fictional discussion',rawLog:'x'.repeat(1000),status:'Pending analysis'}},true)).success,true)
    const record=(await tool(user,'records.get',{collection:'incidents',recordId},true)).data.record
    incidents.push(record)
    assert.equal((await tool(user,'records.create',{collection:'incident_members',recordId:`member-${i}`,data:{incidentId:recordId,incidentCreatedAt:record.createdAt,incidentOwner:user,userId:'observer'}},true)).success,true)
    if(withLoad && i<20) {
      const result=await sourceCall(user,{intent:'rotate',expectedVersion:null})
      assert.equal(result.success,true,JSON.stringify(result));sources.push(result.data)
    }
  }
  const res=await runtime.dispatchFetch(`http://local.test/ws/app:app_collaboration_test?token=${tokens.observer}`,{headers:{Upgrade:'websocket'}})
  assert.equal(res.status,101);const ws=res.webSocket;ws.accept();sockets.push(ws)
  const seen=new Map(), waiters=new Set()
  ws.addEventListener('message',event=>{
    const frame=JSON.parse(event.data)
    if(frame.type==='core.record_change' && frame.payload?.record?.collection==='incident_notes') seen.set(frame.payload.record.data.body,performance.now())
    // SDK envelopes use collection on payload in some versions.
    if(frame.type==='core.record_change' && frame.payload?.collection==='incident_notes' && frame.payload.record) seen.set(frame.payload.record.data.body,performance.now())
    for(const check of waiters)check(frame)
  })
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('subscribe timeout')),5000)
    const check=frame=>{if(frame.type==='core.query_result'){clearTimeout(timer);waiters.delete(check);resolve()}}
    waiters.add(check);ws.send(JSON.stringify({type:'core.subscribe',payload:{subscriptionId:randomUUID(),query:{collection:'incident_notes',limit:50}}}))
  })
  const startWall=performance.now()
  const load=withLoad ? (async()=>{
    while(loadRunning){
      const start=performance.now(), source=sources[loadAttempts%sources.length];loadAttempts++
      const response=await runtime.dispatchFetch('http://local.test/api/webhooks/incidents',{method:'POST',headers:{Authorization:`Bearer ${source.token}`,'Content-Type':'application/json'},body:JSON.stringify({eventId:randomUUID(),occurredAt:new Date().toISOString(),title:'Fictional webhook',summary:'x'.repeat(1000)})})
      await response.text();const elapsed=performance.now()-start;samples.webhook.push(elapsed);(response.status===201?samples.webhookSaved:samples.webhookRejected).push(elapsed)
      if(response.status===201)loadAccepted++;else if(response.status===429)loadLimited++;else loadErrors++
      if(paced)await pause(Math.max(0,200-(performance.now()-start)))
    }
  })() : Promise.resolve()
  for(let i=0;i<105;i++){
    const n=i<5?40:Math.floor((i-5)/5), user=`bench-${n}`, record=incidents[n]
    let start=performance.now()
    const created=await action(user,'saveIncident',{intent:'create',requestId:randomUUID(),data:{title:'Fictional benchmark',rawLog:'x'.repeat(1000)}})
    assert.equal(created.success,true,JSON.stringify(created));if(i>=5)samples.create.push(performance.now()-start)
    const body=`bench-note-${i}`;start=performance.now()
    const visible=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.delete(check);reject(Error('note visibility timeout'))},5000)
      const check=()=>{if(seen.has(body)){clearTimeout(timer);waiters.delete(check);resolve(seen.get(body))}}
      waiters.add(check);check()
    })
    const note=await action(user,'incidentCollaboration',{intent:'note',incidentId:record.recordId,incidentCreatedAt:record.createdAt,requestId:randomUUID(),body})
    assert.equal(note.success,true,JSON.stringify(note));const ack=performance.now()-start
    const arrived=await visible
    if(i>=5){samples.discussionAck.push(ack);samples.discussionVisible.push(arrived-start)}
    if(paced)await pause(100)
  }
  loadRunning=false;await load
  assert.equal(externalCalls,0);assert.equal(loadErrors,0)
  const seconds=(performance.now()-startWall)/1000
  const result={label,measuredAt:new Date().toISOString(),buildSha256:createHash('sha256').update(await readFile(resolve('dist/incidentdesk/index.js'))).digest('hex'),machine:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model},environment:'isolated local Miniflare/SQLite; no WAN or browser rendering',node:process.version,initialIncidents:1041,actorAccounts:41,observerSockets:1,foregroundConcurrency:1,loadConcurrency:withLoad?1:0,logCharacters:1000,warmupPerOperation:5,foregroundPauseMs:paced?100:0,offeredWebhookIntervalMs:paced&&withLoad?200:null,seconds,create:summary(samples.create),discussionAck:summary(samples.discussionAck),discussionVisible:summary(samples.discussionVisible),webhookSaved:summary(samples.webhookSaved),webhookRejected:summary(samples.webhookRejected),load:{attempts:loadAttempts,accepted:loadAccepted,limited:loadLimited,errors:loadErrors,acceptedPerSecond:loadAccepted/seconds,attemptsPerSecond:loadAttempts/seconds},externalCalls,rawSamplesMs:samples}
  await writeFile(`docs/performance/webhook-${label}.json`,JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({...result,rawSamplesMs:undefined}))
} finally {loadRunning=false;for(const ws of sockets)ws.close(1000);await runtime.dispose();await rm(persistence,{recursive:true,force:true})}

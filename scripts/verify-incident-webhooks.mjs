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
  bindings: { DEEPSPACE_APP_ID: 'app_webhook_test', OWNER_USER_ID: 'owner', AUTH_JWT_ISSUER: issuer, AUTH_JWT_PUBLIC_KEY: await exportSPKI(publicKey), AUTH_WORKER_URL: issuer, APP_NAME: 'test' },
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
async function setup() { const ns = await runtime.getDurableObjectNamespace('RECORD_ROOMS'); stub = ns.get(ns.idFromName('app:app_webhook_test')) }
async function tool(user, name, params, privileged = false) {
  return (await stub.fetch('https://internal/api/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': user, ...(privileged ? { 'X-App-Action': 'true' } : {}) }, body: JSON.stringify({ tool: name, params }) })).json()
}
async function action(user, name, input) {
  return (await runtime.dispatchFetch(`http://local.test/api/actions/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json()
}
async function socket(user) {
  const response = await runtime.dispatchFetch(`http://local.test/ws/app:app_webhook_test?token=${tokens[user]}`, { headers: { Upgrade: 'websocket' } })
  assert.equal(response.status, 101)
  const ws = response.webSocket; ws.accept(); sockets.push(ws)
  const query = { collection: 'incidents', limit: 20 }
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
async function source(user,input){
 const response=await runtime.dispatchFetch('http://local.test/api/webhook-source',{method:'POST',headers:{Authorization:`Bearer ${tokens[user]}`,'Content-Type':'application/json'},body:JSON.stringify(input)})
 assert.equal(response.headers.get('Cache-Control'),'no-store')
 return {status:response.status,...await response.json()}
}
async function deliver(token,input){
 const response=await runtime.dispatchFetch('http://local.test/api/webhooks/incidents',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)})
 assert.equal(response.headers.get('Cache-Control'),'no-store')
 return {status:response.status,...await response.json()}
}
try{
 await setup()
 const a=await socket('a'), b=await socket('b')
 const absent=await source('a',{intent:'status'});assert.equal(absent.data.source,null)
 assert.equal((await source('unregistered',{intent:'rotate',expectedVersion:null})).status,403)
 const created=await source('a',{intent:'rotate',expectedVersion:null});assert.equal(created.status,200,JSON.stringify(created))
 const {token,source:metadata}=created.data
 assert.equal((await source('b',{intent:'status'})).data.source,null)
 assert.equal((await source('a',{intent:'status'})).data.token,undefined)
 const event={eventId:'demo-1',title:'Fictional webhook incident',summary:'Fictional timeout',occurredAt:new Date().toISOString(),sourceUrl:'https://example.test/run/1'}
 assert.equal((await deliver(tokens.a,event)).status,401)
 assert.equal((await deliver(token,{...event,owner:'b'})).status,400)
 const start=a.frames.length
 const accepted=await Promise.all(Array.from({length:12},()=>deliver(token,event)))
 assert.equal(accepted.filter(r=>r.status===201).length,1,JSON.stringify(accepted))
 assert.equal(accepted.filter(r=>r.status===200).length,11)
 const recordId=accepted[0].data.recordId
 await a.wait(frame=>frame.type==='core.record_change'&&frame.payload?.record?.recordId===recordId,start)
 const record=(await tool('a','records.get',{collection:'incidents',recordId})).data.record
 assert.equal(record.createdBy,'a');assert.match(record.data.rawLog,/Fictional timeout/)
 assert.equal((await tool('b','records.get',{collection:'incidents',recordId})).success,false)
 assert.equal(b.frames.some(frame=>frame.type==='core.record_change'&&frame.payload?.record?.recordId===recordId),false)
 assert.equal((await action('a','listIncidents',{view:'mine'})).data.entries.some(e=>e.recordId===recordId),true)
 assert.equal((await deliver(token,{...event,summary:'changed'})).status,409)
 const incidentSource={incidentId:recordId,incidentCreatedAt:record.createdAt}
 assert.equal((await action('a','incidentCollaboration',{intent:'add',...incidentSource,userId:'b'})).success,true)
 assert.equal((await action('b','incidentCollaboration',{intent:'note',...incidentSource,requestId:randomUUID(),body:'Fictional webhook investigation note'})).success,true)
 for(const ws of sockets.splice(0))ws.close(1000)
 await runtime.dispose();runtime=new Miniflare(config);await setup()
 assert.equal((await deliver(token,event)).status,200,'Receipt and source survive restart')
 assert.equal((await source('a',{intent:'status'})).data.source.admitted,1)
 assert.equal((await tool('a','records.delete',{collection:'incidents',recordId})).success,true)
 assert.equal((await deliver(token,event)).status,410,'Deleted records cannot be resurrected')
 assert.equal((await deliver(token,{...event,eventId:'demo-2'})).status,201)
 assert.equal((await deliver(token,{...event,eventId:'demo-3'})).status,201)
 const limited=await deliver(token,{...event,eventId:'demo-4'});assert.equal(limited.status,429)
 const oversized=await runtime.dispatchFetch('http://local.test/api/webhooks/incidents',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'x'.repeat(32769)})
 assert.equal(oversized.status,413)
 assert.equal((await source('a',{intent:'disable',expectedVersion:metadata.version})).status,200)
 assert.equal((await deliver(token,{...event,eventId:'demo-5'})).status,401)
 assert.equal(externalCalls,0);assert.equal(authCalls,0)
 console.log(JSON.stringify({passed:true,concurrentDeliveries:12,incidentsCreatedForConcurrentEvent:1,coverage:'HTTP/JWT/source isolation, live owner broadcast, collaborator notes, restart, removal, size and rate bounds, disable',externalCalls,authCalls}))
}finally{for(const ws of sockets)ws.close(1000);await runtime.dispose();await rm(persistence,{recursive:true,force:true})}

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

try {
  await setupStub()
  for(const user of ['a','b','c']) assert.equal((await tool('owner','users.register',{userId:user,name:`Test ${user}`,email:`${user}@example.test`,isAdmin:false},true)).success,true)
  const created=await tool('a','records.create',{collection:'incidents',recordId:'incident',data:{title:'Fictional findings handoff',rawLog:'request timed out',status:'Pending analysis'}},true)
  assert.equal(created.success,true)
  const source={incidentId:'incident',incidentCreatedAt:created.data.record.createdAt}
  const collab=(intent,userId)=>action('a','incidentCollaboration',{...source,intent,userId})
  assert.equal((await collab('add','b')).success,true)
  const ai=await action('a','analyzeIncident',{incidentId:'incident',intent:'generate'})
  assert.equal(ai.data.phase,'complete')
  const query={incidentId:'incident',analysisVersion:ai.data.analysisVersion}
  assert.deepEqual((await action('a','incidentFindings',query)).data.findings,[])
  const review=(status,sequence,reason)=>action('b','assessHypothesis',{...source,analysisVersion:ai.data.analysisVersion,hypothesisIndex:0,intent:'save',requestId:randomUUID(),expectedSequence:sequence,status,reason})
  assert.equal((await review('Confirmed',0,'Fictional measured dependency delay.')).success,true)
  const durations=[]
  for(let i=0;i<105;i++) {
    const start=performance.now()
    assert.equal((await action('a','incidentFindings',query)).success,true)
    if(i>=5) durations.push(performance.now()-start)
  }
  durations.sort((a,b)=>a-b)
  console.log(JSON.stringify({measurement:'findings action round trip',environment:'isolated local Workers/SQLite',concurrency:1,hypotheses:1,judgments:1,samples:100,warmup:5,p50Ms:durations[49],p95Ms:durations[94]}))
  const snapshot=await action('a','incidentFindings',query)
  assert.equal(snapshot.data.findings.length,1)
  assert.equal(snapshot.data.findings[0].actorName,'Test b')
  assert.equal(snapshot.data.findings[0].actorId,'b')
  assert.equal(snapshot.data.findings[0].sequence,1)
  assert.ok(!JSON.stringify(snapshot).includes('b@example.test'))
  for(const user of ['b','c','unregistered']) assert.equal((await action(user,'incidentFindings',query)).success,false)
  assert.equal((await action('a','incidentFindings',{...query,analysisVersion:'f'.repeat(64)})).success,false)
  assert.equal((await action('a','incidentFindings',{...query,sourceVersion:ai.data.sourceVersion})).success,false)
  const prepare={incidentId:'incident',intent:'prepare',to:'nobody@example.test',subject:'Fictional handoff',includeLogs:false}
  const first=await action('a','incidentEmail',prepare)
  assert.equal(first.success,true,JSON.stringify(first))
  const firstDraft=first.data.draft
  assert.ok(firstDraft.html.includes('Hypothesis 1 · Confirmed'))
  assert.ok(firstDraft.content.includes('Investigation findings'))
  assert.ok(firstDraft.content.includes('Human judgment: Confirmed'))
  assert.ok(firstDraft.content.includes('Test b (b)'))
  assert.equal((await review('Ruled out',1,'Fictional comparison does not support the cause.')).success,true)
  const restored=await action('a','incidentEmail',{incidentId:'incident',intent:'status'})
  assert.deepEqual(restored.data.draft,firstDraft,'New judgments must not mutate a reviewed draft')
  const second=await action('a','incidentEmail',prepare)
  assert.equal(second.success,true)
  assert.notEqual(second.data.draft.id,firstDraft.id)
  assert.ok(second.data.draft.content.includes('Human judgment: Ruled out'))
  assert.ok(second.data.draft.html.includes('Hypothesis 1 · Ruled out'))
  assert.ok(!second.data.draft.content.includes('Human judgment: Confirmed'))
  const repeat=await action('a','incidentEmail',prepare)
  assert.equal(repeat.data.draft.id,second.data.draft.id,'Unchanged findings must not mint a new draft just because read time changed')
  assert.equal((await collab('remove','b')).success,true)
  assert.equal((await action('a','incidentFindings',query)).data.findings[0].actorId,'b','Removed author remains in authorized history')
  assert.equal((await action('b','incidentEmail',prepare)).success,false)
  await runtime.dispose();runtime=new Miniflare(config);await setupStub()
  assert.deepEqual((await action('a','incidentEmail',{incidentId:'incident',intent:'status'})).data.draft,second.data.draft)
  assert.equal((await tool('a','records.update',{collection:'incidents',recordId:'incident',data:{rawLog:'Different source'}},true)).success,true)
  assert.equal((await action('a','incidentFindings',query)).success,false)
  const changed=await action('a','incidentEmail',prepare)
  assert.equal(changed.success,true)
  assert.ok(!changed.data.draft.content.includes('Fictional comparison'))
  assert.ok(changed.data.draft.content.includes('No completed AI analysis'))
  assert.equal(providerCalls,1,'Only the initial mock AI fixture; all report/prepare/status calls provider-free')
  assert.equal(externalCalls,0)
  console.log('PASS: latest-version findings, creator authorization, removed-author attribution, frozen/reprepared/idempotent drafts, restart and changed-source exclusion; one mock AI fixture, zero real provider/email calls')
} finally {await runtime.dispose();await rm(persistence,{recursive:true,force:true})}

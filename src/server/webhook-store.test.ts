import { afterEach, expect, it, vi } from 'vitest'
import { initializeWebhooks, manageWebhook, receiveWebhook, WEBHOOK_LIMITS } from './webhook-store'
import { sourceRequest, webhookEvent, type SourceRequest, type SourceResult } from '../features/incidents/webhooks/webhook-types'
import { readWebhookBody } from './webhook-routes'
const moduleName='node:sqlite'
const {DatabaseSync}=await import(moduleName)
const databases:{close():void}[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
const now=Date.parse('2026-09-13T08:00:00Z')
async function fixture(){
 const db=new DatabaseSync(':memory:');databases.push(db)
 db.exec('CREATE TABLE c_incidents (_row_id TEXT PRIMARY KEY, value TEXT)')
 const sql={exec(query:string,...args:(string|number)[]){return{toArray:()=>db.prepare(query).all(...args)}}} as unknown as SqlStorage
 // SqlStorage executes eagerly, unlike this test adapter's initial shape.
 sql.exec=((query:string,...args:(string|number)[])=>{const rows=db.prepare(query).all(...args);return{toArray:()=>rows}}) as SqlStorage['exec']
 initializeWebhooks(sql)
 const transaction=(fn:()=>void)=>{db.exec('BEGIN');try{fn();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
 let interruption:''|'before'|'after'='', denied=false
 const tool=vi.fn(async(user:string,name:string,params:Record<string,unknown>)=>{
  if(params.collection==='users')return denied?{success:false as const,error:'Record not found'}:{success:true as const,data:{record:{data:{role:'member'}}}}
  const row=db.prepare('SELECT value FROM c_incidents WHERE _row_id=?').get(params.recordId) as {value:string}|undefined
  if(name==='records.get')return row?{success:true as const,data:{record:JSON.parse(row.value)}}:{success:false as const,error:'Record not found'}
  if(interruption==='before'){interruption='';throw Error('crash before write')}
  db.prepare('INSERT INTO c_incidents VALUES (?,?)').run(params.recordId,JSON.stringify({recordId:params.recordId,createdBy:user,createdAt:new Date(now).toISOString(),data:params.data}))
  if(interruption==='after'){interruption='';throw Error('crash after write')}
  return{success:true as const,data:{recordId:params.recordId}}
 })
 const manage=(input:SourceRequest,user='a',time=now)=>manageWebhook(sql,user,input,time)
 const created=await (await manage({intent:'rotate',expectedVersion:null})).json() as {data:{source:{id:string;version:string};token:string}}
 const input={eventId:'event-1',occurredAt:new Date(now).toISOString(),title:'Fictional alert',summary:'Fictional logs'}
 const receive=(event=input,token=created.data.token,time=now)=>receiveWebhook(sql,transaction,token,event,tool,time)
 return{db,sql,manage,created:created.data,input,receive,tool,interrupt:(where:'before'|'after')=>{interruption=where},deny:()=>{denied=true}}
}
it('stores only a digest and never returns credentials through status',async()=>{
 const f=await fixture();const row=f.db.prepare('SELECT * FROM webhook_sources').get()
 expect(JSON.stringify(row)).not.toContain(f.created.token)
 expect(await (await f.manage({intent:'status'})).json()).not.toHaveProperty('data.token')
 expect((await (await f.manage({intent:'status'},'b')).json() as {data:SourceResult}).data.source).toBeNull()
 expect(sourceRequest.safeParse({intent:'status',owner:'a'}).success).toBe(false)
})
it('rotates with optimistic concurrency, cooldown and immediate old-token invalidation',async()=>{
 const f=await fixture()
 expect((await f.manage({intent:'rotate',expectedVersion:null})).status).toBe(409)
 expect((await f.manage({intent:'rotate',expectedVersion:f.created.source.version})).status).toBe(429)
 const next=await (await f.manage({intent:'rotate',expectedVersion:f.created.source.version},'a',now+60001)).json() as {data:SourceResult}
 expect(next.data.source!.id).toBe(f.created.source.id)
 expect((await f.receive()).status).toBe(401)
 expect((await f.receive(f.input,next.data.token!)).status).toBe(201)
 expect((await f.manage({intent:'disable',expectedVersion:f.created.source.version})).status).toBe(409)
})
it('disables acceptance without removing saved incidents',async()=>{
 const f=await fixture();expect((await f.receive()).status).toBe(201)
 expect((await f.manage({intent:'disable',expectedVersion:f.created.source.version})).status).toBe(200)
 expect((await f.receive()).status).toBe(401)
 expect(f.db.prepare('SELECT COUNT(*) n FROM c_incidents').get().n).toBe(1)
})
it('deduplicates retries, rejects changed content, and preserves edits',async()=>{
 const f=await fixture();expect((await f.receive()).status).toBe(201)
 expect((await f.receive()).status).toBe(200)
 expect((await f.receive({...f.input,summary:'different'})).status).toBe(409)
 expect(f.tool.mock.calls.filter(([,name])=>name==='records.create')).toHaveLength(1)
 expect(f.db.prepare('SELECT COUNT(*) n FROM webhook_receipts').get().n).toBe(1)
})
for(const point of ['before','after'] as const)it(`recovers interruption ${point} SDK persistence without charging admission twice`,async()=>{
 const f=await fixture();f.interrupt(point);await expect(f.receive()).rejects.toThrow('crash')
 expect(f.db.prepare('SELECT phase FROM webhook_receipts').get().phase).toBe('accepting')
 expect([200,201]).toContain((await f.receive()).status)
 expect(f.db.prepare('SELECT COUNT(*) n FROM c_incidents').get().n).toBe(1)
 const status=await (await f.manage({intent:'status'})).json() as {data:SourceResult};expect(status.data.source!.admitted).toBe(1)
})
it('does not recreate deleted accepted or unfinished incidents',async()=>{
 for(const unfinished of [false,true]){
  const f=await fixture()
  if(unfinished){f.interrupt('after');await expect(f.receive()).rejects.toThrow()}else await f.receive()
  f.db.prepare('DELETE FROM c_incidents').run()
  expect((await f.receive()).status).toBe(410)
  expect(f.db.prepare('SELECT COUNT(*) n FROM c_incidents').get().n).toBe(0)
 }
})
it('enforces per-source burst and permits matching retries without fresh admission',async()=>{
 const f=await fixture()
 for(let i=0;i<3;i++)expect((await f.receive({...f.input,eventId:`event-${i}`})).status).toBe(201)
 const limited=await f.receive({...f.input,eventId:'event-4'});expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('12')
 expect((await f.receive()).status).toBe(200)
 expect((await f.receive({...f.input,eventId:'event-4'},f.created.token,now+12000)).status).toBe(201)
})
it('bounds request retries even when deduplicated',async()=>{
 const f=await fixture();await f.receive()
 for(let i=0;i<19;i++)expect((await f.receive()).status).toBe(200)
 expect((await f.receive()).status).toBe(429)
})
it('enforces daily limits and lifetime admission across rotation and UTC days',async()=>{
 const f=await fixture();await f.receive()
 const state=JSON.parse(f.db.prepare('SELECT value FROM webhook_budget').get().value)
 state.owners.a.count=100;f.db.prepare('UPDATE webhook_budget SET value=?').run(JSON.stringify(state))
 expect((await f.receive({...f.input,eventId:'daily'})).status).toBe(429)
 expect((await f.receive({...f.input,eventId:'tomorrow',occurredAt:new Date(now+86400000).toISOString()},f.created.token,now+86400000)).status).toBe(201)
 state.owners.a.total=WEBHOOK_LIMITS.sourceTotal;f.db.prepare('UPDATE webhook_budget SET value=?').run(JSON.stringify(state))
 const next=await (await f.manage({intent:'rotate',expectedVersion:f.created.source.version},'a',now+60001)).json() as {data:SourceResult}
 expect((await f.receive({...f.input,eventId:'full'},next.data.token!,now+86400000)).status).toBe(409)
})
it('rejects invalid source credentials, removed owner and stale or future events',async()=>{
 const f=await fixture()
 expect((await f.receive(f.input,f.created.token.slice(0,-1)+(f.created.token.endsWith('0')?'1':'0'))).status).toBe(401)
 expect((await f.receive({...f.input,occurredAt:new Date(now-8*86400000).toISOString()})).status).toBe(400)
 expect((await f.receive({...f.input,occurredAt:new Date(now+600000).toISOString()})).status).toBe(400)
 f.deny();expect((await f.receive()).status).toBe(403)
})
it('validates strict bounded payloads and HTTPS source links',()=>{
 const valid={eventId:'1',occurredAt:new Date(now).toISOString(),title:'alert',summary:'logs'}
 for(const input of [{...valid,owner:'b'},{...valid,title:'x'.repeat(121)},{...valid,summary:'x'.repeat(19001)},{...valid,sourceUrl:'http://example.test'},{...valid,sourceUrl:'https://user:pass@example.test'}])expect(webhookEvent.safeParse(input).success).toBe(false)
 expect(webhookEvent.safeParse({...valid,sourceUrl:'https://example.test/run/1'}).success).toBe(true)
})
it('bounds streamed bytes independent of Content-Length and refuses invalid JSON',async()=>{
 const request=new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1'},body:'x'.repeat(2049)})
 await expect(readWebhookBody(request,2048)).rejects.toHaveProperty('status',413)
 await expect(readWebhookBody(new Request('https://test',{method:'POST',body:'{}'}),2048)).rejects.toHaveProperty('status',415)
 await expect(readWebhookBody(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:'bad'}),2048)).rejects.toHaveProperty('status',400)
})
it('enforces aggregate admission across independent sources',async()=>{
 const f=await fixture()
 for(let i=0;i<4;i++){
  const issued=await (await f.manage({intent:'rotate',expectedVersion:null},`user-${i}`)).json() as {data:SourceResult}
  for(let j=0;j<3;j++){
   const response=await f.receive({...f.input,eventId:`global-${i}-${j}`},issued.data.token!)
   expect(response.status).toBe(i*3+j<10?201:429)
  }
 }
 expect(f.db.prepare('SELECT COUNT(*) n FROM c_incidents').get().n).toBe(10)
})
it('does not leave a quota debit when reservation insertion fails',async()=>{
 const f=await fixture()
 f.db.exec("CREATE TRIGGER fail_reservation BEFORE INSERT ON webhook_receipts BEGIN SELECT RAISE(ABORT,'test write failure'); END")
 await expect(f.receive()).rejects.toThrow('test write failure')
 expect(f.db.prepare('SELECT COUNT(*) n FROM webhook_budget').get().n).toBe(0)
 expect(f.db.prepare('SELECT COUNT(*) n FROM c_incidents').get().n).toBe(0)
 f.db.exec('DROP TRIGGER fail_reservation')
 expect((await f.receive()).status).toBe(201)
})
it('limits source count without changing another account source',async()=>{
 const f=await fixture()
 for(let i=1;i<100;i++)expect((await f.manage({intent:'rotate',expectedVersion:null},`owner-${i}`)).status).toBe(200)
 expect((await f.manage({intent:'rotate',expectedVersion:null},'one-too-many')).status).toBe(409)
 expect((await f.manage({intent:'disable',expectedVersion:f.created.source.version},'b')).status).toBe(409)
 expect((await f.receive()).status).toBe(201)
})
it('times out a stalled body and cancels the reader',async()=>{
 vi.useFakeTimers()
 try {
  const cancel=vi.fn()
  const request=new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({cancel}),duplex:'half'} as RequestInit)
  const pending=expect(readWebhookBody(request,2048)).rejects.toHaveProperty('status',408)
  await vi.advanceTimersByTimeAsync(10000)
  await pending;expect(cancel).toHaveBeenCalledOnce()
 }finally{vi.useRealTimers()}
})

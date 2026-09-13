import { RECORD_NOT_FOUND } from 'deepspace/worker'
import { writeIncident } from './incident-write'
import { expect, it } from 'vitest'
import { reserveIncidentWrite } from './incident-write-limit'
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = await import(sqliteModule) as { DatabaseSync: new (path: string) => {
  exec(sql: string): void
  close(): void
  prepare(sql: string): { run(...values: (string | number)[]): unknown; get(...values: (string | number)[]): Record<string, string> | undefined; all(...values: (string | number)[]): unknown[] }
} }


function database() {
  const db = new DatabaseSync(':memory:')
  const sql = {exec(statement: string,...values:(string|number)[]) {
    if(statement.startsWith('CREATE')) {db.exec(statement); return {toArray:()=>[]}}
    if(statement.startsWith('SELECT')) return {toArray:()=>db.prepare(statement).all(...values)}
    db.prepare(statement).run(...values); return {toArray:()=>[]}
  }} as unknown as SqlStorage
  return {db,sql}
}
it('enforces bursts, exact refill boundaries, actor/operation isolation and retry fingerprints', async()=>{
  const {db,sql}=database()
  try {
    const admit=(key:string,now=100000,content='same')=>reserveIncidentWrite(sql,'a','create',key,content,now)
    for(let i=0;i<5;i++) expect(await admit(String(i))).toBeNull()
    const refused=await admit('next')
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('Retry-After')).toBe('12')
    expect(await refused?.json()).toMatchObject({code:'rate_limited',retryAfterSeconds:12})
    expect(await admit('0')).toBeNull()
    expect((await admit('0',100000,'changed'))?.status).toBe(409)
    expect((await admit('next',111999))?.status).toBe(429)
    expect(await admit('next',112000)).toBeNull()
    expect((await admit('another',112000))?.status).toBe(429)
    expect(await reserveIncidentWrite(sql,'b','create','x','x',100000)).toBeNull()
    for(let i=0;i<10;i++) expect(await reserveIncidentWrite(sql,'a','note',String(i),'note',100000)).toBeNull()
    expect((await reserveIncidentWrite(sql,'a','note','extra','note',100000))?.status).toBe(429)
    expect(await reserveIncidentWrite(sql,'a','note','extra','note',102000)).toBeNull()
    // A backward wall clock must not grant a fresh burst.
    expect((await admit('backwards',90000))?.status).toBe(429)
  }finally{db.close()}
})
it('bounds reservation state and removes expired buckets in bounded batches',async()=>{
  const {db,sql}=database()
  try {
    for(let i=0;i<200;i++) expect(await reserveIncidentWrite(sql,'a','note',String(i),'body',100000+i*2000)).toBeNull()
    const row=db.prepare('SELECT receipts FROM incident_write_limits').get()!
    expect(JSON.parse(row.receipts).length).toBeLessThanOrEqual(20)
    for(let i=0;i<150;i++) await reserveIncidentWrite(sql,'user'+i,'create','x','body',500000)
    await reserveIncidentWrite(sql,'new','create','x','body',600000)
    expect(db.prepare('SELECT COUNT(*) AS count FROM incident_write_limits').get()!.count).toBe(52)
    await reserveIncidentWrite(sql,'new2','create','x','body',600000)
    expect(db.prepare('SELECT COUNT(*) AS count FROM incident_write_limits').get()!.count).toBe(2)
  }finally{db.close()}
})

it.each([false,true])('recovers an interrupted SDK write (persisted=%s) without charging the request twice',async(persisted)=>{
  const {db,sql}=database()
  try {
    const rows=new Map<string,unknown>()
    let interrupt=true
    const tool=async(user:string,name:string,params:Record<string,unknown>)=>{
      const id=params.recordId as string
      if(name==='records.get') return rows.has(id) ? {success:true as const,data:{record:rows.get(id)}} : {success:false as const,error:RECORD_NOT_FOUND}
      if(!interrupt||persisted) rows.set(id,{recordId:id,createdBy:user,createdAt:'now',data:params.data})
      if(interrupt) {interrupt=false;throw new Error('Simulated interruption')}
      return {success:true as const,data:{recordId:id}}
    }
    const input={intent:'create' as const,requestId:crypto.randomUUID(),data:{title:'Test',rawLog:'Fictional'}}
    const admit=(op:'create'|'note',key:string,content:unknown)=>reserveIncidentWrite(sql,'a',op,key,content,100000)
    await expect(writeIncident(input,'a','member',tool,admit)).rejects.toThrow('Simulated interruption')
    for(let i=0;i<4;i++) expect(await admit('create',String(i),'x')).toBeNull()
    expect((await admit('create','full','x'))?.status).toBe(429)
    expect((await writeIncident(input,'a','member',tool,admit)).status).toBe(200)
    expect(rows.size).toBe(1)
    expect((await admit('create','still-full','x'))?.status).toBe(429)
  }finally{db.close()}
})

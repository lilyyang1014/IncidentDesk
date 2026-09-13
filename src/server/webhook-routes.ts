import type { Hono } from 'hono'
import type { AppContext } from '../../worker'
import { sourceRequest, webhookEvent, WEBHOOK_BODY_LIMIT } from '../features/incidents/webhooks/webhook-types'
import { resolveAuth } from './http-routes'
import { webhookError } from './webhook-store'

export async function readWebhookBody(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase().match(/^application\/json$/)) throw webhookError(415,'unsupported_media_type','Use application/json.')
  const reader = request.body?.getReader()
  if (!reader) throw webhookError(400,'invalid_request','A JSON body is required.')
  const chunks: Uint8Array[] = []; let length=0
  let timeout: ReturnType<typeof setTimeout>
  const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{reject(webhookError(408,'request_timeout','Request body timed out. Retry the same event.'));void reader.cancel().catch(()=>{})},10000)})
  try {
    while (true) {
      const {done,value} = await Promise.race([reader.read(),deadline]); if(done)break
      length+=value.length
      if(length>limit){await reader.cancel();throw webhookError(413,'payload_too_large',`Request exceeds ${limit} bytes.`)}
      chunks.push(value)
    }
    const bytes=new Uint8Array(length);let offset=0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
    catch{throw webhookError(400,'invalid_json','Invalid JSON body.')}
  } finally {clearTimeout(timeout!);reader.releaseLock()}
}
export function registerWebhookRoutes(app: Hono<AppContext>) {
  for (const [path, internal, management] of [['/api/webhook-source','/webhook-source',true],['/api/webhooks/incidents','/incident-webhook',false]] as const) {
    app.post(path,async c=>{
      const start=performance.now()
      let response: Response
      try {
        const authorization=c.req.header('Authorization')??''
        if(management){
          const auth=await resolveAuth(c.req.raw,c.env)
          if(!auth || auth.userId.startsWith('anon-') || !authorization.startsWith('Bearer ')) throw webhookError(401,'unauthorized','Sign in to manage your webhook source.')
        } else if(!/^Bearer [a-f0-9-]{36}\.[a-f0-9]{64}$/.test(authorization)) throw webhookError(401,'unauthorized','A webhook source token is required.')
        const body=await readWebhookBody(c.req.raw,management?2048:WEBHOOK_BODY_LIMIT)
        const parsed=management?sourceRequest.safeParse(body):webhookEvent.safeParse(body)
        if(!parsed.success)throw webhookError(400,'invalid_request','Invalid fields. Check the webhook request format and field limits.')
        const room=c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.DEEPSPACE_APP_ID}`))
        response=await room.fetch(new Request(`https://internal${internal}`,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(parsed.data)}))
      }catch(error){response=error instanceof Response?error:webhookError(503,'outcome_unknown','Could not confirm the request. Check source status or retry the same event.',5)}
      // No tokens, event bodies, external URLs, or email addresses in logs.
      if(!management)console.info(JSON.stringify({operation:'webhook.ingest',status:response.status,durationMs:Math.round((performance.now()-start)*100)/100}))
      const headers=new Headers(response.headers);headers.set('Cache-Control','no-store')
      return new Response(response.body,{status:response.status,headers})
    })
  }
}

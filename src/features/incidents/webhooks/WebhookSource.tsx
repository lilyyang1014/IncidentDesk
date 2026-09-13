import { useEffect, useRef, useState } from 'react'
import { getAuthToken, useMutations } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { sourceResult, type SourceRequest, type SourceResult } from './webhook-types'
import { z } from 'zod'

export async function requestWebhookSource(input: SourceRequest, signal?: AbortSignal): Promise<SourceResult> {
  const jwt=await getAuthToken()
  if(!jwt)throw new Error('Sign in to manage your webhook source.')
  const response=await fetch('/api/webhook-source',{method:'POST',headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),body:JSON.stringify(input)})
  const body=z.object({success:z.boolean(),error:z.string().optional(),data:sourceResult.optional()}).parse(await response.json())
  if(!response.ok || !body.success || !body.data)throw new Error(body.error??'Could not confirm the change. Check source status.')
  return body.data
}
export function WebhookSource() {
  const {ready}=useMutations('incidents')
  const [state,setState]=useState<SourceResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState<'rotate'|'disable'|null>(null),[copied,setCopied]=useState(false)
  const gate=useRef(false),controller=useRef<AbortController|null>(null),uncertain=useRef(false)
  useEffect(()=>{
    if(!ready)return
    const request=new AbortController();controller.current=request
    requestWebhookSource({intent:'status'},request.signal).then(value=>{if(!request.signal.aborted)setState(value)}).catch(err=>{if(!request.signal.aborted)setError(err instanceof Error?err.message:'Could not load source.')})
    return ()=>request.abort()
  },[ready])
  useEffect(()=>()=>controller.current?.abort(),[])
  async function change(input:SourceRequest){
    if(gate.current || !ready)return
    gate.current=true;setBusy(true);setError('');setCopied(false);setConfirm(null)
    controller.current?.abort();const request=new AbortController();controller.current=request
    try{
      const value=await requestWebhookSource(input,request.signal)
      if(!request.signal.aborted){setState(previous=>input.intent==='status' && previous?.source?.version===value.source?.version && value.source?.enabled?{...value,token:previous?.token}:value);uncertain.current=false}
    }catch(err){if(!request.signal.aborted){uncertain.current=true;setError(err instanceof Error?err.message:'Could not confirm the change.')}}
    finally{gate.current=false;if(!request.signal.aborted)setBusy(false)}
  }
  const source=state?.source
  const endpoint=`${window.location.origin}/api/webhooks/incidents`
  return <section className="mt-6 rounded-lg border border-border bg-card p-6 space-y-4">
    <h2 className="text-lg font-semibold">Webhook intake</h2>
    <p className="text-sm text-muted-foreground">Send alert summaries to create incidents owned by you. No AI analysis, searches or emails run automatically.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error} Check source status before another change.</p>}
    {!state && !error && <p role="status">Loading source…</p>}
    {state && <>
      <p className="text-sm">Status: <strong>{source?(source.enabled?'Active':'Disabled'):'Not configured'}</strong>{source && ` · ${source.admitted} events admitted`}</p>
      <label className="block text-sm" htmlFor="webhook-endpoint">Webhook endpoint</label>
      <Input id="webhook-endpoint" readOnly value={endpoint} onFocus={event=>event.currentTarget.select()}/>
      {state.token && source?.enabled && <div className="space-y-2">
        <label className="block text-sm" htmlFor="webhook-token">Source token — copy now; it cannot be retrieved after leaving this page</label>
        <Input id="webhook-token" type="password" autoComplete="off" readOnly value={state.token} onFocus={event=>event.currentTarget.select()}/>
        <Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(state.token!);setCopied(true)}catch{setError('Select and copy the token manually.')}}}>{copied?'Copied':'Copy token'}</Button>
      </div>}
      <p className="text-sm text-muted-foreground">One source per account. Up to 3 events in a burst, then one every 12 seconds; 100 per UTC day and 1,000 total. Shared app limits also apply. Changing the token does not reset limits.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready||busy||uncertain.current} onClick={()=>source?setConfirm('rotate'):void change({intent:'rotate',expectedVersion:null})}>{source?'Replace token and enable':'Create source'}</Button>
        {source?.enabled && <Button variant="outline" disabled={!ready||busy||uncertain.current} onClick={()=>setConfirm('disable')}>Disable source</Button>}
      </div>
      {confirm && source && <div className="space-y-2 border-l-2 border-border pl-3">
        <p className="text-sm">{confirm==='rotate'?'The old token will stop working immediately. Update your sender with the new token.':'New deliveries and retries will be rejected. Existing incidents remain available.'}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void change({intent:confirm,expectedVersion:source.version})}>{confirm==='rotate'?'Confirm replacement':'Confirm disable'}</Button><Button variant="outline" onClick={()=>setConfirm(null)}>Cancel</Button></div>
      </div>}
      <details className="text-sm space-y-2"><summary className="cursor-pointer">Request format and retry rules</summary>
        <p>POST JSON with an Authorization: Bearer &lt;source token&gt; header. Keep the token in your sender’s secret store. Use HTTPS outside local development.</p>
        <pre className="overflow-x-auto rounded border border-border p-3 text-xs">{JSON.stringify({eventId:'demo-failure-001',occurredAt:new Date().toISOString(),title:'Demo service alert',summary:'Fictional timeout during a health check.'},null,2)}</pre>
        <p>Maximum 32 KiB per request, title 120 characters and summary 19,000 characters. New events must be within the last 7 days. Success means saved. Retry network errors, 429 or 503 with the same event ID and body; honor Retry-After and use bounded exponential backoff. A 409 needs correction; a 410 means the incident was removed.</p>
        <p>Each distinct event creates one incident; repeated alerts with different IDs are not grouped. Local endpoints work only where your development server is reachable.</p>
      </details>
    </>}
    <Button variant="outline" disabled={!ready||busy} onClick={()=>void change({intent:'status'})}>{busy?'Working…':'Check source status'}</Button>
  </section>
}

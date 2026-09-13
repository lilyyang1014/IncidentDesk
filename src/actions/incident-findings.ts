import { z } from 'zod'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { loadSavedFindings } from '../server/incident-findings'
export const incidentFindings: ActionHandler<Env> = async ({params,callerJwt,env}) => {
  const input=z.object({incidentId:z.string().min(1).max(200),analysisVersion:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(params)
  if(!input.success) return {success:false,error:'Invalid findings request.'}
  try {
    const aiRoom=env.INCIDENT_AI_ROOMS.get(env.INCIDENT_AI_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    const response=await aiRoom.fetch(new Request('https://internal/analysis',{method:'POST',headers:{Authorization:`Bearer ${callerJwt}`,'Content-Type':'application/json'},body:JSON.stringify({incidentId:input.data.incidentId,intent:'status'})}))
    const saved=z.object({success:z.literal(true),data:z.object({phase:z.literal('complete'),analysisVersion:z.string(),sourceVersion:z.string(),result:z.object({hypotheses:z.array(z.unknown()).max(20)})})}).parse(await response.json())
    if(!response.ok||saved.data.analysisVersion!==input.data.analysisVersion) throw new Error('Analysis changed')
    return {success:true,data:await loadSavedFindings(env,callerJwt,input.data.incidentId,saved.data)}
  }catch{return {success:false,error:'Could not load current investigation findings. Close and reopen the preview.'}}
}

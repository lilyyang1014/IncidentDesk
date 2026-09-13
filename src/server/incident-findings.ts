import { z } from 'zod'
import type { ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { findingsSnapshotSchema, findingSchema } from '../features/incidents/incident-findings-types'
import { incidentCapabilities } from '../features/incidents/incident-permissions'
import { incidentDigest, sourceIdentity } from './incident-identity'
export const findingsReadRequest = z.object({ incidentId: z.string().min(1).max(200), analysisVersion: z.string().regex(/^[a-f0-9]{64}$/), sourceVersion: z.string().regex(/^[a-f0-9]{64}$/), hypothesisCount: z.number().int().min(0).max(20) }).strict()
type Tool = (userId: string, tool: string, params: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
// Called under the existing RecordRoom gate: all latest judgments are read at
// one serialization point. No calls to the AI room from inside this gate.
export async function readFindingsInRoom(input: z.infer<typeof findingsReadRequest>, userId: string, role: string, tool: Tool, sql: SqlStorage) {
  const found = await tool(userId, 'records.get', {collection:'incidents',recordId:input.incidentId})
  const record = z.object({recordId:z.string(),createdBy:z.string(),createdAt:z.string(),data:z.object({title:z.string(),rawLog:z.string()})}).parse(found.data?.record)
  if (!found.success || !incidentCapabilities(record,userId,role).operate) return Response.json({success:false,error:'Handoff is unavailable to your account.'},{status:403})
  if (await incidentDigest(sourceIdentity(record)) !== input.sourceVersion) return Response.json({success:false,error:'Incident changed. Reopen the handoff.'},{status:409})
  const findings = []
  const names = new Map<string,string>()
  for(let index=0;index<input.hypothesisCount;index++) {
    const row=sql.exec<{id:string}>(`SELECT _row_id AS id FROM c_incident_assessments WHERE col_incidentid=? AND col_incidentcreatedat=? AND col_incidentowner=? AND col_analysisversion=? AND col_hypothesisindex=? AND col_sourceversion=? ORDER BY col_sequence DESC LIMIT 1`,record.recordId,record.createdAt,record.createdBy,input.analysisVersion,index,input.sourceVersion).toArray()[0]
    if(!row) continue
    const result=await tool(userId,'records.get',{collection:'incident_assessments',recordId:row.id})
    if(!result.success) throw new Error('Judgment unavailable')
    const saved=z.object({createdBy:z.string(),createdAt:z.string(),data:findingSchema.pick({explanation:true,status:true,reason:true,sequence:true})}).parse(result.data?.record)
    if(!names.has(saved.createdBy)) {
      const person=await tool(userId,'records.get',{collection:'users',recordId:saved.createdBy})
      const name=z.object({data:z.object({name:z.string().optional()})}).safeParse(person.data?.record)
      // Snapshot the display name; never include the user record or email.
      names.set(saved.createdBy,name.success && name.data.data.name?.trim() ? name.data.data.name.trim().slice(0,200) : saved.createdBy)
    }
    findings.push({...saved.data,hypothesisIndex:index,actorId:saved.createdBy,actorName:names.get(saved.createdBy)!,judgedAt:saved.createdAt})
  }
  return Response.json({success:true,data:findingsSnapshotSchema.parse({analysisVersion:input.analysisVersion,sourceVersion:input.sourceVersion,capturedAt:new Date().toISOString(),findings})})
}
export async function loadSavedFindings(env: Env, callerJwt: string, incidentId: string, ai: {phase:string;analysisVersion?:string;sourceVersion?:string;result?:{hypotheses:unknown[]}}) {
  if(ai.phase!=='complete'||!ai.result) return undefined
  const input=findingsReadRequest.parse({incidentId,analysisVersion:ai.analysisVersion,sourceVersion:ai.sourceVersion,hypothesisCount:ai.result.hypotheses.length})
  const room=env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response=await room.fetch(new Request('https://internal/incident-findings',{method:'POST',headers:{Authorization:`Bearer ${callerJwt}`,'Content-Type':'application/json'},body:JSON.stringify(input)}))
  const body=z.object({success:z.literal(true),data:findingsSnapshotSchema}).parse(await response.json())
  if(!response.ok) throw new Error('Findings unavailable')
  return body.data
}

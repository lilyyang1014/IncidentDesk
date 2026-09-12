import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { IncidentDetails } from '../IncidentDetails'
const state = vi.hoisted(() => ({ userId: 'b', role: 'member', status: 'ready', collaborators: ['b'] as string[] }))
vi.mock('deepspace', () => ({
  useAuthProfileReady: () => ({user:{id:state.userId,role:state.role}}),
  useMutations: () => ({ready:true}),
  useUserLookup: () => ({ users:[{id:'a',name:'Test A'},{id:'b',name:'Test B'}],usersLoaded:true,getName:(id:string)=>id==='a'?'Test A':'Test B',getEmail:()=>null }),
  useQuery: (collection:string) => ({status:state.status, records: collection==='incidents' ? [{recordId:'incident',createdBy:'a',createdAt:'2026-09-12',data:{title:'Test incident',rawLog:'Timeout',status:'Pending analysis',collaborators:state.collaborators}}] : [{recordId:'note',createdBy:'b',createdAt:'2026-09-12',data:{body:'<script>alert(1)</script>',sequence:1}}]}),
}))
const render=()=>renderToStaticMarkup(<MemoryRouter><IncidentDetails incidentId="incident" onBack={()=>{}} /></MemoryRouter>)
beforeEach(()=>{state.userId='b';state.role='member';state.status='ready';state.collaborators=['b']})
it('shows collaboration and saved-result panels but no operator or membership controls to a collaborator',()=>{
  const html=render()
  expect(html).toContain('Investigation notes')
  expect(html).toContain('Test A')
  expect(html).toContain('AI analysis')
  expect(html).toContain('Troubleshooting references')
  for(const label of ['Add collaborator','Remove collaborator','Analyze logs','Search references','Prepare email draft','Preview handoff report']) expect(html).not.toContain(`>${label}<`)
  expect(html).not.toContain('Email handoff')
})
it('escapes note content rather than rendering markup',()=>{
  const html=render();expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>')
})
it('allows creators to manage members and preserves existing operations',()=>{
  state.userId='a'
  const html=render();expect(html).toContain('Remove collaborator');expect(html).toContain('Analyze logs');expect(html).toContain('Email handoff')
  state.collaborators=[];expect(render()).toContain('Add collaborator')
})
it('does not render stale collaboration data while access is loading or fails',()=>{
  for(const status of ['loading','error']) {state.status=status;const html=render();expect(html).not.toContain('Investigation notes');expect(html).not.toContain('Test incident')}
})

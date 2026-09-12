import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { IncidentDetails } from '../IncidentDetails'
import { IncidentNotes } from './IncidentNotes'
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
  expect(html).toContain('Discussion')
  expect(html).toContain('Original logs')
  expect(html).toContain('Test A')
  expect(html).toContain('Analysis')
  expect(html).not.toContain('Loading AI analysis')
  expect(html).not.toContain('>Handoff<')
  for(const label of ['Add collaborator','Remove collaborator','Analyze logs','Search references','Prepare email draft','Preview handoff report']) expect(html).not.toContain(`>${label}<`)
  expect(html).not.toContain('Email handoff')
})
it('escapes note content rather than rendering markup',()=>{
  const html=renderToStaticMarkup(<IncidentNotes record={{recordId:'incident',createdBy:'a',createdAt:'2026-09-12',updatedAt:'2026-09-12',data:{title:'Test',rawLog:'Timeout',status:'Pending analysis'}}} />);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>')
})
it('allows creators to manage members and preserves existing operations',()=>{
  state.userId='a'
  const html=render();expect(html).toContain('Collaborators');expect(html).toContain('Analyze logs');expect(html).toContain('>Handoff<')
  expect(html).not.toContain('Email handoff')
})
it('does not render stale collaboration data while access is loading or fails',()=>{
  for(const status of ['loading','error']) {state.status=status;const html=render();expect(html).not.toContain('Investigation notes');expect(html).not.toContain('Test incident')}
})

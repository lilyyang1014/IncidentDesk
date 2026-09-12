import { useId, useRef, useState, type ReactNode } from 'react'
import type { RecordData } from 'deepspace'
import { ArrowLeft, Users } from 'lucide-react'
import { Badge, Button, Modal } from '@/components/ui'
import type { Incident } from './incident-types'
import { formatDate } from './incident-format'

type Tab = 'overview' | 'analysis' | 'discussion' | 'handoff'

/** Visit panels on demand, then keep them mounted to preserve unsaved drafts. */
export function IncidentDetailView({ record, onBack, creator, analysis, discussion, handoff, collaborators, localAnalysis }: {
  record: RecordData<Incident>
  onBack: () => void
  creator: string
  analysis: ReactNode
  discussion: ReactNode
  handoff?: ReactNode
  collaborators: ReactNode
  localAnalysis: ReactNode
}) {
  const [active, setActive] = useState<Tab>('overview')
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['overview']))
  const [membersOpen, setMembersOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const id = useId()
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'analysis', label: 'Analysis' },
    { id: 'discussion', label: 'Discussion' }, ...(handoff ? [{ id: 'handoff' as const, label: 'Handoff' }] : []),
  ]
  const current = tabs.some(tab => tab.id === active) ? active : 'overview'
  function select(tab: Tab) {
    setActive(tab)
    setVisited(previous => new Set([...previous, tab]))
    anchor.current?.scrollIntoView({ block: 'start' })
  }
  return (
    <div ref={anchor} className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <button type="button" onClick={onBack} className="mb-5 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to incidents
      </button>
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 pt-3 backdrop-blur md:-mx-8 md:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Incident workspace</p>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{record.data.title}</h1>
            <p className="mt-2 break-words text-xs text-muted-foreground">Created by {creator} · {formatDate(record.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="warning">{record.data.status}</Badge>
            <Button variant="outline" onClick={() => setMembersOpen(true)}><Users className="mr-2 h-4 w-4" />Collaborators</Button>
          </div>
        </header>
        <div role="tablist" aria-label="Incident sections" className="flex gap-1 overflow-x-auto">
          {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}-tab`} aria-controls={`${id}-${tab.id}-panel`} aria-selected={current === tab.id} tabIndex={current === tab.id ? 0 : -1}
            onClick={() => select(tab.id)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
              if (next < 0) return
              event.preventDefault(); select(tabs[next].id)
              document.getElementById(`${id}-${tabs[next].id}-tab`)?.focus()
            }} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${current === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {tab.label}
          </button>)}
        </div>
      </div>
      {tabs.map(tab => <div key={tab.id} id={`${id}-${tab.id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab.id}-tab`} hidden={current !== tab.id} tabIndex={0} className="pt-6">
        {visited.has(tab.id) && <div className="flex min-w-0 flex-col gap-5">
          {tab.id === 'overview' && <>
            <section className="min-w-0 rounded-xl border border-border bg-card p-5">
              <h2 className="font-medium text-foreground">Original logs</h2>
              <p className="mt-1 text-sm text-muted-foreground">The saved source for this investigation.</p>
              <pre tabIndex={0} aria-label="Original logs" className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-4 font-mono text-sm leading-6 text-foreground">{record.data.rawLog}</pre>
            </section>
            {localAnalysis}
          </>}
          {tab.id === 'analysis' && analysis}
          {tab.id === 'discussion' && discussion}
          {tab.id === 'handoff' && handoff}
        </div>}
      </div>)}
      <Modal open={membersOpen} onClose={() => setMembersOpen(false)}>
        <Modal.Header><Modal.Title>Incident collaborators</Modal.Title></Modal.Header>
        <Modal.Body>{collaborators}</Modal.Body>
      </Modal>
    </div>
  )
}

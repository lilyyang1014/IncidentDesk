import type { ReactNode } from 'react'
import type { RecordData } from 'deepspace'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui'
import type { Incident } from './incident-types'
import { formatDate } from './incident-format'

/** Presentational shell; the details module supplies analysis content. */
export function IncidentDetailView({
  record,
  onBack,
  creator,
  analysis,
}: {
  record: RecordData<Incident>
  onBack: () => void
  creator: string
  analysis: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-10">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to incidents
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-primary">Incident details</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{record.data.title}</h1>
        </div>
        <Badge variant="warning" size="lg">{record.data.status}</Badge>
      </header>
      {analysis}
      <section className="grid gap-3 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div><p className="text-muted-foreground">Created</p><p className="mt-1 text-foreground">{formatDate(record.createdAt)}</p></div>
        <div><p className="text-muted-foreground">Created by</p><p className="mt-1 break-all text-foreground">{creator}</p></div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-foreground">Original logs</h2>
        <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm leading-6 text-foreground">{record.data.rawLog}</pre>
      </section>
    </div>
  )
}

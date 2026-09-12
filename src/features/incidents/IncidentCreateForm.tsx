import { useId, type FormEvent } from 'react'
import { INCIDENT_TITLE_LIMIT, INCIDENT_LOG_LIMIT, incidentLengthError } from './incident-source-limits'
import { FileText, Plus } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'
import type { SaveState } from './incident-save'

type IncidentCreateFormProps = {
  title: string
  rawLog: string
  saveState: SaveState
  ready: boolean
  listReady: boolean
  onTitleChange: (value: string) => void
  onRawLogChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onLoadExample: () => void
  onReview: () => void
}

/** Controlled form: the page retains drafts and save state across detail navigation. */
export function IncidentCreateForm({
  title, rawLog, saveState, ready, listReady,
  onTitleChange, onRawLogChange, onSubmit, onLoadExample, onReview,
}: IncidentCreateFormProps) {
  const isCreating = saveState.phase === 'saving'
  const id = useId()
  const titleOver = title.length > INCIDENT_TITLE_LIMIT
  const logsOver = rawLog.length > INCIDENT_LOG_LIMIT
  const lengthError = incidentLengthError(title, rawLog)
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary"><Plus className="h-5 w-5" /></div>
          <div>
            <h2 className="font-medium text-foreground">Create an incident</h2>
            <p className="text-sm text-muted-foreground">Capture the facts first; analysis comes next.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onLoadExample} disabled={saveState.phase !== 'idle'}>
          <FileText className="h-4 w-4" />
          Load example incident
        </Button>
      </div>
      <form className="flex flex-col gap-4" onSubmit={event => { if (lengthError) { event.preventDefault(); return } onSubmit(event) }} aria-busy={isCreating}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`${id}-title`} className="font-medium text-foreground">Incident title</label>
            <span id={`${id}-title-count`} className={`text-xs ${titleOver ? 'text-destructive' : 'text-muted-foreground'}`}>{title.length.toLocaleString('en-US')} / 120</span>
          </div>
          <Input id={`${id}-title`} aria-describedby={`${id}-title-count${titleOver ? ` ${id}-title-error` : ''}`} aria-invalid={titleOver} disabled={isCreating} value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="For example: Checkout requests failing" />
          {titleOver && <p id={`${id}-title-error`} role="alert" className="text-sm text-destructive">Incident title exceeds the 120-character limit. Shorten it before saving.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`${id}-logs`} className="font-medium text-foreground">Original logs</label>
            <span id={`${id}-logs-count`} className={`text-xs ${logsOver ? 'text-destructive' : 'text-muted-foreground'}`}>{rawLog.length.toLocaleString('en-US')} / 20,000</span>
          </div>
          <Textarea id={`${id}-logs`} aria-describedby={`${id}-logs-count ${id}-logs-help${logsOver ? ` ${id}-logs-error` : ''}`} aria-invalid={logsOver} disabled={isCreating} value={rawLog} onChange={(event) => onRawLogChange(event.target.value)} placeholder="Paste timestamped log text" rows={7} />
          <p id={`${id}-logs-help`} className="text-xs text-muted-foreground">Pasted text is kept in full. Shorten oversized logs before saving. Some emoji count as two characters.</p>
          {logsOver && <p id={`${id}-logs-error`} role="alert" className="text-sm text-destructive">Original logs exceed the 20,000-character limit. Shorten them before saving.</p>}
        </div>
        {saveState.error && <p role="alert" className="text-sm text-destructive">{saveState.error}</p>}
        {saveState.phase === 'review' && (
          <Button type="button" variant="outline" disabled={!ready || !listReady} onClick={onReview}>
            I checked Saved incidents — allow retry
          </Button>
        )}
        {isCreating && <p role="status" className="text-sm text-muted-foreground">Saving incident… Keep this page open until confirmation.</p>}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">New records start as Pending analysis.</p>
          <Button type="submit" loading={isCreating} disabled={!ready || saveState.phase !== 'idle' || !!lengthError}>
            {isCreating ? 'Saving incident…' : 'Save incident'}
          </Button>
        </div>
      </form>
    </section>
  )
}

import type { FormEvent } from 'react'
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
      <form className="flex flex-col gap-4" onSubmit={onSubmit} aria-busy={isCreating}>
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          Incident title
          <Input disabled={isCreating} value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="For example: Checkout requests failing" maxLength={120} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          Original logs
          <Textarea disabled={isCreating} value={rawLog} onChange={(event) => onRawLogChange(event.target.value)} placeholder="Paste timestamped log text" rows={7} maxLength={20000} />
        </label>
        {saveState.error && <p role="alert" className="text-sm text-destructive">{saveState.error}</p>}
        {saveState.phase === 'review' && (
          <Button type="button" variant="outline" disabled={!ready || !listReady} onClick={onReview}>
            I checked Saved incidents — allow retry
          </Button>
        )}
        {isCreating && <p role="status" className="text-sm text-muted-foreground">Saving incident… Keep this page open until confirmation.</p>}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">New records start as Pending analysis.</p>
          <Button type="submit" loading={isCreating} disabled={!ready || saveState.phase !== 'idle'}>
            {isCreating ? 'Saving incident…' : 'Save incident'}
          </Button>
        </div>
      </form>
    </section>
  )
}

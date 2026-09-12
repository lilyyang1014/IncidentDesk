import { updateIncidentConfirmed } from './incident-write-client'
import { useState } from 'react'
import { useMutations, type RecordData } from 'deepspace'
import { Button } from '@/components/ui'
import type { Incident } from './incident-types'
import { createIncidentAnalysisFlow, INITIAL_ANALYSIS_STATE } from './incident-analysis-flow'

/** Mount with a record/account key so navigation never transfers operation state. */
export function IncidentAnalysisControl({ record }: { record: RecordData<Incident> }) {
  const { ready } = useMutations<Incident>('incidents')
  const [state, setState] = useState(INITIAL_ANALYSIS_STATE)
  const [flow] = useState(() => createIncidentAnalysisFlow(setState))
  if (record.data.status === 'Analysis ready') return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Local rules highlight log text; they do not determine the root cause.</p>
      {['Analyzing', 'Analysis failed'].includes(record.data.status) && (
        <p className="text-sm text-muted-foreground">This record has a status from an earlier analysis attempt. You can run local analysis again.</p>
      )}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.phase === 'complete' && <p role="status">Analysis saved. Waiting for the record to sync…</p>}
      <Button type="button" disabled={!ready || state.phase !== 'idle'} loading={state.phase === 'saving'}
        onClick={() => void flow.submit(record.recordId, record.data, ready, (_id, patch) => updateIncidentConfirmed(record, patch))}>
        {state.phase === 'saving' ? 'Saving analysis…' : 'Analyze logs'}
      </Button>
    </div>
  )
}

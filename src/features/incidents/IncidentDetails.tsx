import { useAuthProfileReady, useQuery, useUserLookup } from 'deepspace'
import { Button } from '@/components/ui'
import type { Incident } from './incident-types'
import { creatorLabel } from './incident-access'
import { IncidentDetailView } from './IncidentDetailView'
import { IncidentAnalysisControl } from './IncidentAnalysisControl'
import { IncidentAnalysisResult } from './IncidentAnalysisResult'
import { IncidentReferences } from './IncidentReferences'
import { IncidentAiAnalysis } from './IncidentAiAnalysis'

/** A separate subscription keeps detail reads independent of list pagination.
 * RecordRoom applies the same RBAC to this ID filter as to the list query. */
export function IncidentDetails({ incidentId, onBack }: { incidentId: string; onBack: () => void }) {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { getEmail, getName } = useUserLookup()
  const { records, status, error } = useQuery<Incident>('incidents', {
    where: { recordId: incidentId },
    limit: 1,
  })
  const selected = records.find((record) => record.recordId === incidentId)

  if (status === 'ready' && selected) {
    return (
      <IncidentDetailView
        record={selected}
        onBack={onBack}
        creator={creatorLabel({
          createdBy: selected.createdBy,
          currentUserId: user?.id,
          currentUserEmail: user?.email,
          role: user?.role ?? 'member',
          lookup: { getEmail, getName },
        })}
        analysis={
          <>
            <IncidentAnalysisControl record={selected} />
            <IncidentAnalysisResult incident={selected.data} />
            <IncidentAiAnalysis key={`${user?.id}:${selected.recordId}:${selected.data.title}:${selected.data.rawLog}`} incidentId={selected.recordId} />
            <IncidentReferences key={`references:${user?.id}:${selected.recordId}:${selected.data.title}:${selected.data.rawLog}`} incidentId={selected.recordId} />
          </>
        }
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-10">
      <Button variant="outline" onClick={onBack}>Back to incidents</Button>
      {status === 'loading' && <p role="status">Loading incident details…</p>}
      {status === 'error' && <ErrorState message={error ?? 'Could not load incident details.'} />}
      {status === 'ready' && !selected && (
        <ErrorState message="This incident could not be found in the records available to your account." />
      )}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{message}</div>
}

import { incidentCapabilities } from './incident-permissions'
import { IncidentCollaborators } from './collaboration/IncidentCollaborators'
import { IncidentNotes } from './collaboration/IncidentNotes'
import { useAuthProfileReady, useQuery, useUserLookup } from 'deepspace'
import { Button } from '@/components/ui'
import type { Incident } from './incident-types'
import { creatorLabel } from './incident-access'
import { IncidentDetailView } from './IncidentDetailView'
import { IncidentAnalysisControl } from './IncidentAnalysisControl'
import { IncidentAnalysisResult } from './IncidentAnalysisResult'
import { IncidentReferences } from './IncidentReferences'
import { IncidentEmail } from './IncidentEmail'
import { GmailConnectionStatus } from './GmailConnectionStatus'
import { IncidentHandoffPreview } from './IncidentHandoffPreview'
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
    const capability = incidentCapabilities(selected, user?.id ?? '', user?.role ?? 'member')
    const collaborationKey = `${user?.id}:${selected.recordId}:${selected.createdAt}`
    return (
      <IncidentDetailView
        key={collaborationKey}
        record={selected}
        onBack={onBack}
        creator={creatorLabel({
          createdBy: selected.createdBy,
          currentUserId: user?.id,
          currentUserEmail: user?.email,
          role: user?.role ?? 'member',
          lookup: { getEmail, getName },
        })}
        localAnalysis={<>
          {capability.operate && <IncidentAnalysisControl record={selected} />}
          <IncidentAnalysisResult incident={selected.data} />
        </>}
        collaborators={<IncidentCollaborators key={`members:${collaborationKey}`} record={selected} canManage={capability.manageMembers} />}
        discussion={<IncidentNotes key={`notes:${collaborationKey}`} record={selected} />}
        analysis={<div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0"><IncidentAiAnalysis readOnly={!capability.operate} key={`${user?.id}:${selected.recordId}:${selected.data.title}:${selected.data.rawLog}`} incidentId={selected.recordId} /></div>
          <div className="min-w-0"><IncidentReferences readOnly={!capability.operate} key={`references:${user?.id}:${selected.recordId}:${selected.data.title}:${selected.data.rawLog}`} incidentId={selected.recordId} /></div>
        </div>}
        handoff={capability.operate ? <>
          <GmailConnectionStatus key={`gmail:${user?.id}`} />
          <IncidentHandoffPreview key={`handoff:${user?.id}:${selected.recordId}:${JSON.stringify(selected.data)}`} record={selected} />
          <IncidentEmail key={`email:${user?.id}:${selected.recordId}:${selected.data.title}:${selected.data.rawLog}`} incidentId={selected.recordId} title={selected.data.title} />
        </> : undefined}
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

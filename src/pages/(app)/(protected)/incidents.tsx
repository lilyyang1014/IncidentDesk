import { createIncidentConfirmed } from '@/features/incidents/incident-write-client'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuthProfileReady, useMutations } from 'deepspace'
import { createIncidentSaveFlow, INITIAL_SAVE_STATE } from '@/features/incidents/incident-save'
import { IncidentCreateForm } from '@/features/incidents/IncidentCreateForm'
import { EXAMPLE_INCIDENTS } from '@/features/incidents/incident-examples'
import { incidentListCopy } from '@/features/incidents/incident-access'
import { IncidentDetails } from '@/features/incidents/IncidentDetails'
import type { Incident } from '@/features/incidents/incident-types'
import { IncidentList, useIncidentList } from '@/features/incidents/IncidentList'
import { incidentIdFromSearch, incidentSearch } from '@/features/incidents/incident-route'

export default function IncidentsPage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const list = useIncidentList()
  const { ready } = useMutations<Incident>('incidents')
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = incidentIdFromSearch(searchParams.toString())
  const [title, setTitle] = useState('')
  const [rawLog, setRawLog] = useState('')
  const [saveState, setSaveState] = useState(INITIAL_SAVE_STATE)
  const [saveFlow] = useState(() => createIncidentSaveFlow(setSaveState))
  const isCreating = saveState.phase === 'saving'
  const lastExampleIndex = useRef<number | null>(null)
  const listCopy = incidentListCopy(user?.role ?? 'member')

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const recordId = await saveFlow.submit({ title, rawLog }, createIncidentConfirmed)
    if (recordId) {
      setTitle('')
      setRawLog('')
      setSearchParams(incidentSearch(recordId))
    }
  }

  function handleLoadExample() {
    if (!saveFlow.canReplaceInput()) return
    let nextIndex = Math.floor(Math.random() * EXAMPLE_INCIDENTS.length)
    while (EXAMPLE_INCIDENTS.length > 1 && nextIndex === lastExampleIndex.current) {
      nextIndex = Math.floor(Math.random() * EXAMPLE_INCIDENTS.length)
    }
    lastExampleIndex.current = nextIndex
    const example = EXAMPLE_INCIDENTS[nextIndex]
    setTitle(example.title)
    setRawLog(example.rawLog)
    saveFlow.clearError()
  }

  if (selectedId) {
    return (
      <IncidentDetails
        key={`${user?.id}:${selectedId}`}
        incidentId={selectedId}
        onBack={() => setSearchParams({}, { replace: true })}
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-primary">IncidentDesk</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{listCopy.heading}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {listCopy.description} Save the incident title and original logs as a verifiable starting point for later analysis and handoff.
            </p>
          </div>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Back to home
          </Link>
        </div>
      </header>

      <IncidentCreateForm
        title={title}
        rawLog={rawLog}
        saveState={saveState}
        ready={ready}
        listReady={list.status === 'ready'}
        onTitleChange={setTitle}
        onRawLogChange={setRawLog}
        onSubmit={handleCreate}
        onLoadExample={handleLoadExample}
        onReview={() => saveFlow.acknowledgeReview()}
      />

      <IncidentList
        result={list}
        description={listCopy.description}
        disabled={isCreating}
        onOpen={(recordId) => setSearchParams(incidentSearch(recordId))}
      />
    </div>
  )
}

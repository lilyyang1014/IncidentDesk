export type Incident = {
  title: string
  rawLog: string
  status: 'Pending analysis' | 'Analyzing' | 'Analysis ready' | 'Analysis failed'
  analysisSummary?: string
  analysisSignals?: string
  analysisEvidence?: string
}

export type SaveState = {
  phase: 'idle' | 'saving' | 'review'
  error: string | null
}

export const INITIAL_SAVE_STATE: SaveState = { phase: 'idle', error: null }

// The installed SDK 0.33.1 uses plain Error messages for these transport
// failures, rather than typed error codes. Neither proves the write failed.
function saveFailure(error: unknown): SaveState {
  if (error instanceof Error && 'code' in error && error.code === 'not_ready') {
    return { phase: 'idle', error: 'Not connected. Your input is unchanged. Reconnect before saving.' }
  }
  if (!(error instanceof Error) || ['Mutation confirmation timed out', 'WebSocket disconnected'].includes(error.message)) {
    return {
      phase: 'review',
      error: 'Save result unknown. Your incident may already be saved. Your input is unchanged. Reconnect and check Saved incidents before retrying; retrying may create a duplicate.',
    }
  }
  return { phase: 'idle', error: 'Could not save the incident. Your input is unchanged. Check your connection and permissions before trying again.' }
}

/** Coordinates one mounted form. The synchronous gate also catches submits
 * that arrive before React renders the disabled button. No automatic retries. */
export function createIncidentSaveFlow(onChange: (state: SaveState) => void) {
  let state = INITIAL_SAVE_STATE
  function update(next: SaveState) {
    state = next
    onChange(next)
  }

  return {
    async submit(
      input: Pick<Incident, 'title' | 'rawLog'>,
      createConfirmed: (incident: Incident) => Promise<string>,
    ): Promise<string | undefined> {
      if (state.phase !== 'idle') return
      const title = input.title.trim()
      const rawLog = input.rawLog.trim()
      if (!title || !rawLog) {
        update({ phase: 'idle', error: 'Enter an incident title and the original logs.' })
        return
      }

      update({ phase: 'saving', error: null })
      try {
        const id = await createConfirmed({ title, rawLog, status: 'Pending analysis' })
        update(INITIAL_SAVE_STATE)
        return id
      } catch (error) {
        update(saveFailure(error))
      }
    },
    acknowledgeReview() {
      if (state.phase === 'review') update(INITIAL_SAVE_STATE)
    },
    clearError() {
      if (state.phase === 'idle') update(INITIAL_SAVE_STATE)
    },
    canReplaceInput() {
      return state.phase === 'idle'
    },
  }
}

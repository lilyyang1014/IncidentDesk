import { analyzeIncidentLogs } from './incident-analysis'
import type { Incident } from './incident-save'

export type AnalysisState = {
  phase: 'idle' | 'saving' | 'review' | 'complete'
  error: string | null
}
export const INITIAL_ANALYSIS_STATE: AnalysisState = { phase: 'idle', error: null }
export type AnalysisLock = (id: string, work: () => Promise<void>) => Promise<boolean>

// Same-origin tabs share this lock. It is not a cross-device job lock.
export const withAnalysisLock: AnalysisLock = async (id, work) => {
  if (!navigator.locks) throw new Error('This browser cannot coordinate analysis. Use a browser with Web Locks on localhost or HTTPS.')
  return navigator.locks.request(`incidentdesk:analysis:${id}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return false
    await work()
    return true
  })
}

export function createIncidentAnalysisFlow(onChange: (state: AnalysisState) => void) {
  let state = INITIAL_ANALYSIS_STATE
  const update = (next: AnalysisState) => { state = next; onChange(next) }
  return {
    async submit(id: string, incident: Incident, ready: boolean,
      putConfirmed: (id: string, patch: Partial<Incident>) => Promise<unknown>,
      lock: AnalysisLock = withAnalysisLock,
    ) {
      if (state.phase !== 'idle' || incident.status === 'Analysis ready') return
      if (!ready) {
        update({ phase: 'idle', error: 'Reconnect before analyzing.' })
        return
      }
      update({ phase: 'saving', error: null })
      let submitted = false
      try {
        const acquired = await lock(id, async () => {
          const result = analyzeIncidentLogs(incident.rawLog)
          submitted = true
          // Persist the result and its final status together. Never write a
          // failure status after a lost acknowledgement of a successful write.
          await putConfirmed(id, {
            status: 'Analysis ready',
            analysisSummary: result.summary,
            analysisSignals: result.signals.join('\n'),
            analysisEvidence: result.evidenceLines.join('\n'),
          })
        })
        update(acquired
          ? { phase: 'complete', error: null }
          : { phase: 'idle', error: 'Analysis is running in another tab. Wait for its result.' })
      } catch (error) {
        const uncertain = submitted && (!(error instanceof Error) || ['Mutation confirmation timed out', 'WebSocket disconnected'].includes(error.message))
        update(uncertain
          ? { phase: 'review', error: 'Save result unknown. The analysis may already be saved. Reconnect and refresh this page to check before retrying.' }
          : { phase: 'idle', error: submitted ? 'Could not save analysis. Check your connection and permissions before retrying.' : error instanceof Error ? error.message : 'Could not analyze these logs.' })
      }
    },
  }
}

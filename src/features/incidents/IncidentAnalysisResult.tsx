import type { Incident } from './incident-types'

/** Displays persisted analysis only; it never computes or saves a result. */
export function IncidentAnalysisResult({ incident }: { incident: Incident }) {
  if (incident.status !== 'Analysis ready') return null
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="font-medium text-foreground">Analysis summary</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{incident.analysisSummary}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground">Detected signals</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{incident.analysisSignals || 'None'}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground">Evidence lines</h3>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm leading-6 text-foreground">{incident.analysisEvidence || 'None'}</pre>
      </div>
    </section>
  )
}

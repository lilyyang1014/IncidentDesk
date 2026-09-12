export type Incident = {
  collaborators?: string[]
  title: string
  rawLog: string
  status: 'Pending analysis' | 'Analyzing' | 'Analysis ready' | 'Analysis failed'
  analysisSummary?: string
  analysisSignals?: string
  analysisEvidence?: string
}

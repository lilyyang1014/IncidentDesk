export type AiAnalysis = {
  summary: string
  evidence: { line: number; quote: string }[]
  hypotheses: { explanation: string; evidenceLines: number[] }[]
  suggestedChecks: string[]
  model: string
  generatedAt: string
}

export type AiAnalysisState = {
  phase: 'idle' | 'running' | 'complete' | 'failed' | 'unknown'
  canGenerate: boolean
  error?: string
  result?: AiAnalysis
}

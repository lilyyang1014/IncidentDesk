import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Search, Sparkles, Mail } from 'lucide-react'

const steps = [
  { title: 'Save logs', description: 'Capture the incident and its original logs.', icon: FileText },
  { title: 'Analyze', description: 'Review evidence and possible causes with OpenAI.', icon: Sparkles },
  { title: 'Find references', description: 'Search troubleshooting sources with Exa.', icon: Search },
  { title: 'Review & email', description: 'Check the report, then confirm sending through Gmail.', icon: Mail },
]

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-12 text-foreground md:px-10 md:py-20">
      <header className="flex max-w-2xl flex-col items-start gap-5">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-primary">IncidentDesk</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Turn incident logs into a reviewed handoff.</h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
          Keep the original evidence, explore possible causes, and share a clear report with the next person taking over.
        </p>
        <Link to="/incidents" className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          View incidents <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </header>

      <section aria-labelledby="workflow-heading" className="flex flex-col gap-5">
        <div>
          <h2 id="workflow-heading" className="text-lg font-semibold">From first report to handoff</h2>
          <p className="mt-2 text-sm text-muted-foreground">You review the findings and decide what to share.</p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ title, description, icon: Icon }, index) => (
            <li key={title} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <Icon aria-hidden="true" size={22} className="text-primary" />
                <span className="text-xs font-medium text-muted-foreground">0{index + 1}</span>
              </div>
              <div>
                <h3 className="font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs leading-relaxed text-muted-foreground">
          AI findings and external sources are suggestions for review. Integration calls use DeepSpace credits; email is sent only after your confirmation.
        </p>
      </section>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { ArrowRight, FileText } from 'lucide-react'

// Keep the public entry outside the app's auth and realtime provider boundary.
export default function Landing() {
  return (
    <main data-testid="static-landing" className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-5xl px-6 py-6 md:px-10">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <FileText aria-hidden="true" size={20} className="text-primary" /> IncidentDesk
        </span>
      </header>
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-6 py-16 md:px-10 md:py-24" aria-labelledby="landing-title">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-primary">A clearer incident handoff</p>
        <h1 id="landing-title" className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          From scattered logs to a shared understanding.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Capture an incident, explore the evidence, and prepare a report the next person can act on. Review every handoff before sending it.
        </p>
        <Link to="/home" className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          Open IncidentDesk <ArrowRight aria-hidden="true" size={18} />
        </Link>
        <p className="text-sm text-muted-foreground">AI analysis with OpenAI · References with Exa · Email with Gmail</p>
      </section>
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-muted-foreground md:px-10">
        Your evidence. Your review. Your handoff.
      </footer>
    </main>
  )
}

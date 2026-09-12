import { useEffect, useState } from 'react'
import { z } from 'zod'
import { investigationAction } from './investigation-client'
import { VIEWER_REFRESH_MS, viewerSchema, type IncidentViewer } from './viewer-types'

export function IncidentViewers({ incidentId, incidentCreatedAt, currentUserId }: { incidentId: string; incidentCreatedAt: string; currentUserId: string }) {
  const [viewers, setViewers] = useState<IncidentViewer[]>([])
  const [state, setState] = useState<'connecting' | 'ready' | 'unavailable'>('connecting')
  useEffect(() => {
    const sessionId = crypto.randomUUID()
    const scope = { incidentId, incidentCreatedAt, sessionId }
    let disposed = false
    let pending = false
    let version = 0
    const controller = new AbortController()
    async function heartbeat() {
      if (disposed || pending || document.visibilityState !== 'visible') return
      const current = ++version
      pending = true
      try {
        const data = z.object({ viewers: z.array(viewerSchema).max(12) }).parse(await investigationAction('incidentViewers', { ...scope, intent: 'heartbeat' }, controller.signal))
        if (!disposed && current === version && document.visibilityState === 'visible') { setViewers(data.viewers); setState('ready') }
      } catch {
        if (!disposed && current === version) { setViewers([]); setState('unavailable') }
      } finally { pending = false }
    }
    function leave() {
      ++version
      void investigationAction('incidentViewers', { ...scope, intent: 'leave' }, undefined, true).catch(() => {})
    }
    function visibility() {
      if (document.visibilityState === 'visible') { setViewers([]); setState('connecting'); void heartbeat() }
      else { leave(); setViewers([]); setState('connecting') }
    }
    void heartbeat()
    const interval = window.setInterval(() => void heartbeat(), VIEWER_REFRESH_MS)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', leave)
    return () => {
      disposed = true; controller.abort(); window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); leave()
    }
  }, [incidentId, incidentCreatedAt, currentUserId])
  return <div aria-label="People viewing this incident" className="flex items-center gap-2" title="Viewing this incident, not an editing lock. Refreshes about every 10 seconds; disconnected viewers expire after 30 seconds.">
    {state === 'ready' && <div className="flex -space-x-2">{viewers.map(viewer => <ViewerAvatar key={viewer.userId} viewer={viewer} self={viewer.userId === currentUserId} />)}</div>}
    <span className="text-xs text-muted-foreground">{state === 'connecting' ? 'Connecting viewers…' : state === 'unavailable' ? 'Viewer status unavailable' : `${viewers.length} viewing`}</span>
  </div>
}

export function ViewerAvatar({ viewer, self }: { viewer: IncidentViewer; self: boolean }) {
  const [failed, setFailed] = useState(false)
  const label = `${viewer.name}${self ? ' (you)' : ''} · Viewing this incident`
  return <span title={label} aria-label={label} role="img" className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-primary/15 text-xs font-semibold text-primary">
    {viewer.image && !failed ? <img src={viewer.image} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : viewer.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}
  </span>
}

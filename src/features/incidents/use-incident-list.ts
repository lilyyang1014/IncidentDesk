import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchIncidentPage } from './incident-list-client'
import type { IncidentListEntry, IncidentListCursor, IncidentListView } from './incident-list-types'

type PageState = { entries: IncidentListEntry[]; cursor: IncidentListCursor | null; status: 'idle' | 'loading' | 'ready' | 'error'; loadingMore: boolean; error: string | null }
const empty = (): PageState => ({ entries: [], cursor: null, status: 'idle', loadingMore: false, error: null })
const initial = (owner: string) => ({ owner, mine: empty(), shared: empty() })

/** Separate cursor chains per category; no background polling or wider scans.
 * Requests are abortable and isolated by account and view. Refresh starts a new
 * chain, so new arrivals cannot push records out between already loaded pages.
 */
export function useIncidentList(userId: string) {
  const [view, setView] = useState<IncidentListView>('mine')
  const [cache, setCache] = useState(() => initial(userId))
  const current = useRef(cache)
  const requests = useRef<Partial<Record<IncidentListView, AbortController>>>({})
  const run = useCallback(async (target: IncidentListView, more = false) => {
    if (!userId) return
    const previous = current.current.owner === userId ? current.current[target] : empty()
    if (more && (!previous.cursor || requests.current[target])) return
    requests.current[target]?.abort()
    const controller = new AbortController()
    requests.current[target] = controller
    const update = (value: PageState) => {
      if (controller.signal.aborted) return
      const base = current.current.owner === userId ? current.current : initial(userId)
      current.current = { ...base, [target]: value }
      setCache(current.current)
    }
    update(more ? { ...previous, loadingMore: true, error: null } : { ...empty(), status: 'loading' })
    try {
      const page = await fetchIncidentPage(target, more ? previous.cursor : null, controller.signal)
      const entries = more ? [...previous.entries, ...page.entries] : page.entries
      update({ entries: [...new Map(entries.map(entry => [entry.recordId, entry])).values()], cursor: page.nextCursor, status: 'ready', loadingMore: false, error: null })
    } catch (error) {
      update({ ...(more ? previous : empty()), status: more ? 'ready' : 'error', loadingMore: false, error: error instanceof Error ? error.message : 'Could not load incidents.' })
    } finally {
      if (requests.current[target] === controller) delete requests.current[target]
    }
  }, [userId])
  useEffect(() => {
    const active = requests.current
    setView('mine')
    return () => { Object.values(active).forEach(controller => controller?.abort()) }
  }, [userId])
  useEffect(() => {
    const request = requests.current[view]
    if (current.current.owner !== userId || current.current[view].status === 'idle' || (current.current[view].status === 'loading' && (!request || request.signal.aborted))) void run(view)
  }, [userId, view, run])
  const result = cache.owner === userId ? cache[view] : empty()
  return { ...result, status: result.status === 'idle' ? 'loading' as const : result.status, view, selectView: setView,
    refresh: () => void run(view), loadMore: () => void run(view, true),
    refreshMine: () => { setView('mine'); void run('mine') },
  }
}

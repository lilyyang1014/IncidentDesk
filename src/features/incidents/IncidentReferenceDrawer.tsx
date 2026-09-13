import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { BookOpen, X } from 'lucide-react'
import { IncidentReferences } from './IncidentReferences'

export type ReferenceDrawerSource = { incidentId: string; readOnly: boolean; sourceKey: string }

/** One mounted search component across closing, tab changes and breakpoints.
 * Wide screens reserve a column; narrow screens use the library's modal focus
 * and dismissal behavior. Neither opening nor closing invokes a search.
 */
export function IncidentReferenceDrawer({ source, active, open, onOpenChange, wide, width, maxWidth, onWidthChange }: {
  source: ReferenceDrawerSource; active: boolean; open: boolean; onOpenChange: (open: boolean) => void
  wide: boolean; width: number; maxWidth: number; onWidthChange: (width: number) => void
}) {
  const [count, setCount] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const scrollPosition = useRef(0)
  const visible = active && open
  const resize = (next: number) => onWidthChange(Math.round(Math.min(maxWidth, Math.max(320, next))))
  useEffect(() => {
    if (visible && scroll.current) scroll.current.scrollTop = scrollPosition.current
  }, [visible])
  return <Dialog.Root open={visible} modal={!wide} disablePointerDismissal={wide} onOpenChange={onOpenChange}>
    <Dialog.Trigger style={{ display: active ? undefined : 'none' }} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <BookOpen className="h-4 w-4" aria-hidden />References{count !== null && <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">{count}</span>}
    </Dialog.Trigger>
    <Dialog.Portal keepMounted>
      {visible && !wide && <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />}
      <Dialog.Popup initialFocus={closeButton} finalFocus={active} aria-describedby={undefined}
        style={{ display: visible ? undefined : 'none', width: wide ? width : undefined, top: wide ? 48 : undefined }}
        className="fixed inset-y-0 right-0 z-40 flex w-[min(24rem,100vw)] flex-col border-l border-border bg-card text-foreground shadow-xl outline-none">
        {wide && <div role="separator" aria-label="Resize references" aria-orientation="vertical" tabIndex={0}
          aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width} pixels wide`}
          title="Drag to resize. Use Left and Right arrow keys to adjust."
          className="group absolute inset-y-0 -left-1.5 z-10 w-3 touch-none cursor-col-resize select-none outline-none"
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { pointerId: event.pointerId, x: event.clientX, width }
          }}
          onPointerMove={event => {
            const start = drag.current
            if (start?.pointerId === event.pointerId) resize(start.width + start.x - event.clientX)
          }}
          onPointerUp={event => {
            if (drag.current?.pointerId !== event.pointerId) return
            drag.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={event => {
            const next = event.key === 'ArrowLeft' ? width + 32 : event.key === 'ArrowRight' ? width - 32 : event.key === 'Home' ? 320 : event.key === 'End' ? maxWidth : null
            if (next === null) return
            event.preventDefault()
            resize(next)
          }}>
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-border group-hover:bg-primary group-focus-visible:bg-primary" />
          <span aria-hidden className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 rounded-full bg-muted-foreground group-hover:bg-primary group-focus-visible:bg-primary" />
        </div>}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <Dialog.Title className="font-semibold">References</Dialog.Title>
          <Dialog.Close ref={closeButton} aria-label="Close references" className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden /></Dialog.Close>
        </div>
        <div ref={scroll} onScroll={() => { if (visible && scroll.current) scrollPosition.current = scroll.current.scrollTop }} tabIndex={0} aria-label="Reference panel content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <IncidentReferences incidentId={source.incidentId} readOnly={source.readOnly} onResultCount={setCount} />
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}

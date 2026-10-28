import { useEffect, useRef } from 'react'
import { operationId } from '../../lib/id'

// A same-URL entry makes browser Back dismiss the top sheet before leaving its page.
// Router state (including idx/key) stays intact. Internal cleanup POPs never reach the router.
const marker = '__wardrobeSheet'
type Entry = { id: string; close: () => void; attached: boolean }
const stack: Entry[] = []
let installed = false
let cleanupPops = 0
let replacement: { state: unknown; url: string } | null = null
function attachPending() {
  if (cleanupPops) return
  for (const entry of stack) {
    if (entry.attached) continue
    history.pushState({ ...history.state, [marker]: entry.id }, '', location.href)
    entry.attached = true
  }
}
function handlePop(event: PopStateEvent) {
  if (cleanupPops) {
    cleanupPops--
    event.stopImmediatePropagation()
    if (replacement) {
      history.replaceState(replacement.state, '', replacement.url)
      replacement = null
    }
    if (history.state?.[marker] && !stack.some((entry) => entry.id === history.state[marker])) {
      cleanupPops++
      history.back()
    }
    attachPending()
    return
  }
  const top = stack.at(-1)
  if (!top) return
  event.stopImmediatePropagation()
  // Restore the entry first: a dirty/busy sheet may reject closing or open a confirmation.
  history.pushState({ ...history.state, [marker]: top.id }, '', location.href)
  top.close()
}
// Install before createBrowserRouter registers its POP listener. A blocked delta=0
// navigation otherwise reaches history.go(0), which reloads and loses local files.
export function installSheetHistory() {
  if (!installed) {
    window.addEventListener('popstate', handlePop, true)
    installed = true
  }
}
export function useSheetHistory(open: boolean, close: () => void) {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!open || typeof history.state?.idx !== 'number') return
    installSheetHistory()
    const idx = history.state.idx
    const entry = { id: operationId(), close: () => latest.current(), attached: false }
    stack.push(entry)
    attachPending()
    return () => {
      const index = stack.indexOf(entry)
      if (index >= 0) stack.splice(index, 1)
      if (!entry.attached) return
      if (history.state?.[marker] === entry.id) {
        cleanupPops++
        history.back()
      } else if (history.state?.idx === idx && !history.state?.[marker]) {
        // A route-backed sheet may remove its query via replace before unmounting.
        replacement = { state: history.state, url: location.href }
        cleanupPops++
        history.back()
      }
    }
  }, [open])
}

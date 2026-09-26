// Ref-counted scroll lock for modals.
//
// The app shell scrolls <main>, not <body>, so the lock targets whichever
// element actually scrolls. The scrollbar width moves into padding-right so
// the page does not shift when the bar disappears. Only the first lock
// applies the styles and only the last release restores them, so closing a
// stacked modal leaves the page locked for the one beneath it.

type LockTarget = {
  offsetWidth: number
  clientWidth: number
  style: { overflow: string; paddingRight: string }
}

let count = 0
let locked: { el: LockTarget; overflow: string; paddingRight: string } | null = null

export function lockScroll(el: LockTarget | null): () => void {
  count += 1
  if (count === 1 && el) {
    const gutter = el.offsetWidth - el.clientWidth
    locked = { el, overflow: el.style.overflow, paddingRight: el.style.paddingRight }
    el.style.overflow = "hidden"
    if (gutter > 0) el.style.paddingRight = `${gutter}px`
  }
  let released = false
  return () => {
    if (released) return
    released = true
    count -= 1
    if (count === 0 && locked) {
      locked.el.style.overflow = locked.overflow
      locked.el.style.paddingRight = locked.paddingRight
      locked = null
    }
  }
}

// Test-only lock observation.
export function scrollLockCount(): number {
  return count
}

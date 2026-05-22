export type ToastVariant = "success" | "error" | "info"

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

type Listener = (items: ToastItem[]) => void

const DURATION_MS = 4500
const MAX_VISIBLE = 4

let items: ToastItem[] = []
let listeners: Listener[] = []
let counter = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

// Notify subscribed viewports.
function emit() {
  const snapshot = items.slice()
  for (const fn of listeners) fn(snapshot)
}

// Push toast, cap queue.
function push(message: string, variant: ToastVariant) {
  counter += 1
  const id = counter
  items = [...items, { id, message, variant }].slice(-MAX_VISIBLE)
  const handle = setTimeout(() => dismiss(id), DURATION_MS)
  timers.set(id, handle)
  emit()
  return id
}

// Remove one toast.
export function dismiss(id: number) {
  const handle = timers.get(id)
  if (handle) {
    clearTimeout(handle)
    timers.delete(id)
  }
  items = items.filter((t) => t.id !== id)
  emit()
}

// Subscribe to changes.
export function subscribe(fn: Listener): () => void {
  listeners.push(fn)
  fn(items.slice())
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

export const toast = {
  success: (message: string) => push(message, "success"),
  error: (message: string) => push(message, "error"),
  info: (message: string) => push(message, "info"),
  dismiss,
}

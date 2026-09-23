import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { ui } from "@/lib/ui"
import { isTopModal, popModal, pushModal } from "./modalStack"
import { lockScroll } from "./scrollLock"

type ModalProps = {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  // Width override (default matches the legacy ca-modal 672px).
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Visible, tabbable descendants in order.
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  )
}

// Shared modal shell — faithful port of the legacy ca-overlay/ca-modal/ca-header/
// ca-body/ca-footer system. Body content uses ui.modalSection / ui.field etc.
export default function Modal({ title, onClose, children, footer, className = "" }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Opener captured before children autofocus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement))

  // Latest onClose without re-registering.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Stack, focus, trap, scroll lock.
  useEffect(() => {
    const token = pushModal()
    const release = lockScroll(document.querySelector("main"))
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return
      if (e.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab" || !panel) return
      const items = focusables(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)
      if (e.shiftKey && (!inside || active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      popModal(token)
      release()
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [opener])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`flex max-h-[92vh] w-[672px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-white shadow-lg outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-4 px-10 pb-4 pt-8 max-sm:px-6">
          <h2 id={titleId} className="text-2xl font-bold leading-8 tracking-tight text-dark-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm text-dark-600 transition hover:bg-dark-100 ${ui.focusRing}`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-8 overflow-y-auto px-10 pb-4 max-sm:px-6">{children}</div>
        {footer && (
          <div className="mt-auto flex flex-shrink-0 flex-wrap items-center justify-end gap-4 border-t border-[rgba(203,213,225,0.15)] bg-dark-100 px-10 py-8 max-sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

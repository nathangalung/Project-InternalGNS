import type { ReactNode } from "react"

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  // Width override (default matches the legacy ca-modal 672px).
  className?: string
}

// Shared modal shell — faithful port of the legacy ca-overlay/ca-modal/ca-header/
// ca-body/ca-footer system. Body content uses ui.modalSection / ui.field etc.
export default function Modal({ title, onClose, children, footer, className = "" }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[92vh] w-[672px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-white shadow-lg ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex flex-shrink-0 items-center justify-between px-10 pb-4 pt-8">
          <h2 className="text-2xl font-bold leading-8 tracking-tight text-dark-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-dark-600 transition hover:bg-dark-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-8 overflow-y-auto px-10 pb-4">{children}</div>
        {footer && (
          <div className="mt-auto flex flex-shrink-0 items-center justify-end gap-4 border-t border-[rgba(203,213,225,0.15)] bg-dark-100 px-10 py-8">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

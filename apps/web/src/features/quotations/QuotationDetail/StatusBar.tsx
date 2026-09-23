import { useEffect, useRef, useState } from "react"
import type { Status } from "@/features/quotations/types"
import { ui } from "@/lib/ui"
import type { QuotationTransition } from "@/types/api"
import { quotationBadge } from "../status"

type StatusBarProps = {
  status: Status
  hint: string
  // Menu moves, cancel excluded
  moves: QuotationTransition[]
  cancel?: QuotationTransition
  canRevise: boolean
  onPick: (t: QuotationTransition) => void
  onRevise: () => void
}

// Outline shape, red tone.
const cancelBtn = `inline-flex items-center justify-center gap-2 rounded-md border border-[#B91C1C]/30 bg-white px-6 py-2 text-sm font-bold text-[#B91C1C] transition hover:bg-[#FEF2F2] ${ui.focusRing}`

// Status menu and actions.
//
// The menu lists only the moves the server allows for the saved status, so
// the badge never shows an unsaved choice. Picking a move opens a confirm
// dialog; nothing changes until it is submitted.
export default function StatusBar({
  status,
  hint,
  moves,
  cancel,
  canRevise,
  onPick,
  onRevise,
}: StatusBarProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const badge = quotationBadge[status]
  const hasMoves = moves.length > 0

  // Close on outside click, Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className={ui.statusBar}>
      <div>
        <div className="text-sm font-bold text-dark-900">Status Quotation</div>
        <div className="mt-0.5 text-caption font-normal text-[#4A4455]">{hint}</div>
      </div>
      <div className="flex items-center gap-3">
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            className={`${ui.statusTrigger} border border-transparent${hasMoves ? "" : " cursor-default"}`}
            style={{ background: badge.bg, color: badge.color }}
            onClick={hasMoves ? () => setOpen((o) => !o) : undefined}
            disabled={!hasMoves}
            aria-haspopup={hasMoves ? "menu" : undefined}
            aria-expanded={hasMoves ? open : undefined}
            aria-label={hasMoves ? `Status ${status}, ubah status` : `Status ${status}`}
          >
            {status}
            {hasMoves && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
          {open && (
            <div className={`${ui.statusDropdown} z-[100]`} role="menu">
              <div className="px-5 pb-1 text-overline font-bold uppercase tracking-[0.06em] text-dark-500">
                Ubah ke
              </div>
              {moves.map((t) => (
                <button
                  key={t.to}
                  type="button"
                  role="menuitem"
                  className={ui.statusOption}
                  onClick={() => {
                    setOpen(false)
                    onPick(t)
                  }}
                >
                  <span className="text-caption font-normal text-[#4A4455]">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {canRevise && (
          <button type="button" className={ui.btnOutline} onClick={onRevise}>
            Buat Revisi
          </button>
        )}
        {cancel && (
          <button type="button" className={cancelBtn} onClick={() => onPick(cancel)}>
            Batalkan
          </button>
        )}
      </div>
    </div>
  )
}

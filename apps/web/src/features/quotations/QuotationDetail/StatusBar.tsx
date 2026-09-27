import { useRef } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
// dialog; nothing changes until it is submitted. The dialog opens only
// once the menu has closed and handed focus back to the badge, so the
// dialog returns focus there too.
export default function StatusBar({
  status,
  hint,
  moves,
  cancel,
  canRevise,
  onPick,
  onRevise,
}: StatusBarProps) {
  const badge = quotationBadge[status]
  const hasMoves = moves.length > 0
  const picked = useRef<QuotationTransition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Refocus badge, then open dialog.
  const onOpenChangeComplete = (open: boolean) => {
    const t = picked.current
    if (open || !t) return
    picked.current = null
    triggerRef.current?.focus()
    onPick(t)
  }

  return (
    <div className={ui.statusBar}>
      <div>
        <div className="text-sm font-bold text-dark-900">Status Quotation</div>
        <div className="mt-0.5 text-caption font-normal text-[#4A4455]">{hint}</div>
      </div>
      <div className="flex items-center gap-3">
        <DropdownMenu onOpenChangeComplete={onOpenChangeComplete}>
          <DropdownMenuTrigger
            ref={triggerRef}
            className={`${ui.statusTrigger} border border-transparent${hasMoves ? "" : " cursor-default"}`}
            style={{ background: badge.bg, color: badge.color }}
            disabled={!hasMoves}
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
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Ubah ke</DropdownMenuLabel>
              {moves.map((t) => (
                <DropdownMenuItem
                  key={t.to}
                  onClick={() => {
                    picked.current = t
                  }}
                >
                  <span className="text-caption font-normal text-[#4A4455]">{t.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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

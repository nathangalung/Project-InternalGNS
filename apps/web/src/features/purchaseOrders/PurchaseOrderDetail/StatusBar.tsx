import { ui } from "@/lib/ui"
import type { PoTransition } from "@/types/api"
import type { PoStatus } from "../types"
import { PO_LABEL, PO_STATUS_CONFIG } from "./helpers"

type StatusBarProps = {
  // Saved status
  status: PoStatus
  // Pending choice, null keeps the saved one
  selected: PoTransition | null
  transitions: PoTransition[]
  isOpen: boolean
  saving: boolean
  onToggle: () => void
  onSelect: (t: PoTransition | null) => void
  onSave: () => void
}

function Check() {
  return (
    <svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden="true">
      <path
        d="M1 5.5L4.5 9L13 1"
        stroke="#630ED4"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function optionLabel(active: boolean): string {
  return active
    ? "text-caption font-semibold text-primary-700"
    : "text-caption font-normal text-[#4A4455]"
}

// Status control from server transitions.
//
// The options are exactly what the server allows from the saved status, so
// a move it would refuse is never offered. PENDING and UPLOADED follow the
// PO file and never appear here.
export default function StatusBar({
  status,
  selected,
  transitions,
  isOpen,
  saving,
  onToggle,
  onSelect,
  onSave,
}: StatusBarProps) {
  const shown = selected?.to ?? status
  const badge = PO_STATUS_CONFIG[shown]
  // Terminal status, no transitions.
  const locked = transitions.length === 0
  return (
    <div className={ui.statusBar}>
      <div>
        <div className="text-sm font-bold text-dark-900">Status Purchase Order</div>
        <div className="mt-0.5 text-caption text-[#4A4455]">
          {locked
            ? "Status ini sudah final dan tidak dapat diubah."
            : "Ubah status PO sesuai dengan kondisi aktual."}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            className={`${ui.statusTrigger} whitespace-nowrap${locked ? " cursor-default" : ""}`}
            style={{ background: badge.bg, color: badge.color }}
            onClick={locked ? undefined : onToggle}
            disabled={locked}
            aria-haspopup="true"
            aria-expanded={isOpen && !locked}
          >
            {selected?.label ?? PO_LABEL[status]}
            {!locked && (
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
          {isOpen && !locked && (
            <div className={`${ui.statusDropdown} z-[100]`}>
              <button type="button" className={ui.statusOption} onClick={() => onSelect(null)}>
                <span className={optionLabel(selected === null)}>{PO_LABEL[status]}</span>
                {selected === null && <Check />}
              </button>
              {transitions.map((t) => {
                const isActive = selected?.to === t.to
                return (
                  <button
                    key={t.to}
                    type="button"
                    className={ui.statusOption}
                    onClick={() => onSelect(t)}
                  >
                    <span className={optionLabel(isActive)}>{t.label}</span>
                    {isActive && <Check />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button type="button" className={ui.btnPrimary} onClick={onSave} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Data"}
        </button>
      </div>
    </div>
  )
}

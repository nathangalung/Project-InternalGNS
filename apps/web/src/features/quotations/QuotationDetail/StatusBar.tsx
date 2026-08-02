import type { Status } from "@/features/quotations/types"
import { ui } from "@/lib/ui"
import { statusConfig } from "./helpers"

interface StatusBarProps {
  status: Status
  allowedStatuses: Status[]
  isOpen: boolean
  onToggle: () => void
  onChange: (s: Status) => void
  onSave: () => void
}

// Status switcher and save action.
export default function StatusBar({
  status,
  allowedStatuses,
  isOpen,
  onToggle,
  onChange,
  onSave,
}: StatusBarProps) {
  const badge = statusConfig[status]
  // Terminal status, no transitions.
  const locked = allowedStatuses.length === 0
  return (
    <div className={ui.statusBar}>
      <div>
        <div className="text-sm font-bold text-dark-900">Status Quotation</div>
        <div className="mt-0.5 text-caption font-normal text-[#4A4455]">
          Ubah status quotation sesuai dengan kondisi aktual.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            className={`${ui.statusTrigger}${locked ? " cursor-default" : ""}`}
            style={{ background: badge.bg, color: badge.color }}
            onClick={locked ? undefined : onToggle}
            disabled={locked}
          >
            {status}
            {!locked && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
          {isOpen && !locked && (
            <div className={`${ui.statusDropdown} z-[100]`}>
              {allowedStatuses.map((s) => {
                const isActive = s === status
                return (
                  <button
                    key={s}
                    type="button"
                    className={ui.statusOption}
                    onClick={() => onChange(s)}
                  >
                    <span
                      className={
                        isActive
                          ? "text-caption font-semibold text-primary-700"
                          : "text-caption font-normal text-[#4A4455]"
                      }
                    >
                      {s}
                    </span>
                    {isActive && (
                      <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                        <path
                          d="M1 5.5L4.5 9L13 1"
                          stroke="#630ED4"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button type="button" className={ui.btnPrimary} onClick={onSave}>
          Simpan Data
        </button>
      </div>
    </div>
  )
}

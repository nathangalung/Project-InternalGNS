import { ui } from "@/lib/ui"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "../types"
import { EDITABLE_STATUS_ORDER, type EditableInvoiceStatus } from "./helpers"

interface StatusBarProps {
  status: EditableInvoiceStatus
  isOpen: boolean
  onToggle: () => void
  onChange: (s: EditableInvoiceStatus) => void
  onSave: () => void
}

export default function StatusBar({ status, isOpen, onToggle, onChange, onSave }: StatusBarProps) {
  const badge = INVOICE_STATUS_STYLE[status]
  // Paid is terminal: show the badge but offer no manual transitions.
  const locked = !EDITABLE_STATUS_ORDER.includes(status)
  return (
    <div className={ui.statusBar}>
      <div>
        <div className="text-sm font-bold text-dark-900">Status Invoice</div>
        <div className="mt-0.5 text-caption text-[#4A4455]">
          Ubah status invoice sesuai dengan kondisi aktual.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            className={`${ui.statusTrigger} whitespace-nowrap`}
            style={{
              background: badge.bg,
              color: badge.color,
              cursor: locked ? "default" : undefined,
            }}
            onClick={locked ? undefined : onToggle}
            disabled={locked}
          >
            {INVOICE_LABEL[status]}
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
              {EDITABLE_STATUS_ORDER.map((s) => {
                const isActive = s === status
                return (
                  <button key={s} className={ui.statusOption} onClick={() => onChange(s)}>
                    <span
                      className={
                        isActive
                          ? "text-caption font-semibold text-primary-700"
                          : "text-caption font-normal text-[#4A4455]"
                      }
                    >
                      {INVOICE_LABEL[s]}
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

import { useState } from "react"
import { chipStyle, type StatusFilterValue } from "@/components/shared/filter-styles"
import type { Role } from "@/types/api"

export type RoleFilter = "all" | Role
export type StatusFilter = StatusFilterValue

interface UserFilterProps {
  onClose: () => void
  onApply: (filters: { role: RoleFilter; status: StatusFilter }) => void
  initialValues?: { role: RoleFilter; status: StatusFilter }
}

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "superadmin", label: "Superadmin" },
  { value: "operational", label: "Operasional" },
  { value: "finance", label: "Finance" },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
]

export default function UserFilter({ onClose, onApply, initialValues }: UserFilterProps) {
  const [role, setRole] = useState<RoleFilter>(initialValues?.role ?? "all")
  const [status, setStatus] = useState<StatusFilter>(initialValues?.status ?? "all")

  const dirty = role !== "all" || status !== "all"

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Pengguna</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
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

        <div className="ca-body">
          <div className="ca-section">
            <div className="ca-section-heading">Peran</div>
            <div className="ca-field">
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setRole(o.value)}
                    style={chipStyle(role === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Status</div>
            <div className="ca-field">
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setStatus(o.value)}
                    style={chipStyle(status === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="ca-footer justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => {
              setRole("all")
              setStatus("all")
            }}
            disabled={!dirty}
            className={`p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty
                ? "cursor-pointer text-[#630ED4] underline"
                : "cursor-default text-dark-300 no-underline"
            }`}
          >
            Hapus Filter
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="ca-btn-cancel px-[18px] py-2 text-[13px]"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="button"
              className="ca-btn-submit px-[22px] py-2 text-[13px]"
              onClick={() => {
                onApply({ role, status })
                onClose()
              }}
            >
              Terapkan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

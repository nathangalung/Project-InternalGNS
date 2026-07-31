import { useState } from "react"
import { chipStyle, type StatusFilterValue } from "@/components/shared/filter-styles"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
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
    <Modal
      title="Filter Pengguna"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              setRole("all")
              setStatus("all")
            }}
            disabled={!dirty}
            className={`mr-auto p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty
                ? "cursor-pointer text-[#630ED4] underline"
                : "cursor-default text-dark-300 no-underline"
            }`}
          >
            Hapus Filter
          </button>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={() => {
              onApply({ role, status })
              onClose()
            }}
          >
            Terapkan
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Peran</div>
        <div className={ui.field}>
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

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Status</div>
        <div className={ui.field}>
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
    </Modal>
  )
}

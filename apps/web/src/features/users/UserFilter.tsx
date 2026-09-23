import { useId, useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import type { StatusFilterValue } from "@/lib/filter-options"
import { chip, ui } from "@/lib/ui"
import type { Role } from "@/types/api"

export type RoleFilter = "all" | Role
export type StatusFilter = StatusFilterValue

type UserFilterProps = {
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

  const roleHeadingId = useId()
  const statusHeadingId = useId()

  const dirty = role !== "all" || status !== "all"

  return (
    <Modal
      title="Filter Pengguna"
      onClose={onClose}
      footer={
        <FilterFooter
          canReset={dirty}
          onReset={() => {
            setRole("all")
            setStatus("all")
          }}
          onCancel={onClose}
          onApply={() => {
            onApply({ role, status })
            onClose()
          }}
        />
      }
    >
      <div className={ui.modalSection}>
        <div id={roleHeadingId} className={ui.modalSectionHeading}>
          Peran
        </div>
        <div className={ui.field}>
          <fieldset
            aria-labelledby={roleHeadingId}
            className="m-0 min-w-0 border-0 p-0 flex flex-wrap gap-2"
          >
            {ROLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRole(o.value)}
                aria-pressed={role === o.value}
                className={chip(role === o.value)}
              >
                {o.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      <div className={ui.modalSection}>
        <div id={statusHeadingId} className={ui.modalSectionHeading}>
          Status
        </div>
        <div className={ui.field}>
          <fieldset
            aria-labelledby={statusHeadingId}
            className="m-0 min-w-0 border-0 p-0 flex flex-wrap gap-2"
          >
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setStatus(o.value)}
                aria-pressed={status === o.value}
                className={chip(status === o.value)}
              >
                {o.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>
    </Modal>
  )
}

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
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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

        <div
          className="ca-footer"
          style={{ justifyContent: "space-between", padding: "16px 24px" }}
        >
          <button
            type="button"
            onClick={() => {
              setRole("all")
              setStatus("all")
            }}
            disabled={!dirty}
            style={{
              background: "transparent",
              border: "none",
              cursor: dirty ? "pointer" : "default",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              fontSize: "13px",
              color: dirty ? "#630ED4" : "#CBD5E1",
              padding: 0,
              textDecoration: dirty ? "underline" : "none",
              textUnderlineOffset: "3px",
            }}
          >
            Hapus Filter
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="ca-btn-cancel"
              onClick={onClose}
              style={{ padding: "8px 18px", fontSize: "13px" }}
            >
              Batal
            </button>
            <button
              type="button"
              className="ca-btn-submit"
              onClick={() => {
                onApply({ role, status })
                onClose()
              }}
              style={{ padding: "8px 22px", fontSize: "13px" }}
            >
              Terapkan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

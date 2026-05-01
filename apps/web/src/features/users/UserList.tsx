import { useMemo, useState } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import type { Role, UserRow } from "@/types/api"
import { SortIcon } from "@/features/quotations/QuotationList/helpers"
import Pagination from "@/components/shared/Pagination"
import UserFilter, { type RoleFilter, type StatusFilter } from "./UserFilter"
import UserAddModal from "./UserAddModal"

interface UserListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
  rows?: UserRow[]
  isLoading?: boolean
}

type SortKey = "name" | "createdAt"

const ROLE_BADGE: Record<Role, { label: string; bg: string; color: string }> = {
  superadmin:  { label: "SUPERADMIN",  bg: "#EDE9FE", color: "#5B21B6" },
  operational: { label: "OPERASIONAL", bg: "#FFE16D", color: "#DA6900" },
  finance:     { label: "FINANCE",     bg: "#DBEAFE", color: "#1D4ED8" },
}

const STATUS_AKTIF    = { label: "AKTIF",    bg: "#D1FAE5", color: "#047857" }
const STATUS_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

function formatDateID(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`
}

export default function UserList({ onNavigate, onLogout, onViewDetail, rows, isLoading }: UserListProps) {
  const data: UserRow[] = rows ?? []

  const [search, setSearch] = useState("")
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [showFilter, setShowFilter] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const processed = useMemo(() => {
    let items = [...data]
    if (search) {
      const needle = search.toLowerCase()
      items = items.filter(u =>
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.role.toLowerCase().includes(needle) ||
        (u.isActive ? "aktif" : "nonaktif").includes(needle),
      )
    }
    if (roleFilter !== "all") {
      items = items.filter(u => u.role === roleFilter)
    }
    if (statusFilter !== "all") {
      items = items.filter(u => (statusFilter === "active" ? u.isActive : !u.isActive))
    }
    items.sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortKey === "createdAt") {
        av = new Date(a.createdAt).getTime()
        bv = new Date(b.createdAt).getTime()
      } else {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return items
  }, [data, search, sortKey, sortDir, roleFilter, statusFilter])

  const totalItems = processed.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentRows = processed.slice(startIndex, startIndex + itemsPerPage)

  return (
    <div className="admin-shell">
      <Sidebar activePage={"users" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Manajemen Pengguna</h1>
            <div className="page-actions">
              <button className="btn-admin-primary" style={{ width: "200px", justifyContent: "center" }} onClick={() => setShowAdd(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Pengguna
              </button>
            </div>
          </div>

          <div className="search-row">
            <div className="search-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="search-input"
                placeholder="Cari nama, peran, status admin..."
                value={search}
                onChange={e => {
                  setSearch(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
            <button className="btn-admin-filter" onClick={() => setShowFilter(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="10" y1="18" x2="14" y2="18" />
              </svg>
              Filter
            </button>
          </div>

          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th
                    className="tbl-th tbl-th--center"
                    style={{ width: 200, cursor: "pointer" }}
                    onClick={() => toggleSort("name")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Nama Admin</span>
                      <SortIcon direction={sortKey === "name" ? sortDir : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 220 }}>Email</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Peran</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Status</th>
                  <th
                    className="tbl-th tbl-th--center"
                    style={{ width: 160, cursor: "pointer" }}
                    onClick={() => toggleSort("createdAt")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Tanggal Pembuatan</span>
                      <SortIcon direction={sortKey === "createdAt" ? sortDir : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Memuat data…</td></tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr><td colSpan={6} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Tidak ada pengguna.</td></tr>
                )}
                {!isLoading && currentRows.map(u => {
                  const role = ROLE_BADGE[u.role]
                  const status = u.isActive ? STATUS_AKTIF : STATUS_NONAKTIF
                  return (
                    <tr key={u.id} className="tbl-row">
                      <td className="tbl-td tbl-td--client tbl-td--center">{u.name}</td>
                      <td className="tbl-td tbl-td--center">{u.email}</td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: role.bg, color: role.color, minWidth: 108 }}>
                          {role.label}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: status.bg, color: status.color, minWidth: 108 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center">{formatDateID(u.createdAt)}</td>
                      <td className="tbl-td tbl-td--center">
                        <button
                          className="action-btn"
                          title="Lihat detail"
                          style={{ color: "#7C3AED" }}
                          onClick={() => onViewDetail?.(u.id)}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <Pagination
              totalItems={totalItems}
              startIndex={startIndex}
              itemsPerPage={itemsPerPage}
              currentPage={currentPage}
              totalPages={totalPages}
              resourceLabel="Admin"
              onItemsPerPage={n => { setItemsPerPage(n); setCurrentPage(1) }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {showFilter && (
        <UserFilter
          onClose={() => setShowFilter(false)}
          initialValues={{ role: roleFilter, status: statusFilter }}
          onApply={({ role, status }) => {
            setRoleFilter(role)
            setStatusFilter(status)
            setCurrentPage(1)
          }}
        />
      )}

      <UserAddModal open={showAdd} onOpenChange={setShowAdd} />
    </div>
  )
}

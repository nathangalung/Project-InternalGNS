import { useMemo, useState } from "react"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import SortIcon from "@/components/shared/SortIcon"
import StatusBadge from "@/components/shared/StatusBadge"
import { useUsers } from "@/features/users/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import type { Page } from "@/lib/page"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import type { Role } from "@/types/api"
import UserAddModal from "./UserAddModal"
import UserFilter, { type RoleFilter, type StatusFilter } from "./UserFilter"

interface UserListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

type SortKey = "name" | "createdAt"

const ROLE_BADGE: Record<Role, { label: string; bg: string; color: string }> = {
  superadmin: { label: "SUPERADMIN", bg: "#EDE9FE", color: "#5B21B6" },
  operational: { label: "OPERASIONAL", bg: "#FFE16D", color: "#DA6900" },
  finance: { label: "FINANCE", bg: "#DBEAFE", color: "#1D4ED8" },
}

const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
]

function formatDateID(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`
}

export default function UserList({ onNavigate, onLogout, onViewDetail }: UserListProps) {
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
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
    setCurrentPage(1)
  }

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      role: roleFilter === "all" ? undefined : (roleFilter as Role),
      isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      sortBy: sortKey,
      sortDir,
      limit: itemsPerPage,
      offset: (currentPage - 1) * itemsPerPage,
    }),
    [debouncedSearch, roleFilter, statusFilter, sortKey, sortDir, itemsPerPage, currentPage],
  )

  const { data: usersData, isLoading } = useUsers(queryParams)
  const currentRows = usersData?.rows ?? []
  const totalItems = usersData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  return (
    <div className="admin-shell">
      <Sidebar activePage={"users" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Manajemen Pengguna</h1>
            <div className="page-actions">
              <button
                className="btn-admin-primary"
                style={{ width: "200px", justifyContent: "center" }}
                onClick={() => setShowAdd(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Pengguna
              </button>
            </div>
          </div>

          <div className="search-row">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setCurrentPage(1)
              }}
              placeholder="Cari nama, peran, status admin..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span>Nama Admin</span>
                      <SortIcon direction={sortKey === "name" ? sortDir : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 220 }}>
                    Email
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Peran
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Status
                  </th>
                  <th
                    className="tbl-th tbl-th--center"
                    style={{ width: 160, cursor: "pointer" }}
                    onClick={() => toggleSort("createdAt")}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span>Tanggal Pembuatan</span>
                      <SortIcon direction={sortKey === "createdAt" ? sortDir : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Memuat data…
                    </td>
                  </tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Tidak ada pengguna.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((u) => {
                    const role = ROLE_BADGE[u.role]
                    const status = u.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                    return (
                      <tr key={u.id} className="tbl-row">
                        <td className="tbl-td tbl-td--client tbl-td--center">{u.name}</td>
                        <td className="tbl-td tbl-td--center">{u.email}</td>
                        <td className="tbl-td tbl-td--center">
                          <StatusBadge bg={role.bg} color={role.color} minWidth={108}>
                            {role.label}
                          </StatusBadge>
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <StatusBadge bg={status.bg} color={status.color} minWidth={108}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className="tbl-td tbl-td--center">{formatDateID(u.createdAt)}</td>
                        <td className="tbl-td tbl-td--center">
                          <button
                            className="action-btn"
                            title="Lihat detail"
                            style={{ color: "#7C3AED" }}
                            onClick={() => onViewDetail?.(u.id)}
                          >
                            <EyeIcon />
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
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
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

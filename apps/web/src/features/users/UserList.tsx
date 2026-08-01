import { useMemo, useState } from "react"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import SortIcon from "@/components/shared/SortIcon"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useUsers } from "@/features/users/hooks"
import type { Page } from "@/lib/page"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { Role } from "@/types/api"
import UserAddModal from "./UserAddModal"
import UserFilter, { type RoleFilter, type StatusFilter } from "./UserFilter"

interface UserListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

type SortKey = "name" | "createdAt"

type UserFilters = { role: RoleFilter; status: StatusFilter }

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
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [showFilter, setShowFilter] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const list = useListScreen<UserFilters>({ role: "all", status: "all" })
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
    list.setCurrentPage(1)
  }

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      role: filters.role === "all" ? undefined : (filters.role as Role),
      isActive: filters.status === "all" ? undefined : filters.status === "active",
      sortBy: sortKey,
      sortDir,
      limit: itemsPerPage,
      offset: startIndex,
    }),
    [debouncedSearch, filters, sortKey, sortDir, itemsPerPage, startIndex],
  )

  const { data: usersData, isLoading } = useUsers(queryParams)
  const currentRows = usersData?.rows ?? []
  const totalItems = usersData?.total ?? 0
  const totalPages = list.totalPagesOf(totalItems)

  return (
    <div className="admin-shell">
      <Sidebar activePage={"users" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Manajemen Pengguna</h1>
            <div className="page-actions">
              <button
                className={`${ui.btnPrimary} w-[200px]`}
                type="button"
                onClick={() => setShowAdd(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
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

          <div className="flex items-center gap-4 pt-2">
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder="Cari nama, peran, status admin..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <div className={ui.tableWrap}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th
                    className={`${ui.thCenter} cursor-pointer`}
                    style={{ width: 200 }}
                    onClick={() => toggleSort("name")}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Nama Admin</span>
                      <SortIcon direction={sortKey === "name" ? sortDir : null} />
                    </div>
                  </th>
                  <th className={ui.thCenter} style={{ width: 220 }}>
                    Email
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Peran
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Status
                  </th>
                  <th
                    className={`${ui.thCenter} cursor-pointer`}
                    style={{ width: 160 }}
                    onClick={() => toggleSort("createdAt")}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Tanggal Pembuatan</span>
                      <SortIcon direction={sortKey === "createdAt" ? sortDir : null} />
                    </div>
                  </th>
                  <th className={ui.thCenter} style={{ width: 80 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableLoadingRow colSpan={6} />}
                {!isLoading && currentRows.length === 0 && (
                  <TableEmptyRow colSpan={6}>Tidak ada pengguna.</TableEmptyRow>
                )}
                {!isLoading &&
                  currentRows.map((u) => {
                    const role = ROLE_BADGE[u.role]
                    const status = u.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                    return (
                      <tr key={u.id} className={ui.tr}>
                        <td className={ui.tdCenter}>
                          <span className="font-medium text-dark-900">{u.name}</span>
                        </td>
                        <td className={ui.tdCenter}>{u.email}</td>
                        <td className={ui.tdCenter}>
                          <StatusBadge bg={role.bg} color={role.color} minWidth={108}>
                            {role.label}
                          </StatusBadge>
                        </td>
                        <td className={ui.tdCenter}>
                          <StatusBadge bg={status.bg} color={status.color} minWidth={108}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className={ui.tdCenter}>{formatDateID(u.createdAt)}</td>
                        <td className={ui.tdCenter}>
                          <button
                            type="button"
                            className={ui.iconAction}
                            title="Lihat detail"
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
              currentPage={list.currentPage}
              totalPages={totalPages}
              resourceLabel="Admin"
              onItemsPerPage={list.setItemsPerPage}
              onPage={list.setCurrentPage}
            />
          </div>
        </div>
      </div>

      {showFilter && (
        <UserFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={list.applyFilters}
        />
      )}

      <UserAddModal open={showAdd} onOpenChange={setShowAdd} />
    </div>
  )
}

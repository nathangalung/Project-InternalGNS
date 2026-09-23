import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import SortIcon from "@/components/shared/SortIcon"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useUsers } from "@/features/users/hooks"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { Role } from "@/types/api"
import UserAddModal from "./UserAddModal"
import UserFilter, { type RoleFilter, type StatusFilter } from "./UserFilter"

type SortKey = "name" | "createdAt"

// Sortable header, keyboard reachable.
const sortBtn = `mx-auto flex cursor-pointer items-center justify-center gap-1.5 rounded-sm p-0 font-bold uppercase tracking-[0.05em] ${ui.focusRing}`

type UserFilters = { role: RoleFilter; status: StatusFilter }

const ROLE_BADGE: Record<Role, { label: string; bg: string; color: string }> = {
  superadmin: { label: "SUPERADMIN", bg: "#EDE9FE", color: "#5B21B6" },
  // Text darkened from #DA6900 (2.3:1) to 6.7:1.
  operational: { label: "OPERASIONAL", bg: "#FFE16D", color: "#92400E" },
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

export default function UserList() {
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [showFilter, setShowFilter] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const list = useListScreen<UserFilters>({ role: "all", status: "all" })
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key) return "none"
    return sortDir === "asc" ? "ascending" : "descending"
  }

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
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Manajemen Pengguna</h1>
          <div className={ui.pageActions}>
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
            placeholder="Cari nama atau email..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[200px]`} aria-sort={ariaSort("name")}>
                  <button type="button" className={sortBtn} onClick={() => toggleSort("name")}>
                    <span>Nama Pengguna</span>
                    <SortIcon direction={sortKey === "name" ? sortDir : null} />
                  </button>
                </th>
                <th className={`${ui.thCenter} w-[220px]`}>Email</th>
                <th className={`${ui.thCenter} w-[140px]`}>Peran</th>
                <th className={`${ui.thCenter} w-[140px]`}>Status</th>
                <th className={`${ui.thCenter} w-[160px]`} aria-sort={ariaSort("createdAt")}>
                  <button type="button" className={sortBtn} onClick={() => toggleSort("createdAt")}>
                    <span>Tanggal Pembuatan</span>
                    <SortIcon direction={sortKey === "createdAt" ? sortDir : null} />
                  </button>
                </th>
                <th className={`${ui.thCenter} w-[80px]`}>Aksi</th>
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
                        <span className="font-medium text-dark-900">
                          <EntityLink kind="user" id={u.id} tone="name">
                            {u.name}
                          </EntityLink>
                        </span>
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
                        <Link
                          to="/users/$id"
                          params={{ id: String(u.id) }}
                          className={ui.iconAction}
                          title="Lihat detail"
                          aria-label={`Lihat detail ${u.name}`}
                        >
                          <EyeIcon />
                        </Link>
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
            resourceLabel="Pengguna"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
          />
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
    </>
  )
}

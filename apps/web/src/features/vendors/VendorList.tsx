import { useMemo, useState } from "react"
import EntityLogo from "@/components/shared/EntityLogo"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useVendors } from "@/features/vendors/hooks"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import VendorFilter, { type VendorFilterValues } from "@/features/vendors/VendorFilter"
import { formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { VendorRow } from "@/types/api"

interface VendorListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

type SortKey = "totalPembelian" | "productCount"

export default function VendorList({ onNavigate, onLogout, onViewDetail }: VendorListProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const list = useListScreen<VendorFilterValues>({
    status: "all",
    countryName: "",
    minTotal: "",
  })
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(k)
      setSortDir("desc")
    }
  }

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      isActive: filters.status === "all" ? undefined : filters.status === "active",
      countryName: filters.countryName || undefined,
      minTotal: filters.minTotal && filters.minTotal !== "0" ? filters.minTotal : undefined,
      sortBy:
        sortKey === "productCount"
          ? ("productCount" as const)
          : sortKey === "totalPembelian"
            ? ("totalPurchase" as const)
            : undefined,
      sortDir: sortKey ? sortDir : undefined,
      limit: itemsPerPage,
      offset: startIndex,
    }),
    [debouncedSearch, filters, sortKey, sortDir, itemsPerPage, startIndex],
  )

  const { data, isLoading } = useVendors(queryParams)
  const currentRows = data?.rows ?? []
  const totalItems = data?.total ?? 0
  const totalPages = list.totalPagesOf(totalItems)

  return (
    <div className="admin-shell">
      <Sidebar activePage={"vendors" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Vendor</h1>
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
                Tambah Vendor
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder="Cari nama, negara asal vendor..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <div className={ui.tableWrap}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={ui.thCenter} style={{ width: 240 }}>
                    Nama Vendor
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Negara
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Status
                  </th>
                  <th
                    className={`${ui.thCenter} cursor-pointer`}
                    style={{ width: 180 }}
                    onClick={() => toggleSort("totalPembelian")}
                  >
                    Total Pembelian
                  </th>
                  <th
                    className={`${ui.thCenter} cursor-pointer`}
                    style={{ width: 160 }}
                    onClick={() => toggleSort("productCount")}
                  >
                    Jumlah Produk
                  </th>
                  <th className={ui.thCenter} style={{ width: 80 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableLoadingRow colSpan={6} />}
                {!isLoading && currentRows.length === 0 && (
                  <TableEmptyRow colSpan={6}>Tidak ada vendor.</TableEmptyRow>
                )}
                {!isLoading &&
                  currentRows.map((v: VendorRow) => {
                    const status = v.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                    return (
                      <tr key={v.id} className={ui.tr}>
                        <td className={ui.td}>
                          <div className="flex items-center gap-4 pl-3">
                            <EntityLogo name={v.name} />
                            <span className="min-w-0 flex-1 break-words text-sm font-bold leading-[1.35] text-[#191C1E]">
                              {v.name}
                            </span>
                          </div>
                        </td>
                        <td className={`${ui.tdCenter} text-sm font-medium text-[#191C1E]`}>
                          {v.location ?? "-"}
                        </td>
                        <td className={ui.tdCenter}>
                          <StatusBadge bg={status.bg} color={status.color} minWidth={100}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                          {formatRupiah(v.totalPurchase, "-")}
                        </td>
                        <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                          {v.productCount}
                        </td>
                        <td className={ui.tdCenter}>
                          <button
                            type="button"
                            className={ui.iconAction}
                            title="Lihat detail"
                            onClick={() => onViewDetail?.(v.id)}
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
              resourceLabel="Vendor"
              onItemsPerPage={list.setItemsPerPage}
              onPage={list.setCurrentPage}
            />
          </div>
        </div>
      </div>

      <VendorAddModal open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <VendorFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={list.applyFilters}
        />
      )}
    </div>
  )
}

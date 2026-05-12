import { useMemo, useState } from "react"
import EntityLogo from "@/components/shared/EntityLogo"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import { useVendors } from "@/features/vendors/hooks"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import VendorFilter, { type VendorFilterValues } from "@/features/vendors/VendorFilter"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { formatRupiah } from "@/lib/format"
import type { Page } from "@/main"
import type { VendorRow } from "@/types/api"

interface VendorListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

const STATUS_AKTIF = { label: "AKTIF", bg: "#D1FAE5", color: "#047857" }
const STATUS_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

type SortKey = "totalPembelian" | "productCount"

export default function VendorList({ onNavigate, onLogout, onViewDetail }: VendorListProps) {
  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<VendorFilterValues>({
    status: "all",
    countryName: "",
    minTotal: "",
  })
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(k)
      setSortDir("desc")
    }
  }

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

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
      offset: (currentPage - 1) * itemsPerPage,
    }),
    [debouncedSearch, filters, sortKey, sortDir, itemsPerPage, currentPage],
  )

  const { data, isLoading } = useVendors(queryParams)
  const currentRows = data?.rows ?? []
  const totalItems = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  return (
    <div className="admin-shell">
      <Sidebar activePage={"vendors" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Vendor</h1>
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
                Tambah Vendor
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
              placeholder="Cari nama, negara asal vendor..."
            />
            <button className="btn-admin-filter" onClick={() => setShowFilter(true)}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
                  <th className="tbl-th tbl-th--center" style={{ width: 240 }}>
                    Nama Vendor
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Negara
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Status
                  </th>
                  <th
                    className="tbl-th tbl-th--center"
                    style={{ width: 180, cursor: "pointer" }}
                    onClick={() => toggleSort("totalPembelian")}
                  >
                    Total Pembelian
                  </th>
                  <th
                    className="tbl-th tbl-th--center"
                    style={{ width: 160, cursor: "pointer" }}
                    onClick={() => toggleSort("productCount")}
                  >
                    Jumlah Produk
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
                      Tidak ada vendor.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((v: VendorRow) => {
                    const status = v.isActive ? STATUS_AKTIF : STATUS_NONAKTIF
                    return (
                      <tr key={v.id} className="tbl-row">
                        <td className="tbl-td">
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "16px",
                              paddingLeft: "12px",
                            }}
                          >
                            <EntityLogo name={v.name} />
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 700,
                                fontSize: "14px",
                                lineHeight: "1.35",
                                color: "#191C1E",
                                flex: 1,
                                minWidth: 0,
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}
                            >
                              {v.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#191C1E", fontWeight: 500, fontSize: "14px" }}
                        >
                          {v.location ?? "-"}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <span
                            className="status-badge"
                            style={{ background: status.bg, color: status.color, minWidth: 100 }}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {formatRupiah(v.totalPurchase, "-")}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {v.productCount}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <button
                            className="action-btn"
                            title="Lihat detail"
                            style={{ color: "#7C3AED" }}
                            onClick={() => onViewDetail?.(v.id)}
                          >
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
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
              resourceLabel="Vendor"
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      <VendorAddModal open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <VendorFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={(f) => {
            setFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

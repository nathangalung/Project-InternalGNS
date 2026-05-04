import { useMemo, useState } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import { useVendors } from "@/features/vendors/hooks"
import Pagination from "@/components/shared/Pagination"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import VendorFilter, { type VendorFilterValues } from "@/features/vendors/VendorFilter"
import type { VendorRow } from "@/types/api"
import { formatRupiah } from "@/lib/format"

interface VendorListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

const STATUS_AKTIF    = { label: "AKTIF",    bg: "#D1FAE5", color: "#047857" }
const STATUS_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

const LOGO_BG_PALETTE = ["#1E293B", "#334155", "#475569", "#3730A3", "#4338CA", "#0F766E", "#7C2D12"]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return Math.abs(h)
}

function vendorInitials(name: string): string {
  const parts = name.replace(/^PT\.?\s+/i, "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function VendorLogo({ name }: { name: string }) {
  const bg = LOGO_BG_PALETTE[hashCode(name) % LOGO_BG_PALETTE.length]
  return (
    <div style={{
      width: "48px",
      height: "48px",
      borderRadius: "8px",
      background: bg,
      color: "#FFFFFF",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      fontWeight: 700,
      fontSize: "13px",
      letterSpacing: "0.5px",
      flexShrink: 0,
    }}>
      {vendorInitials(name)}
    </div>
  )
}

type SortKey = "totalPembelian" | "productCount"

export default function VendorList({ onNavigate, onLogout, onViewDetail }: VendorListProps) {
  const { data, isLoading } = useVendors({ limit: 200 })

  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<VendorFilterValues>({ status: "all", countryName: "", minTotal: "" })
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const vendors = data ?? []

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(k)
      setSortDir("desc")
    }
  }

  const filtered = useMemo(() => {
    let items = vendors
    if (search) {
      const needle = search.toLowerCase()
      items = items.filter(v =>
        v.name.toLowerCase().includes(needle) ||
        (v.location ?? "").toLowerCase().includes(needle),
      )
    }
    if (filters.status !== "all") {
      items = items.filter(v => filters.status === "active" ? v.isActive : !v.isActive)
    }
    if (filters.countryName) {
      const needle = filters.countryName.toLowerCase()
      items = items.filter(v => (v.location ?? "").toLowerCase().includes(needle))
    }
    if (sortKey === "productCount") {
      items = [...items].sort((a, b) => {
        const diff = a.productCount - b.productCount
        return sortDir === "asc" ? diff : -diff
      })
    }
    if (sortKey === "totalPembelian") {
      items = [...items].sort((a, b) => {
        const diff = (Number(a.totalPurchase) || 0) - (Number(b.totalPurchase) || 0)
        return sortDir === "asc" ? diff : -diff
      })
    }
    if (filters.minTotal) {
      const minNum = Number(filters.minTotal)
      if (Number.isFinite(minNum) && minNum > 0) {
        items = items.filter(v => (Number(v.totalPurchase) || 0) >= minNum)
      }
    }
    return items
  }, [vendors, search, filters, sortKey, sortDir])

  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentRows = filtered.slice(startIndex, startIndex + itemsPerPage)

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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Vendor
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
                placeholder="Cari nama, negara asal vendor..."
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
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
                  <th className="tbl-th tbl-th--center" style={{ width: 240 }}>Nama Vendor</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Negara</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Status</th>
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
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Memuat data…</td></tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr><td colSpan={6} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Tidak ada vendor.</td></tr>
                )}
                {!isLoading && currentRows.map((v: VendorRow) => {
                  const status = v.isActive ? STATUS_AKTIF : STATUS_NONAKTIF
                  return (
                    <tr key={v.id} className="tbl-row">
                      <td className="tbl-td">
                        <div style={{ display: "flex", alignItems: "center", gap: "16px", paddingLeft: "12px" }}>
                          <VendorLogo name={v.name} />
                          <span style={{
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: 700,
                            fontSize: "14px",
                            lineHeight: "1.35",
                            color: "#191C1E",
                            flex: 1,
                            minWidth: 0,
                            wordBreak: "break-word",
                            whiteSpace: "normal",
                          }}>
                            {v.name}
                          </span>
                        </div>
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#191C1E", fontWeight: 500, fontSize: "14px" }}>
                        {v.location ?? "-"}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: status.bg, color: status.color, minWidth: 100 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#191C1E" }}>
                        {formatRupiah(v.totalPurchase, "-")}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#191C1E" }}>
                        {v.productCount}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <button
                          className="action-btn"
                          title="Lihat detail"
                          style={{ color: "#7C3AED" }}
                          onClick={() => onViewDetail?.(v.id)}
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
              resourceLabel="Vendor"
              onItemsPerPage={n => { setItemsPerPage(n); setCurrentPage(1) }}
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
          onApply={f => {
            setFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

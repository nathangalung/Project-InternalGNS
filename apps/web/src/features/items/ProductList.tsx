import { useMemo, useState } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import { useItems } from "@/features/items/hooks"
import { useUnits } from "@/features/units/hooks"
import ProductCreateModal from "@/features/items/ProductCreateModal"
import ProductFilter, { type ProductFilterValues } from "@/features/items/ProductFilter"
import Pagination from "@/components/shared/Pagination"
import type { ItemRow } from "@/types/api"

interface ProductListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

const STATUS_AKTIF    = { label: "AKTIF",    bg: "#D1FAE5", color: "#047857" }
const STATUS_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

export default function ProductList({ onNavigate, onLogout, onViewDetail }: ProductListProps) {
  const { data: itemsData, isLoading } = useItems({ limit: 200 })
  const { data: unitsData } = useUnits()

  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<ProductFilterValues>({ status: "all", unitCode: "" })
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of unitsData ?? []) map.set(u.id, u.code)
    return (id?: number) => (id !== undefined ? map.get(id) ?? "-" : "-")
  }, [unitsData])

  const items = itemsData ?? []

  const unitIdByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of unitsData ?? []) map.set(u.code, u.id)
    return map
  }, [unitsData])

  const filtered = useMemo(() => {
    let rows = items
    if (search) {
      const needle = search.toLowerCase()
      rows = rows.filter(it =>
        it.name.toLowerCase().includes(needle) ||
        (it.impaCode ?? "").toLowerCase().includes(needle) ||
        (it.description ?? "").toLowerCase().includes(needle),
      )
    }
    if (filters.status !== "all") {
      rows = rows.filter(it => filters.status === "active" ? it.isActive : !it.isActive)
    }
    if (filters.unitCode) {
      const targetId = unitIdByCode.get(filters.unitCode)
      if (targetId !== undefined) {
        rows = rows.filter(it => it.defaultUnitId === targetId)
      }
    }
    return rows
  }, [items, search, filters, unitIdByCode])

  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentRows = filtered.slice(startIndex, startIndex + itemsPerPage)

  return (
    <div className="admin-shell">
      <Sidebar activePage={"products" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>

          <div className="page-header">
            <h1 className="page-title">Katalog Produk</h1>
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
                Tambah Produk
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
                placeholder="Cari kode IMPA, nama, kategori produk..."
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
                  <th className="tbl-th tbl-th--center" style={{ width: 110 }}>Kode IMPA</th>
                  <th className="tbl-th tbl-th--center" style={{ width: "auto" }}>Nama Produk</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Unit</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Status</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={5} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Memuat data…</td></tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr><td colSpan={5} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Tidak ada produk.</td></tr>
                )}
                {!isLoading && currentRows.map((it: ItemRow) => {
                  const status = it.isActive ? STATUS_AKTIF : STATUS_NONAKTIF
                  return (
                    <tr key={it.id} className="tbl-row">
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#630ED4" }}>
                        {it.impaCode ?? "-"}
                      </td>
                      <td
                        className="tbl-td tbl-td--client tbl-td--center"
                        style={{
                          fontWeight: 700,
                          whiteSpace: "normal",
                          overflow: "visible",
                          textOverflow: "clip",
                          wordBreak: "break-word",
                          lineHeight: "20px",
                        }}
                      >
                        {it.name}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455", fontWeight: 500 }}>
                        {unitOf(it.defaultUnitId)}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: status.bg, color: status.color, minWidth: 84 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <button
                          className="action-btn"
                          title="Lihat detail"
                          style={{ color: "#7C3AED" }}
                          onClick={() => onViewDetail?.(it.id)}
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
              resourceLabel="Produk"
              onItemsPerPage={n => { setItemsPerPage(n); setCurrentPage(1) }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      <ProductCreateModal open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <ProductFilter
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

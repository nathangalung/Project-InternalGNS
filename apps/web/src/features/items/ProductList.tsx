import { useMemo, useState } from "react"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import { useItemSearchAdvanced, useItems } from "@/features/items/hooks"
import ProductCreateModal from "@/features/items/ProductCreateModal"
import ProductFilter, { type ProductFilterValues } from "@/features/items/ProductFilter"
import { useUnits } from "@/features/units/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import type { Page } from "@/lib/page"
import type { AdvancedSearchHit, AdvancedSearchTier, ItemRow } from "@/types/api"

interface ProductListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

const STATUS_AKTIF = { label: "AKTIF", bg: "#D1FAE5", color: "#047857" }
const STATUS_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

// Tier → small inline label shown next to product name.
// Layout-neutral: same line, same height, only adds badge content.
const TIER_BADGE: Record<AdvancedSearchTier, { label: string; bg: string; color: string }> = {
  ITEM_AUTO: { label: "EXACT", bg: "#DCFCE7", color: "#15803D" },
  VENDOR_OFFER: { label: "VENDOR", bg: "#EDE9FE", color: "#6D28D9" },
  ITEM_SUGGESTED: { label: "MIRIP", bg: "#FEF3C7", color: "#B45309" },
  REQUEST_HISTORY: { label: "RIWAYAT", bg: "#DBEAFE", color: "#1D4ED8" },
  ITEM_FUZZY: { label: "FUZZY", bg: "#F3F4F6", color: "#4B5563" },
}

export default function ProductList({ onNavigate, onLogout, onViewDetail }: ProductListProps) {
  const { data: unitsData } = useUnits()

  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<ProductFilterValues>({ status: "all", unitCode: "" })
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const isSearchActive = debouncedSearch.length > 0

  const unitIdByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of unitsData ?? []) map.set(u.code, u.id)
    return map
  }, [unitsData])

  const listParams = useMemo(() => {
    const out: Parameters<typeof useItems>[0] = {
      limit: itemsPerPage,
      offset: (currentPage - 1) * itemsPerPage,
    }
    if (filters.status === "active") out.isActive = true
    if (filters.status === "inactive") out.isActive = false
    if (filters.unitCode) {
      const id = unitIdByCode.get(filters.unitCode)
      if (id !== undefined) out.unitId = id
    }
    return out
  }, [filters, itemsPerPage, currentPage, unitIdByCode])

  const { data: listData, isLoading: itemsLoading } = useItems(listParams)
  const { data: searchData, isFetching: searchLoading } = useItemSearchAdvanced(debouncedSearch, {
    minScore: 0.3,
    limit: 100,
  })
  const searchHits: AdvancedSearchHit[] = searchData?.hits ?? []
  const tierById = useMemo(() => {
    const m = new Map<number, AdvancedSearchTier>()
    for (const h of searchHits) m.set(h.id, h.tier)
    return m
  }, [searchHits])
  const isLoading = isSearchActive ? searchLoading : itemsLoading

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of unitsData ?? []) map.set(u.id, u.code)
    return (id?: number) => (id !== undefined ? (map.get(id) ?? "-") : "-")
  }, [unitsData])

  const searchRows: ItemRow[] = useMemo(() => {
    if (!isSearchActive) return []
    let rows: ItemRow[] = searchHits.map((h) => ({
      id: h.id,
      name: h.name,
      impaCode: h.impaCode,
      defaultUnitId: h.defaultUnitId,
      description: undefined,
      isActive: true,
      createdAt: "",
      updatedAt: "",
    }))
    if (filters.status !== "all") {
      rows = rows.filter((it) => (filters.status === "active" ? it.isActive : !it.isActive))
    }
    if (filters.unitCode) {
      const targetId = unitIdByCode.get(filters.unitCode)
      if (targetId !== undefined) rows = rows.filter((it) => it.defaultUnitId === targetId)
    }
    return rows
  }, [isSearchActive, searchHits, filters, unitIdByCode])

  const serverRows = listData?.rows ?? []
  const totalItems = isSearchActive ? searchRows.length : (listData?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentRows = isSearchActive
    ? searchRows.slice(startIndex, startIndex + itemsPerPage)
    : serverRows

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
                Tambah Produk
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
              placeholder="Cari kode IMPA, nama, kategori produk..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 110 }}>
                    Kode IMPA
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: "auto" }}>
                    Nama Produk
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Unit
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Status
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
                      colSpan={5}
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
                      colSpan={5}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Tidak ada produk.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((it: ItemRow) => {
                    const status = it.isActive ? STATUS_AKTIF : STATUS_NONAKTIF
                    const tier = isSearchActive ? tierById.get(it.id) : undefined
                    const tierBadge = tier ? TIER_BADGE[tier] : undefined
                    return (
                      <tr key={it.id} className="tbl-row">
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#630ED4" }}
                        >
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
                          {tierBadge && (
                            <span
                              style={{
                                display: "inline-block",
                                marginLeft: 6,
                                padding: "1px 6px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                                background: tierBadge.bg,
                                color: tierBadge.color,
                                verticalAlign: "middle",
                              }}
                            >
                              {tierBadge.label}
                            </span>
                          )}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#4A4455", fontWeight: 500 }}
                        >
                          {unitOf(it.defaultUnitId)}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <StatusBadge bg={status.bg} color={status.color} minWidth={84}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <button
                            className="action-btn"
                            title="Lihat detail"
                            style={{ color: "#7C3AED" }}
                            onClick={() => onViewDetail?.(it.id)}
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
              resourceLabel="Produk"
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
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
          onApply={(f) => {
            setFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

import { useMemo, useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useMe } from "@/features/auth/hooks"
import {
  KATALOG_UNIT_SCAN_LIMIT,
  type KatalogRow,
  katalogRowsFromHits,
  katalogSearchPlan,
  katalogSearchView,
} from "@/features/items/helpers"
import { useItemSearchAdvanced, useItems } from "@/features/items/hooks"
import ProductCreateModal from "@/features/items/ProductCreateModal"
import ProductFilter, { type ProductFilterValues } from "@/features/items/ProductFilter"
import { useUnits } from "@/features/units/hooks"
import { canWriteCatalog } from "@/lib/rbac"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { AdvancedSearchTier } from "@/types/api"

type ProductListProps = {
  onViewDetail?: (id: number) => void
}

// Tier → small inline label shown next to product name.
// Layout-neutral: same line, same height, only adds badge content.
const TIER_BADGE: Record<AdvancedSearchTier, { label: string; cls: string }> = {
  ITEM_AUTO: { label: "EXACT", cls: "bg-[#DCFCE7] text-[#15803D]" },
  VENDOR_OFFER: { label: "VENDOR", cls: "bg-primary-100 text-[#6D28D9]" },
  ITEM_SUGGESTED: { label: "MIRIP", cls: "bg-accent-100 text-accent-700" },
  REQUEST_HISTORY: { label: "RIWAYAT", cls: "bg-[#DBEAFE] text-[#1D4ED8]" },
  ITEM_FUZZY: { label: "FUZZY", cls: "bg-[#F3F4F6] text-[#4B5563]" },
}

export default function ProductList({ onViewDetail }: ProductListProps) {
  const { data: unitsData } = useUnits()
  const { data: me } = useMe()
  const canWrite = canWriteCatalog(me?.role)

  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const list = useListScreen<ProductFilterValues>({ status: "all", unitCode: "" })
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list
  const isSearchActive = debouncedSearch.length > 0

  const unitIdByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of unitsData ?? []) map.set(u.code, u.id)
    return map
  }, [unitsData])

  const unitId = filters.unitCode ? unitIdByCode.get(filters.unitCode) : undefined

  const listParams = useMemo(() => {
    const out: Parameters<typeof useItems>[0] = {
      limit: itemsPerPage,
      offset: startIndex,
    }
    if (filters.status === "active") out.isActive = true
    if (filters.status === "inactive") out.isActive = false
    if (unitId !== undefined) out.unitId = unitId
    return out
  }, [filters.status, itemsPerPage, startIndex, unitId])

  const filterActive = filters.status === "active"
  const filterInactive = filters.status === "inactive"
  const filterIsActive = filterActive ? true : filterInactive ? false : undefined

  // Skipped while searching: the search layer supplies the rows instead.
  const { data: listData, isLoading: itemsLoading } = useItems(listParams, {
    enabled: !isSearchActive,
  })
  const searchPlan = useMemo(
    () => katalogSearchPlan(unitId, startIndex, itemsPerPage),
    [unitId, startIndex, itemsPerPage],
  )
  const { data: searchData, isFetching: searchLoading } = useItemSearchAdvanced(debouncedSearch, {
    minScore: 0.3,
    limit: searchPlan.limit,
    offset: searchPlan.offset,
    isActive: filterIsActive,
  })
  const searchView = useMemo(
    () => katalogSearchView(searchData, searchPlan, unitId, startIndex, itemsPerPage),
    [searchData, searchPlan, unitId, startIndex, itemsPerPage],
  )
  const tierById = useMemo(() => {
    const m = new Map<number, AdvancedSearchTier>()
    for (const h of searchView.hits) m.set(h.id, h.tier)
    return m
  }, [searchView.hits])
  const isLoading = isSearchActive ? searchLoading : itemsLoading

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of unitsData ?? []) map.set(u.id, u.code)
    return (id?: number) => (id !== undefined ? (map.get(id) ?? "-") : "-")
  }, [unitsData])

  const totalItems = isSearchActive ? searchView.total : (listData?.total ?? 0)
  const totalPages = list.totalPagesOf(totalItems)
  const currentRows: KatalogRow[] = isSearchActive
    ? katalogRowsFromHits(searchView.hits)
    : (listData?.rows ?? [])

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Katalog Produk</h1>
          {canWrite && (
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
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Produk
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 pt-2">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Cari kode IMPA, nama, kategori produk..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        {isSearchActive && searchData && (
          <div className="-mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                "ITEM_AUTO",
                "VENDOR_OFFER",
                "ITEM_SUGGESTED",
                "REQUEST_HISTORY",
                "ITEM_FUZZY",
              ] as AdvancedSearchTier[]
            )
              .filter((t) => (searchView.counts[t] ?? 0) > 0)
              .map((t) => {
                const b = TIER_BADGE[t]
                return (
                  <span
                    key={t}
                    className={`rounded-[4px] px-2 py-0.5 text-[11px] font-bold ${b.cls}`}
                  >
                    {searchView.counts[t]} {b.label}
                  </span>
                )
              })}
            {searchView.capped && (
              <span className="text-caption text-dark-500">
                Filter unit hanya diterapkan pada {KATALOG_UNIT_SCAN_LIMIT} hasil teratas dari{" "}
                {searchData.total}. Perjelas kata kunci untuk mempersempit hasil.
              </span>
            )}
          </div>
        )}

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[110px]`}>Kode IMPA</th>
                <th className={`${ui.thCenter} w-auto`}>Nama Produk</th>
                <th className={`${ui.thCenter} w-[140px]`}>Unit</th>
                <th className={`${ui.thCenter} w-[160px]`}>Status</th>
                <th className={`${ui.thCenter} w-[80px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableLoadingRow colSpan={5} />}
              {!isLoading && currentRows.length === 0 && (
                <TableEmptyRow colSpan={5}>
                  {isSearchActive
                    ? `Tidak ada hasil untuk "${debouncedSearch}".`
                    : "Tidak ada produk."}
                </TableEmptyRow>
              )}
              {!isLoading &&
                currentRows.map((it) => {
                  const status = it.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                  const tier = isSearchActive ? tierById.get(it.id) : undefined
                  const tierBadge = tier ? TIER_BADGE[tier] : undefined
                  return (
                    <tr key={it.id} className={ui.tr}>
                      <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                        {it.impaCode ?? "-"}
                      </td>
                      <td
                        className={`${ui.tdCenter} break-words font-bold leading-5 text-dark-900`}
                      >
                        <EntityLink kind="product" id={it.id} tone="name">
                          {it.name}
                        </EntityLink>
                        {tierBadge && (
                          <span
                            className={`ml-1.5 inline-block rounded-[4px] px-1.5 py-px align-middle text-[10px] font-bold tracking-[0.3px] ${tierBadge.cls}`}
                          >
                            {tierBadge.label}
                          </span>
                        )}
                      </td>
                      <td className={`${ui.tdCenter} font-medium`}>{unitOf(it.defaultUnitId)}</td>
                      <td className={ui.tdCenter}>
                        <StatusBadge bg={status.bg} color={status.color} minWidth={84}>
                          {status.label}
                        </StatusBadge>
                      </td>
                      <td className={ui.tdCenter}>
                        <button
                          type="button"
                          className={ui.iconAction}
                          title="Lihat detail"
                          aria-label={`Lihat detail ${it.name}`}
                          onClick={() => onViewDetail?.(it.id)}
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
            resourceLabel="Produk"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
            isLoading={isLoading}
          />
        </div>
      </div>

      <ProductCreateModal open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <ProductFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={list.applyFilters}
        />
      )}
    </>
  )
}

import { useMemo, useState } from "react"
import ActiveFiltersBar, { type FilterChip } from "@/components/shared/ActiveFilters"
import Pagination from "@/components/shared/Pagination"
import { useMe } from "@/features/auth/hooks"
import { toTableRow } from "@/features/quotations/adapters"
import {
  downloadQuotationPdf,
  exportQuotationsXlsx,
  useQuotations,
} from "@/features/quotations/hooks"
import { resolveRange } from "@/lib/date-range"
import { emptyListText } from "@/lib/list-empty"
import { exportsQuotation, seesCost, seesSelling, writesQuotation } from "@/lib/rbac"
import { ui } from "@/lib/ui"
import { useListScreen, usePageWithin } from "@/lib/useListScreen"
import type { QuotationSortKey } from "@/types/api"
import { QUOTATION_FILTERS, quotationListSchema } from "../list-search"
import QuotationFilter from "../QuotationFilter"
import { quotationStatusFromLabel } from "../status"
import type { QuotationRow, SortableRowKey } from "./helpers"
import PageHeader from "./PageHeader"
import QuotationTable from "./QuotationTable"
import SearchBar from "./SearchBar"
import SummaryCards from "./SummaryCards"

type QuotationListProps = {
  onViewDetail?: (id: string) => void
}

// Column to API sort key.
const sortKeyToApi: Record<SortableRowKey, QuotationSortKey> = {
  displayNo: "quotationNo",
  version: "version",
  date: "createdAt",
  total: "grandTotal",
}

// Quotation list orchestrator.
export default function QuotationList({ onViewDetail }: QuotationListProps) {
  const [showFilter, setShowFilter] = useState(false)
  const role = useMe().data?.role
  // A total filter or sort is refused for a role that cannot see it, so a
  // shared URL carrying one is read without it.
  const showTotal = seesSelling(role)

  const list = useListScreen(quotationListSchema, "/quotations")
  const { debouncedSearch, filters: activeFilters, itemsPerPage, startIndex, sort } = list
  const { clearSearch, patchFilters } = list
  const hasTotalRange =
    showTotal && (activeFilters.minHarga !== "" || activeFilters.maxHarga !== "")

  function requestSort(key: SortableRowKey) {
    const direction = sort?.key === key && sort.dir === "asc" ? "desc" : "asc"
    list.setSort({ key, dir: direction })
  }

  const queryParams = useMemo(() => {
    const out: Parameters<typeof useQuotations>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: startIndex,
    }
    if (sort && (sort.key !== "total" || showTotal)) {
      out.sortBy = sortKeyToApi[sort.key]
      out.sortDir = sort.dir
    }
    if (activeFilters.statuses.length > 0) {
      out.statuses = activeFilters.statuses.map(quotationStatusFromLabel)
    }
    const range = resolveRange(activeFilters.preset, activeFilters.startDate, activeFilters.endDate)
    if (range.start) out.dateFrom = range.start
    if (range.end) out.dateTo = range.end
    if (showTotal) {
      if (activeFilters.minHarga) out.minTotal = activeFilters.minHarga
      if (activeFilters.maxHarga) out.maxTotal = activeFilters.maxHarga
    }
    return out
  }, [debouncedSearch, activeFilters, itemsPerPage, startIndex, sort, showTotal])

  const { data, isLoading } = useQuotations(queryParams)
  const currentData: QuotationRow[] = useMemo(() => (data?.rows ?? []).map(toTableRow), [data])

  const totalItems = data?.total ?? 0
  usePageWithin(list, data?.total)
  const totalPages = list.totalPagesOf(totalItems)

  // Active-filter chips shown above the table.
  const filterChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = []
    if (debouncedSearch) {
      out.push({ key: "q", label: `Cari: "${debouncedSearch}"`, onRemove: clearSearch })
    }
    for (const s of activeFilters.statuses) {
      out.push({
        key: `status-${s}`,
        label: `Status: ${s}`,
        onRemove: () =>
          patchFilters((p) => ({ ...p, statuses: p.statuses.filter((x) => x !== s) })),
      })
    }
    if (activeFilters.preset !== "semua") {
      out.push({
        key: "date",
        label: `Tanggal: ${activeFilters.startDate} s/d ${activeFilters.endDate}`,
        onRemove: () => patchFilters((p) => ({ ...p, preset: "semua" })),
      })
    }
    if (hasTotalRange) {
      out.push({
        key: "harga",
        label: `Harga: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
        onRemove: () => patchFilters((p) => ({ ...p, minHarga: "", maxHarga: "" })),
      })
    }
    return out
  }, [debouncedSearch, activeFilters, hasTotalRange, clearSearch, patchFilters])

  const clearAllFilters = () => {
    clearSearch()
    list.applyFilters(QUOTATION_FILTERS)
  }

  // Download the quotation PDF.
  const handleDownload = (row: QuotationRow) => {
    void downloadQuotationPdf(Number(row.id), row.displayNo)
  }

  return (
    <>
      <div className={ui.pageContent}>
        <PageHeader
          onExport={exportsQuotation(role) ? () => exportQuotationsXlsx(queryParams) : undefined}
          canCreate={writesQuotation(role)}
        />
        <SummaryCards />
        <SearchBar
          search={list.search}
          onSearch={list.setSearch}
          onOpenFilter={() => setShowFilter(true)}
        />

        <ActiveFiltersBar chips={filterChips} onClearAll={clearAllFilters} />

        <div className={ui.tableWrap}>
          <QuotationTable
            rows={currentData}
            isLoading={isLoading}
            sortKey={sort?.key ?? null}
            sortDir={sort?.dir ?? null}
            onSort={requestSort}
            onViewDetail={onViewDetail}
            onDownload={exportsQuotation(role) ? handleDownload : undefined}
            showHargaBeli={seesCost(role)}
            showTotal={showTotal}
            emptyText={emptyListText(list, "Belum ada Quotation.")}
          />
          <Pagination
            totalItems={totalItems}
            startIndex={startIndex}
            itemsPerPage={itemsPerPage}
            currentPage={list.currentPage}
            totalPages={totalPages}
            resourceLabel="Quotation"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
          />
        </div>
      </div>

      {showFilter && (
        <QuotationFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters}
          onApply={list.applyFilters}
          showTotalRange={showTotal}
        />
      )}
    </>
  )
}

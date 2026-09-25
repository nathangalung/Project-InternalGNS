import { useMemo, useState } from "react"
import ActiveFiltersBar, { type FilterChip } from "@/components/shared/ActiveFilters"
import Pagination from "@/components/shared/Pagination"
import { toTableRow } from "@/features/quotations/adapters"
import {
  downloadQuotationPdf,
  exportQuotationsXlsx,
  useQuotations,
} from "@/features/quotations/hooks"
import { resolveRange } from "@/lib/date-range"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { QuotationSortKey } from "@/types/api"
import QuotationFilter, { type DatePreset, type StatusFilter } from "../QuotationFilter"
import { quotationStatusFromLabel } from "../status"
import type { QuotationRow, SortableRowKey } from "./helpers"
import PageHeader from "./PageHeader"
import QuotationTable from "./QuotationTable"
import SearchBar from "./SearchBar"
import SummaryCards from "./SummaryCards"

type QuotationListProps = {
  onViewDetail?: (id: string) => void
}

type ActiveFilters = {
  preset: DatePreset
  startDate: string
  endDate: string
  statuses: StatusFilter[]
  minHarga: string
  maxHarga: string
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
  const [sortConfig, setSortConfig] = useState<{
    key: SortableRowKey
    direction: "asc" | "desc"
  } | null>(null)

  const list = useListScreen<ActiveFilters | null>(null)
  const { debouncedSearch, filters: activeFilters, itemsPerPage, startIndex } = list
  const { clearSearch, patchFilters } = list

  function requestSort(key: SortableRowKey) {
    let direction: "asc" | "desc" = "asc"
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
    list.setCurrentPage(1)
  }

  const queryParams = useMemo(() => {
    const out: Parameters<typeof useQuotations>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: startIndex,
    }
    if (sortConfig) {
      out.sortBy = sortKeyToApi[sortConfig.key]
      out.sortDir = sortConfig.direction
    }
    if (!activeFilters) return out
    if (activeFilters.statuses.length > 0) {
      out.statuses = activeFilters.statuses.map(quotationStatusFromLabel)
    }
    const range = resolveRange(activeFilters.preset, activeFilters.startDate, activeFilters.endDate)
    if (range.start) out.dateFrom = range.start
    if (range.end) out.dateTo = range.end
    const min = activeFilters.minHarga.replace(/\D/g, "")
    if (min && min !== "0") out.minTotal = min
    const max = activeFilters.maxHarga.replace(/\D/g, "")
    if (max && max !== "0") out.maxTotal = max
    return out
  }, [debouncedSearch, activeFilters, itemsPerPage, startIndex, sortConfig])

  const { data, isLoading } = useQuotations(queryParams)
  const currentData: QuotationRow[] = useMemo(() => (data?.rows ?? []).map(toTableRow), [data])

  const totalItems = data?.total ?? 0
  const totalPages = list.totalPagesOf(totalItems)

  // Active-filter chips shown above the table.
  const filterChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = []
    if (debouncedSearch) {
      out.push({ key: "q", label: `Cari: "${debouncedSearch}"`, onRemove: clearSearch })
    }
    if (activeFilters) {
      for (const s of activeFilters.statuses) {
        out.push({
          key: `status-${s}`,
          label: `Status: ${s}`,
          onRemove: () =>
            patchFilters((p) => (p ? { ...p, statuses: p.statuses.filter((x) => x !== s) } : p)),
        })
      }
      if (activeFilters.preset !== "semua") {
        out.push({
          key: "date",
          label: `Tanggal: ${activeFilters.startDate} s/d ${activeFilters.endDate}`,
          onRemove: () => patchFilters((p) => (p ? { ...p, preset: "semua" } : p)),
        })
      }
      if (activeFilters.minHarga !== "" || activeFilters.maxHarga !== "") {
        out.push({
          key: "harga",
          label: `Harga: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
          onRemove: () => patchFilters((p) => (p ? { ...p, minHarga: "", maxHarga: "" } : p)),
        })
      }
    }
    return out
  }, [debouncedSearch, activeFilters, clearSearch, patchFilters])

  const clearAllFilters = () => {
    clearSearch()
    list.applyFilters(null)
  }

  // Download the quotation PDF.
  const handleDownload = (row: QuotationRow) => {
    void downloadQuotationPdf(Number(row.id), row.displayNo)
  }

  return (
    <>
      <div className={ui.pageContent}>
        <PageHeader onExport={() => exportQuotationsXlsx(queryParams)} />
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
            sortKey={sortConfig?.key ?? null}
            sortDir={sortConfig?.direction ?? null}
            onSort={requestSort}
            onViewDetail={onViewDetail}
            onDownload={handleDownload}
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
          initialValues={activeFilters ?? undefined}
          onApply={list.applyFilters}
        />
      )}
    </>
  )
}

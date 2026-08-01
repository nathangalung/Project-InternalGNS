import { useMemo, useState } from "react"
import ActiveFiltersBar, { type FilterChip } from "@/components/shared/ActiveFilters"
import Pagination from "@/components/shared/Pagination"
import { toTableRow } from "@/features/quotations/adapters"
import * as quotationsApi from "@/features/quotations/api"
import { useQuotations } from "@/features/quotations/hooks"
import { downloadPdf } from "@/lib/api-client"
import { resolveRange } from "@/lib/date-range"
import { labelToStatus } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { CanonicalStatus } from "@/types/api"
import QuotationFilter, { type DatePreset, type StatusFilter } from "../QuotationFilter"
import type { QuotationRow } from "./helpers"
import PageHeader from "./PageHeader"
import QuotationTable from "./QuotationTable"
import SearchBar from "./SearchBar"
import SummaryCards from "./SummaryCards"

interface QuotationListProps {
  onViewDetail?: (id: string) => void
}

interface ActiveFilters {
  preset: DatePreset
  startDate: string
  endDate: string
  statuses: StatusFilter[]
  minHarga: string
  maxHarga: string
}

// Quotation list orchestrator.
export default function QuotationList({ onViewDetail }: QuotationListProps) {
  const [showFilter, setShowFilter] = useState(false)
  const [sortConfig, setSortConfig] = useState<{
    key: keyof QuotationRow
    direction: "asc" | "desc"
  } | null>(null)

  const list = useListScreen<ActiveFilters | null>(null)
  const { debouncedSearch, filters: activeFilters, itemsPerPage, startIndex } = list
  const { clearSearch, patchFilters } = list

  function requestSort(key: keyof QuotationRow) {
    let direction: "asc" | "desc" = "asc"
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
  }

  const queryParams = useMemo(() => {
    const out: Parameters<typeof useQuotations>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: startIndex,
    }
    if (sortConfig) {
      if (sortConfig.key === "total") out.sortBy = "grandTotal"
      else if (sortConfig.key === "date") out.sortBy = "quotationDate"
      else if (sortConfig.key === "client") out.sortBy = "client"
      else if (sortConfig.key === "displayNo") out.sortBy = "quotationNo"
      out.sortDir = sortConfig.direction
    }
    if (!activeFilters) return out
    if (activeFilters.statuses.length > 0) {
      out.statuses = activeFilters.statuses.map<CanonicalStatus>(labelToStatus)
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

  const { data } = useQuotations(queryParams)
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
        })
      }
      if (activeFilters.minHarga !== "" || activeFilters.maxHarga !== "") {
        out.push({
          key: "harga",
          label: `Harga: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
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
    const safe = row.displayNo.replace(/[\\/]/g, "-")
    void downloadPdf(`/quotations/${row.id}/pdf`, `${safe}.pdf`)
  }

  return (
    <>
      <div className="page-content">
        <PageHeader onExport={() => quotationsApi.exportXlsx(queryParams)} />
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

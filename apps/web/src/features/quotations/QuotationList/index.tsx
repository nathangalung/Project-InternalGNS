import { useMemo, useState } from "react"
import Pagination from "@/components/shared/Pagination"
import Sidebar from "@/components/shared/Sidebar"
import { toTableRow } from "@/features/quotations/adapters"
import { useQuotations } from "@/features/quotations/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { labelToStatus } from "@/lib/status"
import type { Page } from "@/main"
import type { CanonicalStatus } from "@/types/api"
import QuotationFilter, { type DatePreset, type StatusFilter } from "../QuotationFilter"
import type { QuotationRow } from "./helpers"
import PageHeader from "./PageHeader"
import QuotationTable from "./QuotationTable"
import SearchBar from "./SearchBar"
import SummaryCards from "./SummaryCards"

interface QuotationListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
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

function resolveRange(
  preset: DatePreset,
  startIso: string,
  endIso: string,
): { start: string; end: string } {
  if (preset === "kustom") return { start: startIso, end: endIso }
  const today = new Date()
  const end = today.toISOString().slice(0, 10)
  const start = new Date(today)
  if (preset === "7-hari") start.setDate(start.getDate() - 7)
  if (preset === "30-hari") start.setDate(start.getDate() - 30)
  return { start: start.toISOString().slice(0, 10), end }
}

// Quotation list orchestrator.
export default function QuotationList({ onNavigate, onLogout, onViewDetail }: QuotationListProps) {
  const [search, setSearch] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [activeFilters, setActiveFilters] = useState<ActiveFilters | null>(null)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortConfig, setSortConfig] = useState<{
    key: keyof QuotationRow
    direction: "asc" | "desc"
  } | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

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
      offset: (currentPage - 1) * itemsPerPage,
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
  }, [debouncedSearch, activeFilters, itemsPerPage, currentPage, sortConfig])

  const { data } = useQuotations(queryParams)
  const currentData: QuotationRow[] = useMemo(() => (data?.rows ?? []).map(toTableRow), [data])

  const totalItems = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <PageHeader onNavigate={onNavigate} />
          <SummaryCards />
          <SearchBar
            search={search}
            onSearch={(v) => {
              setSearch(v)
              setCurrentPage(1)
            }}
            onOpenFilter={() => setShowFilter(true)}
          />

          <div className="tbl-container">
            <QuotationTable
              rows={currentData}
              sortKey={sortConfig?.key ?? null}
              sortDir={sortConfig?.direction ?? null}
              onSort={requestSort}
              onViewDetail={onViewDetail}
            />
            <Pagination
              totalItems={totalItems}
              startIndex={startIndex}
              itemsPerPage={itemsPerPage}
              currentPage={currentPage}
              totalPages={totalPages}
              resourceLabel="Quotation"
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {showFilter && (
        <QuotationFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={(filters) => {
            setActiveFilters(filters)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

import { useMemo, useState } from "react"
import ActiveFilters, { type FilterChip } from "@/components/shared/ActiveFilters"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import SummaryCard from "@/components/shared/SummaryCard"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { downloadPdf, downloadXml } from "@/lib/api-client"
import { resolveRange } from "@/lib/date-range"
import { formatDate, formatNumber, formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { InvoiceBackendRow } from "@/types/api"
import * as invoicesApi from "./api"
import { useInvoiceSummary, useInvoices } from "./hooks"
import InvoiceFilter, { type InvoiceFilterValues } from "./InvoiceFilter"
import type { InvoiceRow, InvoiceStatus } from "./types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "./types"

const STATUS_TO_EFFECTIVE: Record<InvoiceStatus, string> = {
  DRAF: "draft",
  DIKIRIM: "sent",
  DIBAYAR: "paid",
  TERLAMBAT: "overdue",
}

function rupiahToDigits(s: string): string {
  return s.replace(/\D/g, "")
}

interface InvoiceListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (quotationId: number) => void
}

function parseRupiahNumber(s: string | undefined): number {
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// Backend status, overdue from due.
function deriveStatus(inv: InvoiceBackendRow): InvoiceStatus | null {
  if (inv.status === "cancelled") return null
  if (inv.status === "paid") return "DIBAYAR"
  if (inv.status === "overdue") return "TERLAMBAT"
  const base: InvoiceStatus = inv.status === "sent" ? "DIKIRIM" : "DRAF"
  if (inv.dueDate) {
    const due = new Date(inv.dueDate)
    if (!Number.isNaN(due.getTime()) && new Date() > due) return "TERLAMBAT"
  }
  return base
}

function rowFromBackend(inv: InvoiceBackendRow): InvoiceRow | null {
  const status = deriveStatus(inv)
  if (!status) return null
  const totalNumber = parseRupiahNumber(inv.total ?? inv.subtotal)
  return {
    id: inv.id,
    quotationId: inv.quotationId,
    invoiceNo: inv.invoiceNo,
    client: inv.companyName,
    createdAt: inv.invoiceDate,
    dueDate: inv.dueDate ?? inv.invoiceDate,
    total: formatRupiah(totalNumber),
    totalNumber,
    status,
  }
}

const actionBtn =
  "inline-flex items-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"

export default function InvoiceList({ onNavigate, onLogout, onViewDetail }: InvoiceListProps) {
  const [search, setSearch] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [activeFilters, setActiveFilters] = useState<InvoiceFilterValues | null>(null)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryParams = useMemo(() => {
    const out: Parameters<typeof useInvoices>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: (currentPage - 1) * itemsPerPage,
      sortBy: "createdAt",
      sortDir: "desc",
    }
    if (!activeFilters) return out
    if (activeFilters.statuses.length > 0) {
      out.effectiveStatus = activeFilters.statuses.map((s) => STATUS_TO_EFFECTIVE[s]).join(",")
    }
    const createdRange = resolveRange(
      activeFilters.createdPreset,
      activeFilters.createdStart,
      activeFilters.createdEnd,
    )
    if (createdRange.start) out.dateFrom = createdRange.start
    if (createdRange.end) out.dateTo = createdRange.end
    const dueRange = resolveRange(
      activeFilters.duePreset,
      activeFilters.dueStart,
      activeFilters.dueEnd,
    )
    if (dueRange.start) out.dueFrom = dueRange.start
    if (dueRange.end) out.dueTo = dueRange.end
    const min = rupiahToDigits(activeFilters.minHarga)
    if (min && min !== "0") out.minTotal = min
    const max = rupiahToDigits(activeFilters.maxHarga)
    if (max && max !== "0") out.maxTotal = max
    return out
  }, [debouncedSearch, activeFilters, itemsPerPage, currentPage])

  const { data: rawList, isLoading } = useInvoices(queryParams)
  const { data: summaryData } = useInvoiceSummary()

  const currentRows: InvoiceRow[] = useMemo(() => {
    return (rawList?.rows ?? []).map(rowFromBackend).filter((r): r is InvoiceRow => r !== null)
  }, [rawList])

  const totalItems = rawList?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  const counts = {
    total: summaryData?.total ?? 0,
    DRAF: summaryData?.draft ?? 0,
    DIKIRIM: summaryData?.sent ?? 0,
    DIBAYAR: summaryData?.paid ?? 0,
    TERLAMBAT: summaryData?.overdue ?? 0,
  }

  // Active-filter chips shown above the table.
  const filterChips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = []
    if (debouncedSearch) {
      out.push({ key: "q", label: `Cari: "${debouncedSearch}"`, onRemove: () => setSearch("") })
    }
    if (activeFilters) {
      for (const s of activeFilters.statuses) {
        out.push({
          key: `status-${s}`,
          label: `Status: ${s}`,
          onRemove: () =>
            setActiveFilters((p) =>
              p ? { ...p, statuses: p.statuses.filter((x) => x !== s) } : p,
            ),
        })
      }
      if (activeFilters.createdPreset !== "semua") {
        out.push({
          key: "created",
          label: `Dibuat: ${activeFilters.createdStart} s/d ${activeFilters.createdEnd}`,
        })
      }
      if (activeFilters.duePreset !== "semua") {
        out.push({
          key: "due",
          label: `Jatuh tempo: ${activeFilters.dueStart} s/d ${activeFilters.dueEnd}`,
        })
      }
      if (activeFilters.minHarga !== "" || activeFilters.maxHarga !== "") {
        out.push({
          key: "total",
          label: `Total: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
        })
      }
    }
    return out
  }, [debouncedSearch, activeFilters])

  const clearAllFilters = () => {
    setSearch("")
    setActiveFilters(null)
    setCurrentPage(1)
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Invoice</h1>
            <div className="page-actions flex gap-2.5">
              <button
                type="button"
                className={`${ui.btnOutline} w-[160px]`}
                onClick={() => invoicesApi.exportXlsx(queryParams)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Ekspor Excel
              </button>
              <button
                type="button"
                className={`${ui.btnOutline} w-[180px]`}
                onClick={() => invoicesApi.exportCoretaxXlsx(queryParams)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Ekspor Coretax
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              variant="violet"
              label="Total Invoice"
              value={formatNumber(counts.total)}
            />
            <SummaryCard variant="gold" label="Draf" value={formatNumber(counts.DRAF)} />
            <SummaryCard variant="blue" label="Dikirim" value={formatNumber(counts.DIKIRIM)} />
            <SummaryCard variant="green" label="Dibayar" value={formatNumber(counts.DIBAYAR)} />
            <SummaryCard variant="red" label="Terlambat" value={formatNumber(counts.TERLAMBAT)} />
          </div>

          <div className="flex items-center gap-4 pt-2">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setCurrentPage(1)
              }}
              placeholder="Cari invoice, klien, atau nomor..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <ActiveFilters chips={filterChips} onClearAll={clearAllFilters} />

          <div className={ui.tableWrap}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={ui.thCenter} style={{ width: 150 }}>
                    Nomor Invoice
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Tanggal Pembuatan
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Jatuh Tempo
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Total Tagihan
                  </th>
                  <th className={ui.thCenter} style={{ width: 130 }}>
                    Status
                  </th>
                  <th className={ui.thCenter} style={{ width: 100 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-dark-500">
                      Memuat data…
                    </td>
                  </tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-dark-500">
                      Belum ada Invoice. Invoice dibuat otomatis ketika status PO menjadi Dikirim.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((row) => {
                    const style = INVOICE_STATUS_STYLE[row.status]
                    return (
                      <tr key={row.quotationId} className={ui.tr}>
                        <td className={`${ui.tdCenter} font-bold text-[#630ED4]`}>
                          {row.invoiceNo}
                        </td>
                        <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>
                          {row.client}
                        </td>
                        <td className={ui.tdCenter}>{formatDate(row.createdAt)}</td>
                        <td className={ui.tdCenter}>{formatDate(row.dueDate)}</td>
                        <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>{row.total}</td>
                        <td className={ui.tdCenter}>
                          <StatusBadge bg={style.bg} color={style.color}>
                            {INVOICE_LABEL[row.status]}
                          </StatusBadge>
                        </td>
                        <td className="px-2 py-3 text-center align-middle text-sm text-[#4A4455]">
                          <div className="inline-flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              title="Lihat detail"
                              className={actionBtn}
                              onClick={() => onViewDetail?.(row.quotationId)}
                            >
                              <EyeIcon size={18} />
                            </button>
                            <button
                              type="button"
                              title="Unduh invoice"
                              className={actionBtn}
                              onClick={() =>
                                downloadPdf(`/invoices/${row.id}/pdf`, `${row.invoiceNo}.pdf`)
                              }
                            >
                              <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              title="Unduh Coretax XML"
                              className={actionBtn}
                              onClick={() =>
                                downloadXml(
                                  `/invoices/${row.id}/coretax.xml`,
                                  `${row.invoiceNo}.coretax.xml`,
                                )
                              }
                            >
                              <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <path d="m9 13 2 2 4-4" />
                              </svg>
                            </button>
                          </div>
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
              resourceLabel="Invoice"
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
        <InvoiceFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={(f) => {
            setActiveFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

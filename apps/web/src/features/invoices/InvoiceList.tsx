import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import ActiveFilters, { type FilterChip } from "@/components/shared/ActiveFilters"
import EntityLink from "@/components/shared/EntityLink"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { downloadPdf, downloadXml } from "@/lib/api-client"
import { formatDate, formatNumber, PENDING_FIGURE } from "@/lib/format"
import { emptyListText } from "@/lib/list-empty"
import { ui } from "@/lib/ui"
import { useListScreen, usePageWithin } from "@/lib/useListScreen"
import * as invoicesApi from "./api"
import { runDownload, safeFileName } from "./download"
import { useInvoiceSummary, useInvoices } from "./hooks"
import InvoiceFilter, { type InvoiceFilterValues } from "./InvoiceFilter"
import { canExportCoretax, detailSearch, invoiceListParams, rowFromBackend } from "./list"
import type { InvoiceRow } from "./types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "./types"

type InvoiceListProps = {
  // Cancelled rows name themselves
  onViewDetail?: (quotationId: number, search: { invoiceId?: number }) => void
}

export default function InvoiceList({ onViewDetail }: InvoiceListProps) {
  const [showFilter, setShowFilter] = useState(false)

  const list = useListScreen<InvoiceFilterValues | null>(null)
  const { debouncedSearch, filters: activeFilters, itemsPerPage, startIndex } = list
  const { clearSearch, patchFilters } = list

  const queryParams = useMemo(
    () => invoiceListParams(debouncedSearch, activeFilters, itemsPerPage, startIndex),
    [debouncedSearch, activeFilters, itemsPerPage, startIndex],
  )

  const { data: rawList, isLoading } = useInvoices(queryParams)
  const { data: summaryData } = useInvoiceSummary()

  const currentRows: InvoiceRow[] = useMemo(() => {
    return (rawList?.rows ?? []).map(rowFromBackend)
  }, [rawList])

  const totalItems = rawList?.total ?? 0
  usePageWithin(list, rawList?.total)
  const totalPages = list.totalPagesOf(totalItems)

  const counts = {
    total: summaryData?.total,
    DRAF: summaryData?.draft,
    DIKIRIM: summaryData?.sent,
    DIBAYAR: summaryData?.paid,
    TERLAMBAT: summaryData?.overdue,
  }

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
          label: `Status: ${INVOICE_LABEL[s]}`,
          onRemove: () =>
            patchFilters((p) => (p ? { ...p, statuses: p.statuses.filter((x) => x !== s) } : p)),
        })
      }
      if (activeFilters.createdPreset !== "semua") {
        out.push({
          key: "created",
          label: `Dibuat: ${activeFilters.createdStart} s/d ${activeFilters.createdEnd}`,
          onRemove: () => patchFilters((p) => (p ? { ...p, createdPreset: "semua" } : p)),
        })
      }
      if (activeFilters.duePreset !== "semua") {
        out.push({
          key: "due",
          label: `Jatuh tempo: ${activeFilters.dueStart} s/d ${activeFilters.dueEnd}`,
          onRemove: () => patchFilters((p) => (p ? { ...p, duePreset: "semua" } : p)),
        })
      }
      if (activeFilters.minHarga !== "" || activeFilters.maxHarga !== "") {
        out.push({
          key: "total",
          label: `Total: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
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

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Daftar Invoice</h1>
          <div className={ui.pageActionsTight}>
            <button
              type="button"
              className={`${ui.btnOutline} w-[160px]`}
              onClick={() =>
                runDownload(() => invoicesApi.exportXlsx(queryParams), "Gagal mengekspor Excel.")
              }
            >
              <svg
                aria-hidden="true"
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
              onClick={() =>
                runDownload(
                  () => invoicesApi.exportCoretaxXlsx(queryParams),
                  "Gagal mengekspor Coretax.",
                )
              }
            >
              <svg
                aria-hidden="true"
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
          <StatCard
            tone="violet"
            label="Total Invoice"
            value={formatNumber(counts.total, PENDING_FIGURE)}
          />
          <StatCard tone="gold" label="Draf" value={formatNumber(counts.DRAF, PENDING_FIGURE)} />
          <StatCard
            tone="blue"
            label="Dikirim"
            value={formatNumber(counts.DIKIRIM, PENDING_FIGURE)}
          />
          <StatCard
            tone="green"
            label="Dibayar"
            value={formatNumber(counts.DIBAYAR, PENDING_FIGURE)}
          />
          <StatCard
            tone="red"
            label="Terlambat"
            value={formatNumber(counts.TERLAMBAT, PENDING_FIGURE)}
          />
        </div>

        <div className="flex items-center gap-4 pt-2">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Cari invoice, klien, atau nomor..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        <ActiveFilters chips={filterChips} onClearAll={clearAllFilters} />

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[150px]`}>Nomor Invoice</th>
                <th className={`${ui.thCenter} w-[200px]`}>Nama Klien</th>
                <th className={`${ui.thCenter} w-[160px]`}>Tanggal Pembuatan</th>
                <th className={`${ui.thCenter} w-[140px]`}>Jatuh Tempo</th>
                <th className={`${ui.thCenter} w-[160px]`}>Total Tagihan</th>
                <th className={`${ui.thCenter} w-[130px]`}>Status</th>
                <th className={`${ui.thCenter} w-[100px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableLoadingRow colSpan={7} />}
              {!isLoading && currentRows.length === 0 && (
                <TableEmptyRow colSpan={7}>
                  {emptyListText(
                    list,
                    "Belum ada Invoice. Invoice dibuat otomatis ketika status PO menjadi Dikirim.",
                  )}
                </TableEmptyRow>
              )}
              {!isLoading &&
                currentRows.map((row) => {
                  const style = INVOICE_STATUS_STYLE[row.status]
                  return (
                    <tr key={row.id} className={ui.tr}>
                      <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                        {row.status === "DIBATALKAN" ? (
                          <Link
                            to="/invoices/$id"
                            params={{ id: String(row.quotationId) }}
                            search={detailSearch(row)}
                            className={ui.entityLink}
                          >
                            {row.invoiceNo}
                          </Link>
                        ) : (
                          <EntityLink kind="invoice" quotationId={row.quotationId}>
                            {row.invoiceNo}
                          </EntityLink>
                        )}
                      </td>
                      <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>
                        <EntityLink kind="client" id={row.companyClientId} tone="name">
                          {row.client}
                        </EntityLink>
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
                            aria-label={`Lihat detail ${row.invoiceNo}`}
                            className={ui.iconAction}
                            onClick={() => onViewDetail?.(row.quotationId, detailSearch(row))}
                          >
                            <EyeIcon size={18} />
                          </button>
                          <button
                            type="button"
                            title="Unduh invoice"
                            aria-label={`Unduh invoice ${row.invoiceNo}`}
                            className={ui.iconAction}
                            onClick={() =>
                              runDownload(
                                () =>
                                  downloadPdf(
                                    `/invoices/${row.id}/pdf`,
                                    `${safeFileName(row.invoiceNo)}.pdf`,
                                  ),
                                "Gagal mengunduh PDF invoice.",
                              )
                            }
                          >
                            <svg
                              aria-hidden="true"
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
                          {canExportCoretax(row) && (
                            <button
                              type="button"
                              title="Unduh Coretax XML"
                              aria-label={`Unduh Coretax XML ${row.invoiceNo}`}
                              className={ui.iconAction}
                              onClick={() =>
                                runDownload(
                                  () =>
                                    downloadXml(
                                      `/invoices/${row.id}/coretax.xml`,
                                      `${safeFileName(row.invoiceNo)}.coretax.xml`,
                                    ),
                                  "Gagal mengunduh XML Coretax.",
                                )
                              }
                            >
                              <svg
                                aria-hidden="true"
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
                          )}
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
            currentPage={list.currentPage}
            totalPages={totalPages}
            resourceLabel="Invoice"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
            isLoading={isLoading}
          />
        </div>
      </div>

      {showFilter && (
        <InvoiceFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={list.applyFilters}
        />
      )}
    </>
  )
}

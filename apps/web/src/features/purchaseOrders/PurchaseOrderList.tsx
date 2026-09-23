import { useMemo, useState } from "react"
import ActiveFilters, { type FilterChip } from "@/components/shared/ActiveFilters"
import EntityLink from "@/components/shared/EntityLink"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { downloadPdf } from "@/lib/api-client"
import { resolveRange } from "@/lib/date-range"
import { formatDate } from "@/lib/format"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import { poRowFromBackend } from "./adapters"
import * as purchaseOrdersApi from "./api"
import { usePurchaseOrders, useSavePoUpload } from "./hooks"
import {
  canDownloadDeliveryNote,
  deliveryNoteFileName,
  PO_LABEL,
  PO_STATUS_CONFIG,
  shortDocNo,
} from "./PurchaseOrderDetail/helpers"
import PurchaseOrderFilter, { type PoFilterValues } from "./PurchaseOrderFilter"
import type { PoRow } from "./types"
import UploadPoModal from "./UploadPoModal"

type PurchaseOrderListProps = {
  onViewDetail?: (quotationId: number) => void
}

export default function PurchaseOrderList({ onViewDetail }: PurchaseOrderListProps) {
  const uploadSave = useSavePoUpload()

  // By PO id, so a refetch refreshes the modal row.
  const [uploadPoId, setUploadPoId] = useState<number | null>(null)
  const [showFilter, setShowFilter] = useState(false)

  const list = useListScreen<PoFilterValues | null>(null)
  const { debouncedSearch, filters: activeFilters, itemsPerPage, startIndex } = list
  const { clearSearch, patchFilters } = list

  const queryParams = useMemo(() => {
    const out: Parameters<typeof usePurchaseOrders>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: startIndex,
      sortBy: "poDate",
      sortDir: "desc",
    }
    if (!activeFilters) return out
    if (activeFilters.statuses.length > 0) {
      out.status = activeFilters.statuses.join(",")
    }
    const range = resolveRange(activeFilters.preset, activeFilters.startDate, activeFilters.endDate)
    if (range.start) out.dateFrom = range.start
    if (range.end) out.dateTo = range.end
    const min = activeFilters.minHarga.replace(/\D/g, "")
    if (min && min !== "0") out.minTotal = min
    const max = activeFilters.maxHarga.replace(/\D/g, "")
    if (max && max !== "0") out.maxTotal = max
    return out
  }, [debouncedSearch, activeFilters, itemsPerPage, startIndex])

  const { data: rawList, isLoading } = usePurchaseOrders(queryParams)

  const currentRows: PoRow[] = useMemo(() => (rawList?.rows ?? []).map(poRowFromBackend), [rawList])
  const uploadRow = currentRows.find((r) => r.id === uploadPoId)

  const totalItems = rawList?.total ?? 0
  const totalPages = list.totalPagesOf(totalItems)

  async function handleUploadSubmit(
    file: File | null,
    details: { poNumber: string; poDate: string },
  ) {
    if (!uploadRow) return
    if (await uploadSave.save(uploadRow, file, details)) setUploadPoId(null)
  }

  async function handleDownloadDN(row: PoRow) {
    if (!row.deliveryNoteNumber) return
    try {
      await downloadPdf(
        `/purchase-orders/${row.id}/delivery-note.pdf`,
        deliveryNoteFileName(row.deliveryNoteNumber),
      )
    } catch {
      toast.error("Gagal mengunduh Surat Jalan.")
    }
  }

  async function handleExport() {
    try {
      await purchaseOrdersApi.exportXlsx(queryParams)
    } catch {
      toast.error("Gagal mengekspor data Purchase Order.")
    }
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
          label: `Status: ${PO_LABEL[s]}`,
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
          key: "total",
          label: `Total: ${activeFilters.minHarga || "0"} - ${activeFilters.maxHarga || "tanpa batas"}`,
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
          <h1 className={ui.pageTitle}>Daftar Purchase Order</h1>
          <div className={ui.pageActionsTight}>
            <button
              type="button"
              className={`${ui.btnOutline} min-w-[160px] whitespace-nowrap`}
              onClick={() => void handleExport()}
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
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Ekspor Excel
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Cari purchase order, klien, atau nomor..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        <ActiveFilters chips={filterChips} onClearAll={clearAllFilters} />

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[140px]`}>Nomor Quotation</th>
                <th className={`${ui.thCenter} w-[130px]`}>Nomor PO</th>
                <th className={`${ui.thCenter} w-[200px]`}>Nama Klien</th>
                <th className={`${ui.thCenter} w-[160px]`}>Tanggal PO</th>
                <th className={`${ui.thCenter} w-[150px]`}>Total PO</th>
                <th className={`${ui.thCenter} w-[150px]`}>Status</th>
                <th className={`${ui.thCenter} w-[110px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableLoadingRow colSpan={7} />}
              {!isLoading && currentRows.length === 0 && (
                <TableEmptyRow colSpan={7}>
                  Belum ada Purchase Order. PO terbuat otomatis ketika quotation disetujui.
                </TableEmptyRow>
              )}
              {!isLoading &&
                currentRows.map((row) => {
                  const status = PO_STATUS_CONFIG[row.status]
                  const dnReady = canDownloadDeliveryNote(row)
                  return (
                    <tr key={row.quotationId} className={ui.tr}>
                      <td className={`${ui.tdCenter} font-bold`} title={row.quotationNo}>
                        <EntityLink kind="quotation" id={row.quotationId}>
                          {shortDocNo(row.quotationNo)}
                        </EntityLink>
                      </td>
                      <td className={`${ui.tdCenter} font-bold`} title={row.poNumber}>
                        <EntityLink kind="purchaseOrder" quotationId={row.quotationId}>
                          {shortDocNo(row.poNumber)}
                        </EntityLink>
                      </td>
                      <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>
                        <EntityLink kind="client" id={row.companyClientId} tone="name">
                          {row.client}
                        </EntityLink>
                      </td>
                      <td className={ui.tdCenter}>{formatDate(row.date)}</td>
                      <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>{row.total}</td>
                      <td className={ui.tdCenter}>
                        <StatusBadge bg={status.bg} color={status.color}>
                          {PO_LABEL[row.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-2 py-3 text-center align-middle text-sm text-[#4A4455]">
                        <div className="inline-flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            title="Lihat detail"
                            aria-label={`Lihat detail ${row.poNumber}`}
                            className={ui.iconAction}
                            onClick={() => onViewDetail?.(row.quotationId)}
                          >
                            <EyeIcon size={18} />
                          </button>
                          <button
                            type="button"
                            title="Unggah berkas PO"
                            aria-label={`Unggah berkas PO ${row.poNumber}`}
                            className={ui.iconAction}
                            onClick={() => setUploadPoId(row.id)}
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
                              aria-hidden="true"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title={
                              dnReady
                                ? "Unduh Surat Jalan"
                                : "Surat Jalan tersedia setelah status Dalam Progres"
                            }
                            aria-label={`Unduh Surat Jalan ${row.poNumber}`}
                            disabled={!dnReady}
                            className={
                              dnReady
                                ? ui.iconAction
                                : "inline-flex cursor-default items-center rounded-sm p-1 text-dark-300"
                            }
                            onClick={() => dnReady && void handleDownloadDN(row)}
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
                              aria-hidden="true"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
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
            currentPage={list.currentPage}
            totalPages={totalPages}
            resourceLabel="Purchase Order"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
            isLoading={isLoading}
          />
        </div>
      </div>

      {uploadRow && (
        <UploadPoModal
          row={uploadRow}
          hasExistingFile={Boolean(uploadRow.objectKey && uploadRow.fileName)}
          submitting={uploadSave.isPending}
          onClose={() => setUploadPoId(null)}
          onSubmit={(file, details) => void handleUploadSubmit(file, details)}
        />
      )}

      {showFilter && (
        <PurchaseOrderFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={list.applyFilters}
        />
      )}
    </>
  )
}

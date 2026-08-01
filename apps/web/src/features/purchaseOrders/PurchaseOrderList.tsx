import { useMemo, useState } from "react"
import ActiveFilters, { type FilterChip } from "@/components/shared/ActiveFilters"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { downloadPdf } from "@/lib/api-client"
import { resolveRange } from "@/lib/date-range"
import { formatDate, formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { PurchaseOrderRow } from "@/types/api"
import * as purchaseOrdersApi from "./api"
import { usePurchaseOrders, useUpdatePoDetails, useUploadPoFile } from "./hooks"
import { PO_LABEL, shortDocNo } from "./PurchaseOrderDetail/helpers"
import PurchaseOrderFilter, { type PoFilterValues } from "./PurchaseOrderFilter"
import type { PoRow, PoStatus } from "./types"
import UploadPoModal from "./UploadPoModal"

interface PurchaseOrderListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (quotationId: number) => void
  onViewQuotation?: (quotationId: number) => void
}

const STATUS_STYLE: Record<PoStatus, { bg: string; color: string }> = {
  PENDING: { bg: "#FFE16D", color: "#DA6900" },
  UPLOADED: { bg: "#DBEAFE", color: "#1D4ED8" },
  ON_PROGRESS: { bg: "#CEC2FF", color: "#9333EA" },
  DELIVERED: { bg: "#D1FAE5", color: "#047857" },
}

function rowFromBackend(po: PurchaseOrderRow): PoRow {
  return {
    id: po.id,
    quotationId: po.quotationId,
    quotationNo: po.quotationNo,
    poNumber: po.poNumber,
    poDate: po.poDate.slice(0, 10),
    client: po.companyName,
    date: po.poDate,
    total: formatRupiah(po.quotationTotal),
    status: po.status,
    fileName: po.fileName,
    objectKey: po.objectKey,
  }
}

// Table action icon button (eye, upload, delivery note).
const iconBtn =
  "inline-flex items-center justify-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"

export default function PurchaseOrderList({
  onNavigate,
  onLogout,
  onViewDetail,
  onViewQuotation,
}: PurchaseOrderListProps) {
  const uploadFile = useUploadPoFile()
  const updateDetails = useUpdatePoDetails()

  const [uploadTarget, setUploadTarget] = useState<{ row: PoRow; poId: number } | null>(null)
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

  const backend = useMemo(() => rawList?.rows ?? [], [rawList])
  const currentRows: PoRow[] = useMemo(() => backend.map(rowFromBackend), [backend])

  const totalItems = rawList?.total ?? 0
  const totalPages = list.totalPagesOf(totalItems)

  function poIdFor(quotationId: number): number | undefined {
    return backend.find((p) => p.quotationId === quotationId)?.id
  }

  function openUpload(row: PoRow) {
    const poId = poIdFor(row.quotationId)
    if (!poId) return
    setUploadTarget({ row, poId })
  }

  function handleUploadSubmit(file: File | null, details: { poNumber: string; poDate: string }) {
    if (!uploadTarget) return
    // Edit details only when no new file.
    if (!file) {
      updateDetails.mutate(
        { id: uploadTarget.poId, ...details },
        { onSuccess: () => setUploadTarget(null) },
      )
      return
    }
    uploadFile.mutate(
      { id: uploadTarget.poId, file },
      {
        onSuccess: () => {
          updateDetails.mutate(
            { id: uploadTarget.poId, ...details },
            { onSuccess: () => setUploadTarget(null) },
          )
        },
      },
    )
  }

  async function handleDownloadDN(row: PoRow) {
    const poId = poIdFor(row.quotationId)
    if (!poId) return
    // Match the in-document DN number.
    const base = (row.quotationNo.replace(/^Q-/, "") || row.poNumber).replace(
      /[^A-Za-z0-9._-]/g,
      "_",
    )
    await downloadPdf(`/purchase-orders/${poId}/delivery-note.pdf`, `DN-${base}.pdf`)
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
    <div className="admin-shell">
      <Sidebar activePage={"purchase-orders" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Purchase Order</h1>
            <div className="page-actions flex gap-2.5">
              <button
                type="button"
                className={`${ui.btnOutline} w-[160px]`}
                onClick={() => purchaseOrdersApi.exportXlsx(queryParams)}
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
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Nomor Quotation
                  </th>
                  <th className={ui.thCenter} style={{ width: 130 }}>
                    Nomor PO
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Tanggal Pembuatan
                  </th>
                  <th className={ui.thCenter} style={{ width: 150 }}>
                    Total PO
                  </th>
                  <th className={ui.thCenter} style={{ width: 150 }}>
                    Status
                  </th>
                  <th className={ui.thCenter} style={{ width: 110 }}>
                    Aksi
                  </th>
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
                    const status = STATUS_STYLE[row.status]
                    return (
                      <tr key={row.quotationId} className={ui.tr}>
                        <td
                          className={`${ui.tdCenter} font-bold text-primary-700`}
                          title={row.quotationNo}
                        >
                          {onViewQuotation ? (
                            <button
                              type="button"
                              onClick={() => onViewQuotation(row.quotationId)}
                              className="p-0 text-sm font-bold text-primary-700 underline decoration-[rgba(99,14,212,0.35)] underline-offset-[3px]"
                            >
                              {shortDocNo(row.quotationNo)}
                            </button>
                          ) : (
                            shortDocNo(row.quotationNo)
                          )}
                        </td>
                        <td
                          className={`${ui.tdCenter} font-bold text-primary-700`}
                          title={row.poNumber}
                        >
                          {shortDocNo(row.poNumber)}
                        </td>
                        <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>
                          {row.client}
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
                              className={iconBtn}
                              onClick={() => onViewDetail?.(row.quotationId)}
                            >
                              <EyeIcon size={18} />
                            </button>
                            <button
                              type="button"
                              title="Upload berkas PO"
                              className={iconBtn}
                              onClick={() => openUpload(row)}
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
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                            </button>
                            {(() => {
                              const canDownloadDN =
                                row.status === "ON_PROGRESS" || row.status === "DELIVERED"
                              return (
                                <button
                                  type="button"
                                  title={
                                    canDownloadDN
                                      ? "Unduh delivery note"
                                      : "Delivery note tersedia ketika status ON PROGRESS"
                                  }
                                  disabled={!canDownloadDN}
                                  className={
                                    canDownloadDN
                                      ? iconBtn
                                      : "inline-flex cursor-default items-center justify-center rounded-sm p-1 text-dark-300"
                                  }
                                  onClick={() => canDownloadDN && handleDownloadDN(row)}
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
                              )
                            })()}
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
            />
          </div>
        </div>
      </div>

      {uploadTarget && (
        <UploadPoModal
          row={uploadTarget.row}
          hasExistingFile={Boolean(uploadTarget.row.objectKey && uploadTarget.row.fileName)}
          onClose={() => setUploadTarget(null)}
          onSubmit={handleUploadSubmit}
        />
      )}

      {showFilter && (
        <PurchaseOrderFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={list.applyFilters}
        />
      )}
    </div>
  )
}

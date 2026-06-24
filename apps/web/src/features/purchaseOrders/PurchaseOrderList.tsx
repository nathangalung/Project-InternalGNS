import { type CSSProperties, useMemo, useState } from "react"
import ActiveFilters, { type FilterChip } from "@/components/shared/ActiveFilters"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { downloadPdf } from "@/lib/api-client"
import { resolveRange } from "@/lib/date-range"
import { formatDate, formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import type { PurchaseOrderRow } from "@/types/api"
import * as purchaseOrdersApi from "./api"
import { usePurchaseOrders, useUploadPoFile } from "./hooks"
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
    quotationId: po.quotationId,
    quotationNo: po.quotationNo,
    poNumber: po.poNumber,
    client: po.companyName,
    date: po.poDate,
    total: formatRupiah(po.quotationTotal),
    status: po.status,
    fileName: po.fileName,
    objectKey: po.objectKey,
  }
}

const iconBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "4px",
  color: "#630ED4",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "6px",
  transition: "background 0.15s",
}

export default function PurchaseOrderList({
  onNavigate,
  onLogout,
  onViewDetail,
  onViewQuotation,
}: PurchaseOrderListProps) {
  const uploadFile = useUploadPoFile()

  const [search, setSearch] = useState("")
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [uploadTarget, setUploadTarget] = useState<{ row: PoRow; poId: number } | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [activeFilters, setActiveFilters] = useState<PoFilterValues | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryParams = useMemo(() => {
    const out: Parameters<typeof usePurchaseOrders>[0] = {
      q: debouncedSearch || undefined,
      limit: itemsPerPage,
      offset: (currentPage - 1) * itemsPerPage,
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
  }, [debouncedSearch, activeFilters, itemsPerPage, currentPage])

  const { data: rawList, isLoading } = usePurchaseOrders(queryParams)

  const backend = useMemo(() => rawList?.rows ?? [], [rawList])
  const currentRows: PoRow[] = useMemo(() => backend.map(rowFromBackend), [backend])

  const totalItems = rawList?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  function poIdFor(quotationId: number): number | undefined {
    return backend.find((p) => p.quotationId === quotationId)?.id
  }

  function openUpload(row: PoRow) {
    const poId = poIdFor(row.quotationId)
    if (!poId) return
    setUploadTarget({ row, poId })
  }

  function handleUploadSubmit(file: File) {
    if (!uploadTarget) return
    uploadFile.mutate({ id: uploadTarget.poId, file }, { onSuccess: () => setUploadTarget(null) })
  }

  async function handleDownloadDN(row: PoRow) {
    const poId = poIdFor(row.quotationId)
    if (!poId) return
    // Match the in-document DN number ("DN-" + quotation no without "Q-").
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
      out.push({ key: "q", label: `Cari: "${debouncedSearch}"`, onRemove: () => setSearch("") })
    }
    if (activeFilters) {
      for (const s of activeFilters.statuses) {
        out.push({
          key: `status-${s}`,
          label: `Status: ${PO_LABEL[s]}`,
          onRemove: () =>
            setActiveFilters((p) =>
              p ? { ...p, statuses: p.statuses.filter((x) => x !== s) } : p,
            ),
        })
      }
      if (activeFilters.preset !== "30-hari") {
        out.push({
          key: "date",
          label: `Tanggal: ${activeFilters.startDate} s/d ${activeFilters.endDate}`,
        })
      }
      if (activeFilters.minHarga !== "0" || activeFilters.maxHarga !== "500.000.000") {
        out.push({
          key: "total",
          label: `Total: ${activeFilters.minHarga} – ${activeFilters.maxHarga}`,
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
      <Sidebar activePage={"purchase-orders" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Purchase Order</h1>
            <div className="page-actions" style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                className="btn-admin-outline"
                onClick={() => purchaseOrdersApi.exportXlsx(queryParams)}
                style={{ width: "160px", justifyContent: "center" }}
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

          <div className="search-row">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setCurrentPage(1)
              }}
              placeholder="Cari purchase order, klien, atau nomor..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <ActiveFilters chips={filterChips} onClearAll={clearAllFilters} />

          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Nomor Quotation
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>
                    Nomor PO
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Tanggal Pembuatan
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>
                    Total Harga
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>
                    Status
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 110 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={7}
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
                      colSpan={7}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Belum ada Purchase Order. PO terbuat otomatis ketika quotation disetujui.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((row) => {
                    const status = STATUS_STYLE[row.status]
                    return (
                      <tr key={row.quotationId} className="tbl-row">
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#630ED4" }}
                          title={row.quotationNo}
                        >
                          {onViewQuotation ? (
                            <button
                              type="button"
                              onClick={() => onViewQuotation(row.quotationId)}
                              style={{
                                background: "transparent",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                color: "inherit",
                                fontWeight: "inherit",
                                fontFamily: "inherit",
                                fontSize: "inherit",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
                                textDecorationColor: "rgba(99, 14, 212, 0.35)",
                              }}
                            >
                              {shortDocNo(row.quotationNo)}
                            </button>
                          ) : (
                            shortDocNo(row.quotationNo)
                          )}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#630ED4" }}
                          title={row.poNumber}
                        >
                          {shortDocNo(row.poNumber)}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#191C1E", fontWeight: 500 }}
                        >
                          {row.client}
                        </td>
                        <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                          {formatDate(row.date)}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {row.total}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <StatusBadge bg={status.bg} color={status.color}>
                            {PO_LABEL[row.status]}
                          </StatusBadge>
                        </td>
                        <td className="tbl-td tbl-td--center" style={{ padding: "12px 8px" }}>
                          <div
                            style={{
                              display: "inline-flex",
                              gap: "2px",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <button
                              type="button"
                              title="Lihat detail"
                              style={iconBtnStyle}
                              onClick={() => onViewDetail?.(row.quotationId)}
                            >
                              <EyeIcon size={18} />
                            </button>
                            <button
                              type="button"
                              title="Upload berkas PO"
                              style={iconBtnStyle}
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
                                  style={{
                                    ...iconBtnStyle,
                                    color: canDownloadDN ? "#630ED4" : "#CBD5E1",
                                    cursor: canDownloadDN ? "pointer" : "default",
                                  }}
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
              currentPage={currentPage}
              totalPages={totalPages}
              resourceLabel="Purchase Order"
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {uploadTarget && (
        <UploadPoModal
          row={uploadTarget.row}
          onClose={() => setUploadTarget(null)}
          onSubmit={handleUploadSubmit}
        />
      )}

      {showFilter && (
        <PurchaseOrderFilter
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

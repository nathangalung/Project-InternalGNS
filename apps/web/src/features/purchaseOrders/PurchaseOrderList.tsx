import { useEffect, useMemo, useState, type CSSProperties } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import Pagination from "@/components/shared/Pagination"
import UploadPoModal from "./UploadPoModal"
import PurchaseOrderFilter, { type PoFilterValues } from "./PurchaseOrderFilter"
import { usePurchaseOrders, useUpdatePoFile } from "./hooks"
import { PO_LABEL, shortDocNo } from "./PurchaseOrderDetail/helpers"
import type { PoRow, PoStatus } from "./types"
import type { PurchaseOrderRow } from "@/types/api"

interface PurchaseOrderListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (quotationId: number) => void
}

const STATUS_STYLE: Record<PoStatus, { bg: string; color: string }> = {
  PENDING:     { bg: "#FFE16D", color: "#DA6900" },
  UPLOADED:    { bg: "#DBEAFE", color: "#1D4ED8" },
  ON_PROGRESS: { bg: "#CEC2FF", color: "#9333EA" },
  DELIVERED:   { bg: "#D1FAE5", color: "#047857" },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
}

function formatRp(s: string | undefined): string {
  if (!s) return "Rp0"
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return "Rp" + n.toLocaleString("id-ID")
}

function rowFromBackend(po: PurchaseOrderRow): PoRow {
  return {
    quotationId: po.quotationId,
    quotationNo: po.quotationNo,
    poNumber: po.poNumber,
    client: po.companyName,
    date: po.poDate,
    total: formatRp(po.quotationTotal),
    status: po.status,
    fileName: po.fileName,
    fileDataUrl: po.fileUrl,
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

export default function PurchaseOrderList({ onNavigate, onLogout, onViewDetail }: PurchaseOrderListProps) {
  const { data: rawList, isLoading } = usePurchaseOrders({ limit: 200 })
  const updateFile = useUpdatePoFile()

  const [search, setSearch] = useState("")
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [uploadTarget, setUploadTarget] = useState<{ row: PoRow; poId: number } | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [activeFilters, setActiveFilters] = useState<PoFilterValues | null>(null)

  const backend = useMemo(() => rawList ?? [], [rawList])
  const allRows: PoRow[] = useMemo(() => backend.map(rowFromBackend), [backend])

  const filtered = useMemo(() => {
    let rows = allRows

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        r.quotationNo.toLowerCase().includes(q) ||
        r.poNumber.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q),
      )
    }

    if (activeFilters) {
      if (activeFilters.statuses.length > 0) {
        rows = rows.filter(r => activeFilters.statuses.includes(r.status))
      }

      {
        let start: Date | null = null
        let end: Date | null = null
        if (activeFilters.preset === "kustom") {
          if (activeFilters.startDate) { start = new Date(activeFilters.startDate); start.setHours(0, 0, 0, 0) }
          if (activeFilters.endDate)   { end   = new Date(activeFilters.endDate);   end.setHours(23, 59, 59, 999) }
        } else {
          end = new Date(); end.setHours(23, 59, 59, 999)
          start = new Date(); start.setHours(0, 0, 0, 0)
          if (activeFilters.preset === "7-hari")  start.setDate(start.getDate() - 7)
          if (activeFilters.preset === "30-hari") start.setDate(start.getDate() - 30)
        }
        rows = rows.filter(r => {
          const d = new Date(r.date)
          if (start && d < start) return false
          if (end   && d > end)   return false
          return true
        })
      }

      const min = parseInt(activeFilters.minHarga.replace(/\./g, "")) || 0
      const max = parseInt(activeFilters.maxHarga.replace(/\./g, "")) || Infinity
      rows = rows.filter(r => {
        const total = parseInt(r.total.replace(/[^0-9]/g, ""))
        return total >= min && total <= max
      })
    }

    return rows
  }, [allRows, search, activeFilters])

  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentRows = filtered.slice(startIndex, startIndex + itemsPerPage)

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1)
  }, [totalPages, currentPage])

  function poIdFor(quotationId: number): number | undefined {
    return backend.find(p => p.quotationId === quotationId)?.id
  }

  function openUpload(row: PoRow) {
    const poId = poIdFor(row.quotationId)
    if (!poId) return
    setUploadTarget({ row, poId })
  }

  function handleUploadSubmit(file: { name: string; size: number; dataUrl: string }) {
    if (!uploadTarget) return
    updateFile.mutate(
      { id: uploadTarget.poId, payload: { fileName: file.name, fileSize: file.size, fileUrl: file.dataUrl } },
      { onSuccess: () => setUploadTarget(null) },
    )
  }

  function handleDownload(row: PoRow) {
    if (!row.fileDataUrl || !row.fileName) return
    const a = document.createElement("a")
    a.href = row.fileDataUrl
    a.download = row.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"purchase-orders" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>

          <div className="page-header">
            <h1 className="page-title">Daftar Purchase Order</h1>
            <div className="page-actions" style={{ display: "flex", gap: "10px" }}>
              <button type="button" className="btn-admin-outline" style={{ width: "160px", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Ekspor PDF
              </button>
            </div>
          </div>

          <div className="search-row">
            <div className="search-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="search-input"
                placeholder="Cari purchase order, klien, atau nomor..."
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
              />
            </div>
            <button className="btn-admin-filter" onClick={() => setShowFilter(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="10" y1="18" x2="14" y2="18" />
              </svg>
              Filter
            </button>
          </div>

          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Nomor Quotation</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>Nomor PO</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Nama Klien</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Tanggal Pembuatan</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Total Harga</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Status</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 110 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Memuat data…</td></tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr><td colSpan={7} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>
                    Belum ada Purchase Order. PO terbuat otomatis ketika quotation disetujui.
                  </td></tr>
                )}
                {!isLoading && currentRows.map(row => {
                  const status = STATUS_STYLE[row.status]
                  return (
                    <tr key={row.quotationId} className="tbl-row">
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#630ED4" }} title={row.quotationNo}>
                        {shortDocNo(row.quotationNo)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#630ED4" }} title={row.poNumber}>
                        {shortDocNo(row.poNumber)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#191C1E", fontWeight: 500 }}>
                        {row.client}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {formatDate(row.date)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#191C1E" }}>
                        {row.total}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: status.bg, color: status.color }}>
                          {PO_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ padding: "12px 8px" }}>
                        <div style={{ display: "inline-flex", gap: "2px", alignItems: "center", justifyContent: "center" }}>
                          <button
                            type="button"
                            title="Lihat detail"
                            style={iconBtnStyle}
                            onClick={() => onViewDetail?.(row.quotationId)}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Upload berkas PO"
                            style={iconBtnStyle}
                            onClick={() => openUpload(row)}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </button>
                          {(() => {
                            const canDownloadDN = row.status === "ON_PROGRESS" || row.status === "DELIVERED"
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
                                onClick={() => canDownloadDN && handleDownload(row)}
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              onItemsPerPage={n => { setItemsPerPage(n); setCurrentPage(1) }}
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
          onApply={f => {
            setActiveFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

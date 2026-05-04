import { useEffect, useMemo, useState, type CSSProperties } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import Pagination from "@/components/shared/Pagination"
import InvoiceFilter, { type InvoiceFilterValues } from "./InvoiceFilter"
import { useInvoices, useInvoiceSummary } from "./hooks"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "./types"
import type { InvoiceRow, InvoiceStatus } from "./types"
import type { InvoiceBackendRow } from "@/types/api"

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

function formatRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID")
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
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
    quotationId: inv.quotationId,
    invoiceNo: inv.invoiceNo,
    client: inv.companyName,
    createdAt: inv.invoiceDate,
    dueDate: inv.dueDate ?? inv.invoiceDate,
    total: formatRp(totalNumber),
    totalNumber,
    status,
  }
}

const exportBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 24px",
  height: "42px",
  border: "1px solid rgba(99, 14, 212, 0.2)",
  borderRadius: "8px",
  background: "#FFFFFF",
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif",
  fontWeight: 700,
  fontSize: "14px",
  color: "#630ED4",
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

export default function InvoiceList({ onNavigate, onLogout, onViewDetail }: InvoiceListProps) {
  const { data: rawList, isLoading } = useInvoices({ limit: 200 })
  const { data: summaryData } = useInvoiceSummary()

  const allRows: InvoiceRow[] = useMemo(() => {
    return (rawList ?? [])
      .map(rowFromBackend)
      .filter((r): r is InvoiceRow => r !== null)
  }, [rawList])

  const [search, setSearch] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [activeFilters, setActiveFilters] = useState<InvoiceFilterValues | null>(null)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const filtered = useMemo(() => {
    let rows = allRows

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        r.invoiceNo.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q),
      )
    }

    if (activeFilters) {
      if (activeFilters.statuses.length > 0) {
        rows = rows.filter(r => activeFilters.statuses.includes(r.status))
      }

      const applyDate = (
        preset: typeof activeFilters.createdPreset,
        startIso: string,
        endIso: string,
        getIso: (r: InvoiceRow) => string,
      ) => {
        let start: Date | null = null
        let end: Date | null = null
        if (preset === "kustom") {
          if (startIso) { start = new Date(startIso); start.setHours(0, 0, 0, 0) }
          if (endIso)   { end   = new Date(endIso);   end.setHours(23, 59, 59, 999) }
        } else {
          end = new Date(); end.setHours(23, 59, 59, 999)
          start = new Date(); start.setHours(0, 0, 0, 0)
          if (preset === "7-hari")  start.setDate(start.getDate() - 7)
          if (preset === "30-hari") start.setDate(start.getDate() - 30)
        }
        rows = rows.filter(r => {
          const d = new Date(getIso(r))
          if (start && d < start) return false
          if (end   && d > end)   return false
          return true
        })
      }
      applyDate(activeFilters.createdPreset, activeFilters.createdStart, activeFilters.createdEnd, r => r.createdAt)
      applyDate(activeFilters.duePreset,     activeFilters.dueStart,     activeFilters.dueEnd,     r => r.dueDate)

      const min = parseInt(activeFilters.minHarga.replace(/\./g, "")) || 0
      const max = parseInt(activeFilters.maxHarga.replace(/\./g, "")) || Infinity
      rows = rows.filter(r => r.totalNumber >= min && r.totalNumber <= max)
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

  const counts = {
    total:     summaryData?.total   ?? 0,
    DRAF:      summaryData?.draft   ?? 0,
    DIKIRIM:   summaryData?.sent    ?? 0,
    DIBAYAR:   summaryData?.paid    ?? 0,
    TERLAMBAT: summaryData?.overdue ?? 0,
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>

          <div className="page-header">
            <h1 className="page-title">Daftar Invoice</h1>
            <div className="page-actions" style={{ display: "flex", gap: "10px" }}>
              <button type="button" style={exportBtnStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Ekspor Excel
              </button>
              <button type="button" style={exportBtnStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Ekspor PDF
              </button>
            </div>
          </div>

          <div className="summary-cards">
            <div className="card-violet">
              <div className="card-label">Total Invoice</div>
              <div className="card-value">{counts.total.toLocaleString("id-ID")}</div>
            </div>
            <div className="card-gold">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)", opacity: 0.5 }}
              />
              <div className="card-label">Draf</div>
              <div className="card-value">{counts.DRAF.toLocaleString("id-ID")}</div>
            </div>
            <div className="card-blue">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)", opacity: 0.5 }}
              />
              <div className="card-label">Dikirim</div>
              <div className="card-value">{counts.DIKIRIM.toLocaleString("id-ID")}</div>
            </div>
            <div className="card-green">
              <div className="card-glow" style={{ background: "rgba(52,211,153,.2)" }} />
              <div className="card-label">Dibayar</div>
              <div className="card-value">{counts.DIBAYAR.toLocaleString("id-ID")}</div>
            </div>
            <div className="card-red">
              <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
              <div className="card-label">Terlambat</div>
              <div className="card-value">{counts.TERLAMBAT.toLocaleString("id-ID")}</div>
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
                placeholder="Cari invoice, klien, atau nomor..."
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
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Nomor Invoice</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Nama Klien</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Tanggal Pembuatan</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Jatuh Tempo</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Total Harga</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>Status</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 100 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>Memuat data…</td></tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr><td colSpan={7} className="tbl-td tbl-td--center" style={{ padding: "40px 0", color: "#64748B" }}>
                    Belum ada Invoice. Invoice dibuat otomatis ketika status PO menjadi Dikirim.
                  </td></tr>
                )}
                {!isLoading && currentRows.map(row => {
                  const style = INVOICE_STATUS_STYLE[row.status]
                  return (
                    <tr key={row.quotationId} className="tbl-row">
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#630ED4" }}>
                        {row.invoiceNo}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#191C1E", fontWeight: 500 }}>
                        {row.client}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {formatDate(row.dueDate)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ fontWeight: 700, color: "#191C1E" }}>
                        {row.total}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <span className="status-badge" style={{ background: style.bg, color: style.color }}>
                          {INVOICE_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ padding: "12px 8px" }}>
                        <div style={{ display: "inline-flex", gap: "2px", alignItems: "center", justifyContent: "center" }}>
                          <button type="button" title="Lihat detail" style={iconBtnStyle} onClick={() => onViewDetail?.(row.quotationId)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button type="button" title="Unduh invoice" style={iconBtnStyle}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              currentPage={currentPage}
              totalPages={totalPages}
              resourceLabel="Invoice"
              onItemsPerPage={n => { setItemsPerPage(n); setCurrentPage(1) }}
              onPage={setCurrentPage}
            />
          </div>

        </div>
      </div>

      {showFilter && (
        <InvoiceFilter
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

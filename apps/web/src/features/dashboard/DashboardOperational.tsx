import { type CSSProperties, useMemo, useState } from "react"
import FilterButton from "@/components/shared/FilterButton"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { toTableRow } from "@/features/quotations/adapters"
import { useQuotations } from "@/features/quotations/hooks"
import { statusConfig } from "@/features/quotations/QuotationList/helpers"
import { formatNumber as formatId } from "@/lib/format"
import type { Page } from "@/lib/page"
import DashboardFinancialFilter, { type DashboardFilterValues } from "./DashboardFinancialFilter"
import TrendChart, { CHART_MONTHS } from "./TrendChart"

function toNumber(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const chartTabs = [
  { label: "Quotation", metric: "quotation" as const },
  { label: "Purchase Order", metric: "invoice" as const }, // PO ≈ delivered invoices proxy
  { label: "Invoice", metric: "invoice" as const },
]

function mapToMonthIndex(month: string, baseYear: number): number {
  const [y, m] = month.split("-").map(Number)
  if (y !== baseYear) return -1
  return m - 1
}

function buildSeries(
  points: { month: string; value: string }[] | undefined,
  baseYear: number,
): number[] {
  const series = new Array(CHART_MONTHS.length).fill(0)
  if (!points) return series
  for (const p of points) {
    const idx = mapToMonthIndex(p.month, baseYear)
    if (idx >= 0 && idx < series.length) series[idx] = toNumber(p.value)
  }
  return series
}

interface DashboardOperationalProps {
  onLogout: () => void
  onNavigate: (page: Page) => void
  onViewQuotation?: (quotationId: number) => void
  onViewAllQuotations?: () => void
  onViewAllInvoices?: () => void
}

const exportBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 20px",
  border: "1px solid rgba(99, 14, 212, 0.2)",
  borderRadius: "8px",
  background: "#FFFFFF",
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif",
  fontWeight: 600,
  fontSize: "14px",
  lineHeight: 1.25,
  color: "#630ED4",
}

export default function DashboardOperational({
  onLogout,
  onNavigate,
  onViewQuotation,
  onViewAllQuotations,
  onViewAllInvoices,
}: DashboardOperationalProps) {
  const [activeTab, setActiveTab] = useState("Quotation")
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<DashboardFilterValues | null>(null)

  const { data: summary } = useDashboardSummary()
  const { data: rawQuotations } = useQuotations({ limit: 5 })

  const baseYear = filters?.year ?? new Date().getFullYear()
  const fromDate = `${baseYear}-01-01`
  const toDate = `${baseYear}-12-31`
  const selectedMonths = filters?.months ?? null

  const tsQuotation = useDashboardTimeseries("quotation", fromDate, toDate)
  const tsInvoice = useDashboardTimeseries("invoice", fromDate, toDate)

  const series = useMemo<Record<string, number[]>>(() => {
    const quotation = buildSeries(tsQuotation.data, baseYear)
    const invoice = buildSeries(tsInvoice.data, baseYear)
    const maskMonths = (arr: number[]): number[] =>
      selectedMonths === null ? arr : arr.map((v, i) => (selectedMonths.includes(i) ? v : 0))
    return {
      Quotation: maskMonths(quotation),
      "Purchase Order": maskMonths(invoice),
      Invoice: maskMonths(invoice),
    }
  }, [tsQuotation.data, tsInvoice.data, baseYear, selectedMonths])

  const totalQuotation = summary?.totalQuotations ?? 0
  const totalRejected = summary?.totalQuotationsRejected ?? 0
  const totalPo = summary?.totalPo ?? 0
  const totalPaid = summary?.totalInvoicesPaid ?? 0
  const dueSoon = summary?.invoicesDueSoon ?? 0
  const overdue = summary?.invoicesOverdue ?? 0

  const recentQuotations = useMemo(() => {
    return (rawQuotations?.rows ?? []).slice(0, 5).map((q) => {
      const row = toTableRow(q)
      return {
        ...row,
        productCount: 0, // Not in list payload; left blank to avoid extra fetch.
      }
    })
  }, [rawQuotations])

  return (
    <div className="admin-shell">
      <Sidebar
        activePage={"dashboard-operational" as Page}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Dashboard Operasional</h1>
            <div className="page-actions" style={{ display: "flex", gap: "10px" }}>
              <button type="button" style={exportBtnStyle}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#630ED4"
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
              <FilterButton onClick={() => setShowFilter(true)} />
            </div>
          </div>

          <div className="stats-grid-4">
            <div className="stat-card">
              <div className="stat-label">Total Quotation</div>
              <div className="stat-value">{formatId(totalQuotation)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Quotation Ditolak</div>
              <div className="stat-value">{formatId(totalRejected)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Purchase Order</div>
              <div className="stat-value">{formatId(totalPo)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Invoice Dibayar</div>
              <div className="stat-value">{formatId(totalPaid)}</div>
            </div>
          </div>

          <div className="chart-section">
            <div className="chart-header">
              <h3 className="chart-title">Tren Performa Operasional</h3>
              <div className="chart-tabs">
                {chartTabs.map((tab) => (
                  <button
                    key={tab.label}
                    className={`chart-tab${activeTab === tab.label ? " chart-tab--active" : ""}`}
                    onClick={() => setActiveTab(tab.label)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart series={series} activeKey={activeTab} />
          </div>

          <div className="alert-row">
            <div className="alert-card alert--warning">
              <div
                className="card-overlay"
                style={{
                  background:
                    "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)",
                  opacity: 0.5,
                }}
              />
              <div className="alert-content">
                <h3>{formatId(dueSoon)} Invoice</h3>
                <p>Invoice akan segera jatuh tempo</p>
              </div>
              <button className="alert-btn" onClick={onViewAllInvoices}>
                Tinjau
              </button>
            </div>
            <div className="alert-card alert--danger">
              <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
              <div className="alert-content">
                <h3>{formatId(overdue)} Invoice</h3>
                <p>Invoice telah jatuh tempo</p>
              </div>
              <button className="alert-btn" onClick={onViewAllInvoices}>
                Tinjau
              </button>
            </div>
          </div>

          <div className="tbl-container">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 32px",
                borderBottom: "1px solid #F1F5F9",
                background: "rgba(242, 244, 246, 0.3)",
              }}
            >
              <h3
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 700,
                  fontSize: "18px",
                  lineHeight: "28px",
                  letterSpacing: "-0.45px",
                  color: "#191C1E",
                  margin: 0,
                }}
              >
                Quotation Terkini
              </h3>
              <button className="btn-admin-filter" onClick={onViewAllQuotations}>
                Lihat Semua
              </button>
            </div>

            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>
                    Nomor Quotation
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>
                    Versi
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Tanggal
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>
                    Jumlah Produk
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Total Penawaran
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentQuotations.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Belum ada Quotation.
                    </td>
                  </tr>
                )}
                {recentQuotations.map((row) => {
                  const style = statusConfig[row.status]
                  return (
                    <tr
                      key={row.id}
                      className="tbl-row"
                      style={{ cursor: onViewQuotation ? "pointer" : "default" }}
                      onClick={() => onViewQuotation?.(Number(row.id))}
                    >
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ fontWeight: 700, color: "#630ED4" }}
                      >
                        {row.displayNo}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {row.version}
                      </td>
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ color: "#191C1E", fontWeight: 500 }}
                      >
                        {row.client}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {row.date}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {row.productCount || "-"}
                      </td>
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ fontWeight: 700, color: "#191C1E" }}
                      >
                        Rp{row.total}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <StatusBadge bg={style.bg} color={style.color}>
                          {row.status}
                        </StatusBadge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showFilter && (
        <DashboardFinancialFilter
          title="Filter Dashboard Operasional"
          onClose={() => setShowFilter(false)}
          initialValues={filters ?? undefined}
          onApply={(f) => setFilters(f)}
        />
      )}
    </div>
  )
}

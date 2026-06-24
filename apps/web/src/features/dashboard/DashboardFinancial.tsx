import { type CSSProperties, useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import FilterButton from "@/components/shared/FilterButton"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import * as dashboardApi from "@/features/dashboard/api"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { useInvoices } from "@/features/invoices/hooks"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE, type InvoiceStatus } from "@/features/invoices/types"
import { buildSeries } from "@/lib/chart"
import { formatDate, formatNumber as formatId, formatRupiah as formatRp, toNum } from "@/lib/format"
import type { Page } from "@/lib/page"
import type { DashboardMetric, InvoiceBackendRow } from "@/types/api"
import DashboardFinancialFilter, { type DashboardFilterValues } from "./DashboardFinancialFilter"
import TrendChart from "./TrendChart"

const chartTabs: { label: string; metric: DashboardMetric }[] = [
  { label: "Pendapatan", metric: "revenue" },
  { label: "Pengeluaran", metric: "revenue" }, // expenses derived from revenue - profit
  { label: "Laba Bersih", metric: "profit" },
  { label: "PPN", metric: "ppn" },
]

function computeRpMax(values: number[]): number {
  const m = Math.max(...values, 0)
  if (m <= 50_000_000) return 50_000_000
  const step = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / step) * step
}

function formatRpAxis(v: number): string {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(0)}M`
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}K`
  return `Rp ${v}`
}

interface DashboardFinancialProps {
  onLogout: () => void
  onNavigate: (page: Page) => void
  onViewInvoice?: (quotationId: number) => void
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

export default function DashboardFinancial({
  onLogout,
  onNavigate,
  onViewInvoice,
  onViewAllInvoices,
}: DashboardFinancialProps) {
  const [activeTab, setActiveTab] = useState("Pendapatan")
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<DashboardFilterValues | null>(null)
  const { data: summary } = useDashboardSummary()
  const { data: rawInvoices } = useInvoices({ limit: 5 })

  const baseYear = filters?.year ?? new Date().getFullYear()
  const fromDate = `${baseYear}-01-01`
  const toDate = `${baseYear}-12-31`
  const selectedMonths = filters?.months ?? null // null = all months

  const tsRevenue = useDashboardTimeseries("revenue", fromDate, toDate)
  const tsProfit = useDashboardTimeseries("profit", fromDate, toDate)
  const tsPpn = useDashboardTimeseries("ppn", fromDate, toDate)

  const series = useMemo<Record<string, number[]>>(() => {
    const revenue = buildSeries(tsRevenue.data, baseYear)
    const profit = buildSeries(tsProfit.data, baseYear)
    const ppn = buildSeries(tsPpn.data, baseYear)
    // Expenses = cost = revenue - profit (profit already nets PPN out);
    // matches the Total Pengeluaran stat card (SUM of cost).
    const expenses = revenue.map((v, i) => Math.max(0, v - profit[i]))
    const maskMonths = (arr: number[]): number[] =>
      selectedMonths === null ? arr : arr.map((v, i) => (selectedMonths.includes(i) ? v : 0))
    return {
      Pendapatan: maskMonths(revenue),
      Pengeluaran: maskMonths(expenses),
      "Laba Bersih": maskMonths(profit),
      PPN: maskMonths(ppn),
    }
  }, [tsRevenue.data, tsProfit.data, tsPpn.data, baseYear, selectedMonths])

  const totalRevenue = toNum(summary?.totalRevenue)
  const totalExpenses = toNum(summary?.totalExpenses)
  const totalProfit = toNum(summary?.totalProfit)
  const totalPpn = toNum(summary?.totalPpn)
  const totalPo = summary?.totalPo ?? 0
  const totalInvoice = summary?.totalInvoices ?? 0
  const dueSoon = summary?.invoicesDueSoon ?? 0
  const overdue = summary?.invoicesOverdue ?? 0

  const recentInvoices = useMemo(() => {
    return (rawInvoices?.rows ?? [])
      .map((inv) => {
        const status = deriveStatus(inv)
        if (!status) return null
        return {
          id: inv.id,
          quotationId: inv.quotationId,
          invoiceNo: inv.invoiceNo,
          client: inv.companyName,
          createdAt: inv.invoiceDate,
          dueDate: inv.dueDate ?? inv.invoiceDate,
          total: formatRp(toNum(inv.total ?? inv.subtotal)),
          status,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, 5)
  }, [rawInvoices])

  return (
    <div className="admin-shell">
      <Sidebar
        activePage={"dashboard-financial" as Page}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Dashboard Finansial</h1>
            <div className="page-actions" style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                style={exportBtnStyle}
                onClick={() => dashboardApi.exportXlsx(baseYear)}
              >
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

          {filters && (
            <ActiveFilters
              chips={[
                { key: "year", label: `Tahun ${filters.year}` },
                ...(selectedMonths && selectedMonths.length < 12
                  ? [{ key: "months", label: `${selectedMonths.length} bulan dipilih` }]
                  : []),
              ]}
              onClearAll={() => setFilters(null)}
            />
          )}

          {/* Row 1 */}
          <div className="stats-grid-3">
            <div className="stat-card">
              <div className="stat-label">Total Pendapatan</div>
              <div className="stat-value">{formatRp(totalRevenue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Pengeluaran</div>
              <div className="stat-value">{formatRp(totalExpenses)}</div>
            </div>
            <div className="stat-card stat-card--accent">
              <div className="stat-label">Total Purchase Order</div>
              <div className="stat-value">{formatId(totalPo)}</div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="stats-grid-3">
            <div className="stat-card">
              <div className="stat-label">Total Laba Bersih</div>
              <div className="stat-value">{formatRp(totalProfit)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total PPN</div>
              <div className="stat-value">{formatRp(totalPpn)}</div>
            </div>
            <div className="stat-card stat-card--accent-light">
              <div
                className="card-overlay"
                style={{
                  background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)",
                  opacity: 0.5,
                }}
              />
              <div className="stat-label">Total Invoice</div>
              <div className="stat-value">{formatId(totalInvoice)}</div>
            </div>
          </div>

          {/* Chart */}
          <div className="chart-section">
            <div className="chart-header">
              <h3 className="chart-title">Tren Performa Finansial</h3>
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
            <TrendChart
              series={series}
              activeKey={activeTab}
              formatValue={(v) => `Rp${v.toLocaleString("id-ID")}`}
              formatAxisTick={formatRpAxis}
              computeMax={computeRpMax}
            />
          </div>

          {/* Alerts */}
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

          {/* Recent invoices */}
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
                Invoice Terkini
              </h3>
              <button className="btn-admin-filter" onClick={onViewAllInvoices}>
                Lihat Semua
              </button>
            </div>

            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>
                    Nomor Invoice
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Tanggal Pembuatan
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Jatuh Tempo
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Total Harga
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 130 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Belum ada Invoice.
                    </td>
                  </tr>
                )}
                {recentInvoices.map((row) => {
                  const style = INVOICE_STATUS_STYLE[row.status]
                  return (
                    <tr
                      key={row.id}
                      className="tbl-row"
                      style={{ cursor: onViewInvoice ? "pointer" : "default" }}
                      onClick={() => onViewInvoice?.(row.quotationId)}
                    >
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ fontWeight: 700, color: "#630ED4" }}
                      >
                        {row.invoiceNo}
                      </td>
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ color: "#191C1E", fontWeight: 500 }}
                      >
                        {row.client}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="tbl-td tbl-td--center" style={{ color: "#4A4455" }}>
                        {formatDate(row.dueDate)}
                      </td>
                      <td
                        className="tbl-td tbl-td--center"
                        style={{ fontWeight: 700, color: "#191C1E" }}
                      >
                        {row.total}
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <StatusBadge bg={style.bg} color={style.color}>
                          {INVOICE_LABEL[row.status]}
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
          onClose={() => setShowFilter(false)}
          initialValues={filters ?? undefined}
          onApply={(f) => setFilters(f)}
        />
      )}
    </div>
  )
}

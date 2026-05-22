import { type CSSProperties, useMemo, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { buildSeries } from "@/lib/chart"
import { formatNumber as formatId, formatRupiah as formatRp, toNum } from "@/lib/format"
import type { Page } from "@/lib/page"
import type { DashboardMetric } from "@/types/api"
import TrendChart from "./TrendChart"

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

const chartTabs: { label: string; metric: DashboardMetric }[] = [
  { label: "Quotation", metric: "quotation" },
  { label: "Invoice", metric: "invoice" },
  { label: "Pendapatan", metric: "revenue" },
  { label: "Laba Bersih", metric: "profit" },
  { label: "PPN", metric: "ppn" },
]

const RP_METRICS: ReadonlyArray<string> = ["Pendapatan", "Laba Bersih", "PPN"]

function formatRpAxis(v: number): string {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(0)}M`
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}K`
  return `Rp ${v}`
}

interface DashboardProps {
  onLogout: () => void
  onNavigate: (page: Page) => void
}

export default function Dashboard({ onLogout, onNavigate }: DashboardProps) {
  const [activeTab, setActiveTab] = useState("Quotation")
  const { data: summary } = useDashboardSummary()

  const baseYear = new Date().getFullYear()
  const fromDate = `${baseYear}-01-01`
  const toDate = `${baseYear}-12-31`

  const tsQuotation = useDashboardTimeseries("quotation", fromDate, toDate)
  const tsInvoice = useDashboardTimeseries("invoice", fromDate, toDate)
  const tsRevenue = useDashboardTimeseries("revenue", fromDate, toDate)
  const tsProfit = useDashboardTimeseries("profit", fromDate, toDate)
  const tsPpn = useDashboardTimeseries("ppn", fromDate, toDate)

  const series = useMemo<Record<string, number[]>>(
    () => ({
      Quotation: buildSeries(tsQuotation.data, baseYear),
      Invoice: buildSeries(tsInvoice.data, baseYear),
      Pendapatan: buildSeries(tsRevenue.data, baseYear),
      "Laba Bersih": buildSeries(tsProfit.data, baseYear),
      PPN: buildSeries(tsPpn.data, baseYear),
    }),
    [tsQuotation.data, tsInvoice.data, tsRevenue.data, tsProfit.data, tsPpn.data, baseYear],
  )

  const totalRevenue = toNum(summary?.totalRevenue)
  const totalExpenses = toNum(summary?.totalExpenses)
  const totalProfit = toNum(summary?.totalProfit)
  const totalPpn = toNum(summary?.totalPpn)
  const totalQuotation = summary?.totalQuotations ?? 0
  const totalRejected = summary?.totalQuotationsRejected ?? 0
  const totalPo = summary?.totalPo ?? 0
  const totalInvoice = summary?.totalInvoices ?? 0
  const totalPaid = summary?.totalInvoicesPaid ?? 0
  const dueSoon = summary?.invoicesDueSoon ?? 0
  const overdue = summary?.invoicesOverdue ?? 0

  return (
    <div className="admin-shell">
      <Sidebar activePage="dashboard" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Dashboard Utama</h1>
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
              <button className="btn-admin-filter">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="10" y1="18" x2="14" y2="18" />
                </svg>
                Filter
              </button>
            </div>
          </div>
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

          {/* Row 3 */}
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

          {/* Chart */}
          <div className="chart-section">
            <div className="chart-header">
              <h3 className="chart-title">Tren Performa</h3>
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
              formatValue={(v) =>
                RP_METRICS.includes(activeTab)
                  ? `Rp${v.toLocaleString("id-ID")}`
                  : v.toLocaleString("id-ID")
              }
              formatAxisTick={(v) =>
                RP_METRICS.includes(activeTab) ? formatRpAxis(v) : v.toLocaleString("id-ID")
              }
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
              <button className="alert-btn">Tinjau</button>
            </div>
            <div className="alert-card alert--danger">
              <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
              <div className="alert-content">
                <h3>{formatId(overdue)} Invoice</h3>
                <p>Invoice telah jatuh tempo</p>
              </div>
              <button className="alert-btn">Tinjau</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

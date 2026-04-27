import { useMemo, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import type { DashboardMetric } from "@/types/api"
import type { Page } from "../../main"

function formatId(n: number): string {
  return n.toLocaleString("id-ID")
}

function formatRp(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`
}

function toNumber(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const chartTabs: { label: string; metric: DashboardMetric }[] = [
  { label: "Quotation", metric: "quotation" },
  { label: "Invoice", metric: "invoice" },
  { label: "Pendapatan", metric: "revenue" },
  { label: "Laba Bersih", metric: "profit" },
  { label: "PPN", metric: "ppn" },
]

const months = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGS"]

const lineColors: Record<string, string> = {
  Quotation: "#7C3AED",
  Invoice: "#0F172A",
  Pendapatan: "#F59E0B",
  "Laba Bersih": "#22C55E",
  PPN: "#EF4444",
}

// Map YYYY-MM to chart slot index.
function mapToMonthIndex(month: string, baseYear: number): number {
  const [y, m] = month.split("-").map(Number)
  if (y !== baseYear) return -1
  return m - 1
}

// Build 8-slot series from API points.
function buildSeries(
  points: { month: string; value: string }[] | undefined,
  baseYear: number,
): number[] {
  const series = new Array(months.length).fill(0)
  if (!points) return series
  for (const p of points) {
    const idx = mapToMonthIndex(p.month, baseYear)
    if (idx >= 0 && idx < series.length) series[idx] = toNumber(p.value)
  }
  return series
}

// Compute axis max with safe floor.
function computeMax(values: number[]): number {
  const m = Math.max(...values, 0)
  if (m <= 160) return 160
  const step = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / step) * step
}

interface TrendChartProps {
  activeTab: string
  series: Record<string, number[]>
}

function TrendChart({ activeTab, series }: TrendChartProps) {
  const W = 760,
    H = 190
  const PAD = { top: 16, right: 16, bottom: 32, left: 52 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const activeData = series[activeTab] ?? []
  const maxVal = useMemo(() => computeMax(activeData), [activeData])

  const gx = (i: number) => PAD.left + (i / (months.length - 1)) * cW
  const gy = (v: number) => PAD.top + cH - (maxVal === 0 ? 0 : (v / maxVal) * cH)
  const makePath = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"} ${gx(i).toFixed(1)} ${gy(v).toFixed(1)}`).join(" ")
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            y1={gy(tick)}
            x2={W - PAD.right}
            y2={gy(tick)}
            stroke="#E2E8F0"
            strokeWidth="1"
          />
          {tick > 0 && (
            <text x={PAD.left - 6} y={gy(tick) + 4} textAnchor="end" fontSize="10" fill="#94A3B8">
              Rp {tick}K
            </text>
          )}
        </g>
      ))}
      {months.map((m, i) => (
        <text key={m} x={gx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#94A3B8">
          {m}
        </text>
      ))}
      {Object.entries(series).map(([key, data]) => {
        const isActive = key === activeTab
        return (
          <path
            key={key}
            d={makePath(data)}
            fill="none"
            stroke={lineColors[key]}
            strokeWidth={isActive ? 2.5 : 1.5}
            strokeOpacity={isActive ? 1 : 0.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
      {activeData.map((v, i) => (
        <circle key={i} cx={gx(i)} cy={gy(v)} r={3.5} fill={lineColors[activeTab]} />
      ))}
    </svg>
  )
}

interface DashboardProps {
  onLogout: () => void
  onNavigate: (page: Page) => void
}

export default function Dashboard({ onLogout, onNavigate }: DashboardProps) {
  const [activeTab, setActiveTab] = useState("Quotation")
  const { data: summary } = useDashboardSummary()

  // Chart range covers Jan to Sep current year.
  const baseYear = new Date().getFullYear()
  const fromDate = `${baseYear}-01-01`
  const toDate = `${baseYear}-09-01`

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

  const totalRevenue = toNumber(summary?.totalRevenue)
  const totalExpenses = toNumber(summary?.totalExpenses)
  const totalProfit = toNumber(summary?.totalProfit)
  const totalPpn = toNumber(summary?.totalPpn)
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
        {/* Header */}
        <header className="dash-header">
          <h1>Dashboard Utama</h1>
          <div className="page-actions">
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
        </header>

        {/* Content */}
        <div className="page-content">
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
            <TrendChart activeTab={activeTab} series={series} />
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

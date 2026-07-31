import { type CSSProperties, useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import Sidebar from "@/components/shared/Sidebar"
import StatCard from "@/components/shared/StatCard"
import { useMe } from "@/features/auth/hooks"
import * as dashboardApi from "@/features/dashboard/api"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { buildSeries, yearRange } from "@/lib/chart"
import { formatNumber as formatId, formatRupiah as formatRp, toNum } from "@/lib/format"
import type { Page } from "@/lib/page"
import { roleCanAccess } from "@/lib/rbac"
import type { DashboardMetric } from "@/types/api"
import { YEAR_OPTIONS } from "./DashboardFinancialFilter"
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
  const { data: me } = useMe()
  const canFinance = roleCanAccess(me?.role, "invoices")
  const visibleTabs = canFinance ? chartTabs : chartTabs.filter((tab) => tab.metric === "quotation")
  const { data: summary } = useDashboardSummary()

  const thisYear = new Date().getFullYear()
  const [baseYear, setBaseYear] = useState(thisYear)
  const [showYearMenu, setShowYearMenu] = useState(false)
  const yearOptions = YEAR_OPTIONS
  const { from, to } = yearRange(baseYear)

  const tsQuotation = useDashboardTimeseries("quotation", from, to)
  const tsInvoice = useDashboardTimeseries("invoice", from, to, "month", canFinance)
  const tsRevenue = useDashboardTimeseries("revenue", from, to, "month", canFinance)
  const tsProfit = useDashboardTimeseries("profit", from, to, "month", canFinance)
  const tsPpn = useDashboardTimeseries("ppn", from, to, "month", canFinance)

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
              {canFinance && (
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
              )}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="btn-admin-filter"
                  onClick={() => setShowYearMenu((v) => !v)}
                >
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
                  Grafik: {baseYear}
                </button>
                {showYearMenu && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 4px)",
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,.12)",
                      zIndex: 20,
                      minWidth: "130px",
                      overflow: "hidden",
                    }}
                  >
                    {yearOptions.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => {
                          setBaseYear(y)
                          setShowYearMenu(false)
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "9px 14px",
                          border: "none",
                          background: y === baseYear ? "rgba(99,14,212,.06)" : "#fff",
                          cursor: "pointer",
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: y === baseYear ? 600 : 500,
                          fontSize: "13px",
                          color: y === baseYear ? "#630ED4" : "#4A4455",
                        }}
                      >
                        Tahun {y}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {canFinance && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard
                label="Total Pendapatan"
                value={formatRp(totalRevenue)}
                onClick={() => onNavigate("invoices")}
              />
              <StatCard
                label="Total Pengeluaran"
                value={formatRp(totalExpenses)}
                onClick={() => onNavigate("purchase-orders")}
              />
            </div>
          )}

          {canFinance && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Total Laba Bersih"
                value={formatRp(totalProfit)}
                onClick={() => onNavigate("invoices")}
              />
              <StatCard
                label="Total PPN"
                value={formatRp(totalPpn)}
                onClick={() => onNavigate("invoices")}
              />
              <StatCard
                label="Total Invoice"
                value={formatId(totalInvoice)}
                onClick={() => onNavigate("invoices")}
              />
            </div>
          )}

          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${canFinance ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
          >
            <StatCard
              label="Total Quotation"
              value={formatId(totalQuotation)}
              onClick={() => onNavigate("quotation")}
            />
            <StatCard
              label="Total Quotation Ditolak"
              value={formatId(totalRejected)}
              onClick={() => onNavigate("quotation")}
            />
            <StatCard
              label="Total Purchase Order"
              value={formatId(totalPo)}
              onClick={() => onNavigate("purchase-orders")}
            />
            {canFinance && (
              <StatCard
                label="Total Invoice Dibayar"
                value={formatId(totalPaid)}
                onClick={() => onNavigate("invoices")}
              />
            )}
          </div>

          {/* Chart */}
          <ActiveFilters
            chips={[
              {
                key: "year",
                label: `Grafik: Tahun ${baseYear}`,
                onRemove: baseYear !== thisYear ? () => setBaseYear(thisYear) : undefined,
              },
            ]}
          />
          <div className="chart-section">
            <div className="chart-header">
              <h3 className="chart-title">Tren Performa</h3>
              <div className="chart-tabs">
                {visibleTabs.map((tab) => (
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

          {canFinance && (
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
                <button type="button" className="alert-btn" onClick={() => onNavigate("invoices")}>
                  Tinjau
                </button>
              </div>
              <div className="alert-card alert--danger">
                <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
                <div className="alert-content">
                  <h3>{formatId(overdue)} Invoice</h3>
                  <p>Invoice telah jatuh tempo</p>
                </div>
                <button type="button" className="alert-btn" onClick={() => onNavigate("invoices")}>
                  Tinjau
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

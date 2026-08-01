import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import StatCard from "@/components/shared/StatCard"
import { useMe } from "@/features/auth/hooks"
import * as dashboardApi from "@/features/dashboard/api"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { buildSeries, yearRange } from "@/lib/chart"
import { formatNumber as formatId, formatRupiah as formatRp, toNum } from "@/lib/format"
import { roleCanAccess } from "@/lib/rbac"
import { pill, ui } from "@/lib/ui"
import type { DashboardMetric } from "@/types/api"
import { YEAR_OPTIONS } from "./DashboardFinancialFilter"
import TrendChart from "./TrendChart"

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

export default function Dashboard() {
  const navigate = useNavigate()
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
    <div className="page-content" style={{ gap: "29px" }}>
      <div className="page-header">
        <h1 className="page-title">Dashboard Utama</h1>
        <div className="flex flex-wrap items-center gap-2.5">
          {canFinance && (
            <button
              type="button"
              className={ui.btnOutline}
              onClick={() => dashboardApi.exportXlsx(baseYear)}
            >
              <svg
                width="16"
                height="16"
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
          )}
          <div className="relative">
            <button
              type="button"
              className={ui.btnPrimary}
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
              <div className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[130px] overflow-hidden rounded-lg border border-dark-200 bg-white shadow-lg">
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setBaseYear(y)
                      setShowYearMenu(false)
                    }}
                    className={`block w-full px-3.5 py-2 text-left text-[13px] transition hover:bg-dark-100 ${
                      y === baseYear
                        ? "bg-primary-50 font-semibold text-primary-700"
                        : "font-medium text-dark-600"
                    }`}
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
            onClick={() => void navigate({ to: "/invoices" })}
          />
          <StatCard
            label="Total Pengeluaran"
            value={formatRp(totalExpenses)}
            onClick={() => void navigate({ to: "/purchase-orders" })}
          />
        </div>
      )}

      {canFinance && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total Laba Bersih"
            value={formatRp(totalProfit)}
            onClick={() => void navigate({ to: "/invoices" })}
          />
          <StatCard
            label="Total PPN"
            value={formatRp(totalPpn)}
            onClick={() => void navigate({ to: "/invoices" })}
          />
          <StatCard
            label="Total Invoice"
            value={formatId(totalInvoice)}
            onClick={() => void navigate({ to: "/invoices" })}
          />
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${canFinance ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        <StatCard
          label="Total Quotation"
          value={formatId(totalQuotation)}
          onClick={() => void navigate({ to: "/quotations" })}
        />
        <StatCard
          label="Total Quotation Ditolak"
          value={formatId(totalRejected)}
          onClick={() => void navigate({ to: "/quotations" })}
        />
        <StatCard
          label="Total Purchase Order"
          value={formatId(totalPo)}
          onClick={() => void navigate({ to: "/purchase-orders" })}
        />
        {canFinance && (
          <StatCard
            label="Total Invoice Dibayar"
            value={formatId(totalPaid)}
            onClick={() => void navigate({ to: "/invoices" })}
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
      <div className={ui.panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className={ui.sectionTitle}>Tren Performa</h3>
          <div className="flex flex-wrap gap-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.label}
                className={pill(activeTab === tab.label)}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-warning/30 bg-warning/10 px-6 py-6">
            <div>
              <h3 className="text-xl font-bold text-accent-900">{formatId(dueSoon)} Invoice</h3>
              <p className="mt-1 text-overline font-semibold uppercase tracking-[0.05em] text-accent-800/70">
                Invoice akan segera jatuh tempo
              </p>
            </div>
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => void navigate({ to: "/invoices" })}
            >
              Tinjau
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-error/30 bg-error/10 px-6 py-6">
            <div>
              <h3 className="text-xl font-bold text-red-800">{formatId(overdue)} Invoice</h3>
              <p className="mt-1 text-overline font-semibold uppercase tracking-[0.05em] text-red-700/70">
                Invoice telah jatuh tempo
              </p>
            </div>
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => void navigate({ to: "/invoices" })}
            >
              Tinjau
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

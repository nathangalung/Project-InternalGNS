import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import EntityLink from "@/components/shared/EntityLink"
import FilterButton from "@/components/shared/FilterButton"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import {
  useDashboardExport,
  useDashboardSummary,
  useDashboardTimeseries,
} from "@/features/dashboard/hooks"
import { useInvoices } from "@/features/invoices/hooks"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "@/features/invoices/types"
import { buildDailySeries, buildSeries, dayLabels, monthRange, yearRange } from "@/lib/chart"
import {
  formatDate,
  formatNumber as formatId,
  formatRupiah as formatRp,
  formatRupiahAxis as formatRpAxis,
  toNum,
} from "@/lib/format"
import { pill, ui } from "@/lib/ui"
import type { DashboardMetric } from "@/types/api"
import DashboardFinancialFilter, {
  type DashboardFilterValues,
  MONTH_LABELS,
} from "./DashboardFinancialFilter"
import {
  computeRpMax,
  expenseSeries,
  REVENUE_LABEL,
  statusCount,
  toRecentInvoices,
} from "./helpers"
import StatusTiles from "./StatusTiles"
import SummaryError from "./SummaryError"
import TrendChart, { CHART_MONTHS } from "./TrendChart"

const chartTabs: { label: string; metric: DashboardMetric }[] = [
  { label: REVENUE_LABEL, metric: "revenue" },
  // Derived: revenue minus profit
  { label: "Pengeluaran", metric: "revenue" },
  { label: "Laba Bersih", metric: "profit" },
  { label: "PPN", metric: "ppn" },
]

// Latest invoices, cancelled excluded.
//
// Filtering on the server keeps five rows (DASH-6).
const RECENT_INVOICE_PARAMS = { limit: 5, status: "draft,sent,overdue,paid" }

export default function DashboardFinancial() {
  const [activeTab, setActiveTab] = useState(REVENUE_LABEL)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<DashboardFilterValues | null>(null)
  const { data: summary, isError: summaryError } = useDashboardSummary()
  const { exporting, exportXlsx } = useDashboardExport()
  const {
    data: rawInvoices,
    isPending: invoicesPending,
    isError: invoicesError,
  } = useInvoices(RECENT_INVOICE_PARAMS)

  const baseYear = filters?.year ?? new Date().getFullYear()
  const selectedMonth = filters?.month ?? null // null = whole year
  const interval: "month" | "day" = selectedMonth === null ? "month" : "day"
  const { from, to } =
    selectedMonth === null ? yearRange(baseYear) : monthRange(baseYear, selectedMonth)
  const chartLabels = selectedMonth === null ? CHART_MONTHS : dayLabels(baseYear, selectedMonth)

  const tsRevenue = useDashboardTimeseries("revenue", from, to, interval)
  const tsProfit = useDashboardTimeseries("profit", from, to, interval)
  const tsPpn = useDashboardTimeseries("ppn", from, to, interval)

  const series = useMemo<Record<string, number[]>>(() => {
    const build = (data: { month: string; value: string }[] | undefined) =>
      selectedMonth === null
        ? buildSeries(data, baseYear)
        : buildDailySeries(data, baseYear, selectedMonth)
    const revenue = build(tsRevenue.data)
    const profit = build(tsProfit.data)
    const ppn = build(tsPpn.data)
    return {
      [REVENUE_LABEL]: revenue,
      Pengeluaran: expenseSeries(revenue, profit),
      "Laba Bersih": profit,
      PPN: ppn,
    }
  }, [tsRevenue.data, tsProfit.data, tsPpn.data, baseYear, selectedMonth])

  const totalRevenue = toNum(summary?.totalRevenue)
  const totalExpenses = toNum(summary?.totalExpenses)
  const totalProfit = toNum(summary?.totalProfit)
  const totalPpn = toNum(summary?.totalPpn)
  const totalPo = summary?.totalPo ?? 0
  const totalInvoice = summary?.totalInvoices ?? 0
  const dueSoon = summary?.invoicesDueSoon ?? 0
  // Tile count, one Terlambat source
  const overdue = statusCount(summary?.invoiceStatuses, "overdue") ?? summary?.invoicesOverdue ?? 0
  // Dash until the summary arrives
  const fig = (text: string) => (summary ? text : "–")

  const recentInvoices = useMemo(() => toRecentInvoices(rawInvoices?.rows ?? []), [rawInvoices])

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Dashboard Finansial</h1>
          <div className={ui.pageActionsTight}>
            <button
              type="button"
              className={ui.btnOutline}
              disabled={exporting}
              onClick={() => void exportXlsx(baseYear)}
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
                aria-hidden="true"
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

        <SummaryError show={summaryError} />

        {filters && (
          <ActiveFilters
            chips={[
              { key: "year", label: `Tahun ${filters.year}` },
              ...(selectedMonth !== null
                ? [{ key: "month", label: MONTH_LABELS[selectedMonth] }]
                : []),
            ]}
            onClearAll={() => setFilters(null)}
          />
        )}

        {/* Row 1 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={`Total ${REVENUE_LABEL}`} value={fig(formatRp(totalRevenue))} />
          <StatCard label="Total Pengeluaran" value={fig(formatRp(totalExpenses))} />
          <StatCard label="Total Purchase Order Aktif" value={fig(formatId(totalPo))} />
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total Laba Bersih" value={fig(formatRp(totalProfit))} />
          <StatCard label="Total PPN" value={fig(formatRp(totalPpn))} />
          <StatCard label="Total Invoice" value={fig(formatId(totalInvoice))} />
        </div>

        <StatusTiles title="Status Invoice" items={summary?.invoiceStatuses} />

        {/* Chart */}
        <div className={ui.panel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className={ui.sectionTitle}>Tren Performa Finansial</h3>
            <div className="flex flex-wrap gap-2">
              {chartTabs.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  aria-pressed={activeTab === tab.label}
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
            monthLabels={chartLabels}
            formatValue={(v) => `Rp${v.toLocaleString("id-ID")}`}
            formatAxisTick={formatRpAxis}
            computeMax={computeRpMax}
          />
        </div>

        {/* Alerts */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-warning/30 bg-warning/10 px-6 py-6">
            <div>
              <h3 className="text-xl font-bold text-accent-900">
                {fig(formatId(dueSoon))} Invoice
              </h3>
              <p className="mt-1 text-overline font-semibold uppercase tracking-[0.05em] text-accent-800/70">
                Invoice segera jatuh tempo
              </p>
            </div>
            <Link to="/invoices" className={`${ui.btnPrimary} no-underline`}>
              Tinjau
            </Link>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-error/30 bg-error/10 px-6 py-6">
            <div>
              <h3 className="text-xl font-bold text-red-800">{fig(formatId(overdue))} Invoice</h3>
              <p className="mt-1 text-overline font-semibold uppercase tracking-[0.05em] text-red-700/70">
                Invoice terlambat
              </p>
            </div>
            <Link to="/invoices" className={`${ui.btnPrimary} no-underline`}>
              Tinjau
            </Link>
          </div>
        </div>

        {/* Recent invoices */}
        <div className={ui.tableWrap}>
          <div className="flex items-center justify-between border-b border-[#F1F5F9] bg-[rgba(242,244,246,0.3)] px-8 py-5">
            <h3 className="text-lg font-bold leading-7 tracking-[-0.45px] text-[#191C1E]">
              Invoice Terkini
            </h3>
            <Link to="/invoices" className={`${ui.btnPrimary} no-underline`}>
              Lihat Semua
            </Link>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[150px]`}>Nomor Invoice</th>
                <th className={`${ui.thCenter} w-[200px]`}>Nama Klien</th>
                <th className={`${ui.thCenter} w-[160px]`}>Tanggal Invoice</th>
                <th className={`${ui.thCenter} w-[140px]`}>Jatuh Tempo</th>
                <th className={`${ui.thCenter} w-[160px]`}>Total Tagihan</th>
                <th className={`${ui.thCenter} w-[130px]`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoicesPending && <TableLoadingRow colSpan={6} />}
              {invoicesError && (
                <TableEmptyRow colSpan={6}>Gagal memuat Invoice terkini.</TableEmptyRow>
              )}
              {!invoicesPending && !invoicesError && recentInvoices.length === 0 && (
                <TableEmptyRow colSpan={6}>Belum ada Invoice.</TableEmptyRow>
              )}
              {recentInvoices.map((row) => {
                const style = INVOICE_STATUS_STYLE[row.status]
                return (
                  <tr key={row.id} className={ui.tr}>
                    <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                      <EntityLink kind="invoice" quotationId={row.quotationId}>
                        {row.invoiceNo}
                      </EntityLink>
                    </td>
                    <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>
                      <EntityLink kind="client" id={row.clientId} tone="name">
                        {row.client}
                      </EntityLink>
                    </td>
                    <td className={ui.tdCenter}>{formatDate(row.invoiceDate)}</td>
                    <td className={ui.tdCenter}>{formatDate(row.dueDate)}</td>
                    <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>{row.total}</td>
                    <td className={ui.tdCenter}>
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

      {showFilter && (
        <DashboardFinancialFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters ?? undefined}
          onApply={(f) => setFilters(f)}
        />
      )}
    </>
  )
}

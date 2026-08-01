import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import FilterButton from "@/components/shared/FilterButton"
import Sidebar from "@/components/shared/Sidebar"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import * as dashboardApi from "@/features/dashboard/api"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { useInvoices } from "@/features/invoices/hooks"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "@/features/invoices/types"
import { buildDailySeries, buildSeries, dayLabels, monthRange, yearRange } from "@/lib/chart"
import { formatDate, formatNumber as formatId, formatRupiah as formatRp, toNum } from "@/lib/format"
import type { Page } from "@/lib/page"
import { deriveInvoiceStatus } from "@/lib/status"
import { pill, ui } from "@/lib/ui"
import type { DashboardMetric } from "@/types/api"
import DashboardFinancialFilter, {
  type DashboardFilterValues,
  MONTH_LABELS,
} from "./DashboardFinancialFilter"
import TrendChart, { CHART_MONTHS } from "./TrendChart"

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
  const { data: rawInvoices, isPending: invoicesPending } = useInvoices({ limit: 5 })

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
    // Expenses = cost = revenue - profit (profit already nets PPN out);
    // matches the Total Pengeluaran stat card (SUM of cost).
    const expenses = revenue.map((v, i) => Math.max(0, v - profit[i]))
    return {
      Pendapatan: revenue,
      Pengeluaran: expenses,
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
  const overdue = summary?.invoicesOverdue ?? 0

  const recentInvoices = useMemo(() => {
    return (rawInvoices?.rows ?? [])
      .map((inv) => {
        const status = deriveInvoiceStatus(inv, { cancelledAsNull: true })
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
              <FilterButton onClick={() => setShowFilter(true)} />
            </div>
          </div>

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
            <StatCard label="Total Pendapatan" value={formatRp(totalRevenue)} />
            <StatCard label="Total Pengeluaran" value={formatRp(totalExpenses)} />
            <StatCard label="Total Purchase Order" value={formatId(totalPo)} />
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total Laba Bersih" value={formatRp(totalProfit)} />
            <StatCard label="Total PPN" value={formatRp(totalPpn)} />
            <StatCard label="Total Invoice" value={formatId(totalInvoice)} />
          </div>

          {/* Chart */}
          <div className={ui.panel}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className={ui.sectionTitle}>Tren Performa Finansial</h3>
              <div className="flex flex-wrap gap-2">
                {chartTabs.map((tab) => (
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
                <h3 className="text-xl font-bold text-accent-900">{formatId(dueSoon)} Invoice</h3>
                <p className="mt-1 text-overline font-semibold uppercase tracking-[0.05em] text-accent-800/70">
                  Invoice akan segera jatuh tempo
                </p>
              </div>
              <button type="button" className={ui.btnPrimary} onClick={onViewAllInvoices}>
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
              <button type="button" className={ui.btnPrimary} onClick={onViewAllInvoices}>
                Tinjau
              </button>
            </div>
          </div>

          {/* Recent invoices */}
          <div className="tbl-container">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] bg-[rgba(242,244,246,0.3)] px-8 py-5">
              <h3 className="text-lg font-bold leading-7 tracking-[-0.45px] text-[#191C1E]">
                Invoice Terkini
              </h3>
              <button type="button" className={ui.btnPrimary} onClick={onViewAllInvoices}>
                Lihat Semua
              </button>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={ui.thCenter} style={{ width: 150 }}>
                    Nomor Invoice
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Tanggal Pembuatan
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Jatuh Tempo
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Total Tagihan
                  </th>
                  <th className={ui.thCenter} style={{ width: 130 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoicesPending && <TableLoadingRow colSpan={6} />}
                {!invoicesPending && recentInvoices.length === 0 && (
                  <TableEmptyRow colSpan={6}>Belum ada Invoice.</TableEmptyRow>
                )}
                {recentInvoices.map((row) => {
                  const style = INVOICE_STATUS_STYLE[row.status]
                  return (
                    <tr
                      key={row.id}
                      className={`${ui.tr} ${onViewInvoice ? "cursor-pointer" : "cursor-default"}`}
                      onClick={() => onViewInvoice?.(row.quotationId)}
                    >
                      <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                        {row.invoiceNo}
                      </td>
                      <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>{row.client}</td>
                      <td className={ui.tdCenter}>{formatDate(row.createdAt)}</td>
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

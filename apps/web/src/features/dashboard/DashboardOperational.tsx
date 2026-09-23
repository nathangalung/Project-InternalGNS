import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import EntityLink from "@/components/shared/EntityLink"
import FilterButton from "@/components/shared/FilterButton"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { useQuotations } from "@/features/quotations/hooks"
import { buildDailySeries, buildSeries, dayLabels, monthRange, yearRange } from "@/lib/chart"
import { formatNumber as formatId } from "@/lib/format"
import { pill, ui } from "@/lib/ui"
import DashboardFinancialFilter, {
  type DashboardFilterValues,
  MONTH_LABELS,
} from "./DashboardFinancialFilter"
import { toRecentQuotation } from "./helpers"
import StatusTiles from "./StatusTiles"
import TrendChart, { CHART_MONTHS } from "./TrendChart"

const chartTabs = [{ label: "Quotation", metric: "quotation" as const }]

export default function DashboardOperational() {
  const [activeTab, setActiveTab] = useState("Quotation")
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<DashboardFilterValues | null>(null)

  const { data: summary } = useDashboardSummary()
  const { data: rawQuotations, isPending: quotationsPending } = useQuotations({ limit: 5 })

  const baseYear = filters?.year ?? new Date().getFullYear()
  const selectedMonth = filters?.month ?? null // null = whole year
  const interval: "month" | "day" = selectedMonth === null ? "month" : "day"
  const { from, to } =
    selectedMonth === null ? yearRange(baseYear) : monthRange(baseYear, selectedMonth)
  const chartLabels = selectedMonth === null ? CHART_MONTHS : dayLabels(baseYear, selectedMonth)

  const tsQuotation = useDashboardTimeseries("quotation", from, to, interval)

  const series = useMemo<Record<string, number[]>>(() => {
    const quotation =
      selectedMonth === null
        ? buildSeries(tsQuotation.data, baseYear)
        : buildDailySeries(tsQuotation.data, baseYear, selectedMonth)
    return {
      Quotation: quotation,
    }
  }, [tsQuotation.data, baseYear, selectedMonth])

  const totalQuotation = summary?.totalQuotations ?? 0
  const totalPo = summary?.totalPo ?? 0
  // Dash until the summary arrives
  const fig = (text: string) => (summary ? text : "–")

  const statusLabels = summary?.quotationStatuses
  const recentQuotations = useMemo(
    () => (rawQuotations?.rows ?? []).slice(0, 5).map((q) => toRecentQuotation(q, statusLabels)),
    [rawQuotations, statusLabels],
  )

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Dashboard Operasional</h1>
          <div className={ui.pageActionsTight}>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard label="Total Quotation" value={fig(formatId(totalQuotation))} />
          <StatCard label="Total Purchase Order Aktif" value={fig(formatId(totalPo))} />
        </div>

        <StatusTiles title="Status Quotation" items={summary?.quotationStatuses} />
        <StatusTiles title="Status Purchase Order" items={summary?.poStatuses} />

        <div className={ui.panel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className={ui.sectionTitle}>Tren Performa Operasional</h3>
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
          <TrendChart series={series} activeKey={activeTab} monthLabels={chartLabels} />
        </div>

        <div className={ui.tableWrap}>
          <div className="flex items-center justify-between border-b border-[#F1F5F9] bg-[rgba(242,244,246,0.3)] px-8 py-5">
            <h3 className="text-lg font-bold leading-7 tracking-[-0.45px] text-[#191C1E]">
              Quotation Terkini
            </h3>
            <Link to="/quotations" className={`${ui.btnPrimary} no-underline`}>
              Lihat Semua
            </Link>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[150px]`}>Nomor Quotation</th>
                <th className={`${ui.thCenter} w-[80px]`}>Versi</th>
                <th className={`${ui.thCenter} w-[200px]`}>Nama Klien</th>
                <th className={`${ui.thCenter} w-[140px]`}>Tanggal</th>
                <th className={`${ui.thCenter} w-[130px]`}>Jumlah Produk</th>
                <th className={`${ui.thCenter} w-[160px]`}>Total Penawaran</th>
                <th className={`${ui.thCenter} w-[130px]`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {quotationsPending && <TableLoadingRow colSpan={7} />}
              {!quotationsPending && recentQuotations.length === 0 && (
                <TableEmptyRow colSpan={7}>Belum ada Quotation.</TableEmptyRow>
              )}
              {recentQuotations.map((row) => (
                <tr key={row.id} className={ui.tr}>
                  <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                    <EntityLink kind="quotation" id={row.id}>
                      {row.quotationNo}
                    </EntityLink>
                  </td>
                  <td className={ui.tdCenter}>{row.version}</td>
                  {/* List payload has no client id */}
                  <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>{row.client}</td>
                  <td className={ui.tdCenter}>{row.date}</td>
                  {/* Not in list payload */}
                  <td className={ui.tdCenter}>-</td>
                  <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>{row.total}</td>
                  <td className={ui.tdCenter}>
                    <StatusBadge bg={row.badge.bg} color={row.badge.color}>
                      {row.label}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </>
  )
}

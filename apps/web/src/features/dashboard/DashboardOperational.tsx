import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import FilterButton from "@/components/shared/FilterButton"
import Sidebar from "@/components/shared/Sidebar"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { toTableRow } from "@/features/quotations/adapters"
import { useQuotations } from "@/features/quotations/hooks"
import { statusConfig } from "@/features/quotations/QuotationList/helpers"
import { buildDailySeries, buildSeries, dayLabels, monthRange, yearRange } from "@/lib/chart"
import { formatNumber as formatId } from "@/lib/format"
import type { Page } from "@/lib/page"
import { pill, ui } from "@/lib/ui"
import DashboardFinancialFilter, {
  type DashboardFilterValues,
  MONTH_LABELS,
} from "./DashboardFinancialFilter"
import TrendChart, { CHART_MONTHS } from "./TrendChart"

const chartTabs = [{ label: "Quotation", metric: "quotation" as const }]

interface DashboardOperationalProps {
  onLogout: () => void
  onNavigate: (page: Page) => void
  onViewQuotation?: (quotationId: number) => void
  onViewAllQuotations?: () => void
}

export default function DashboardOperational({
  onLogout,
  onNavigate,
  onViewQuotation,
  onViewAllQuotations,
}: DashboardOperationalProps) {
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
  const totalRejected = summary?.totalQuotationsRejected ?? 0
  const totalPo = summary?.totalPo ?? 0

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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total Quotation" value={formatId(totalQuotation)} />
            <StatCard label="Total Quotation Ditolak" value={formatId(totalRejected)} />
            <StatCard label="Total Purchase Order" value={formatId(totalPo)} />
          </div>

          <div className={ui.panel}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className={ui.sectionTitle}>Tren Performa Operasional</h3>
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
            <TrendChart series={series} activeKey={activeTab} monthLabels={chartLabels} />
          </div>

          <div className="tbl-container">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] bg-[rgba(242,244,246,0.3)] px-8 py-5">
              <h3 className="text-lg font-bold leading-7 tracking-[-0.45px] text-[#191C1E]">
                Quotation Terkini
              </h3>
              <button type="button" className={ui.btnPrimary} onClick={onViewAllQuotations}>
                Lihat Semua
              </button>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={ui.thCenter} style={{ width: 150 }}>
                    Nomor Quotation
                  </th>
                  <th className={ui.thCenter} style={{ width: 80 }}>
                    Versi
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    Nama Klien
                  </th>
                  <th className={ui.thCenter} style={{ width: 140 }}>
                    Tanggal
                  </th>
                  <th className={ui.thCenter} style={{ width: 130 }}>
                    Jumlah Produk
                  </th>
                  <th className={ui.thCenter} style={{ width: 160 }}>
                    Total Penawaran
                  </th>
                  <th className={ui.thCenter} style={{ width: 130 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotationsPending && <TableLoadingRow colSpan={7} />}
                {!quotationsPending && recentQuotations.length === 0 && (
                  <TableEmptyRow colSpan={7}>Belum ada Quotation.</TableEmptyRow>
                )}
                {recentQuotations.map((row) => {
                  const style = statusConfig[row.status]
                  return (
                    <tr
                      key={row.id}
                      className={`${ui.tr} ${onViewQuotation ? "cursor-pointer" : "cursor-default"}`}
                      onClick={() => onViewQuotation?.(Number(row.id))}
                    >
                      <td className={`${ui.tdCenter} font-bold text-primary-700`}>
                        {row.displayNo}
                      </td>
                      <td className={ui.tdCenter}>{row.version}</td>
                      <td className={`${ui.tdCenter} font-medium text-[#191C1E]`}>{row.client}</td>
                      <td className={ui.tdCenter}>{row.date}</td>
                      <td className={ui.tdCenter}>{row.productCount || "-"}</td>
                      <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>Rp{row.total}</td>
                      <td className={ui.tdCenter}>
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

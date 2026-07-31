import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import FilterButton from "@/components/shared/FilterButton"
import Sidebar from "@/components/shared/Sidebar"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { useDashboardSummary, useDashboardTimeseries } from "@/features/dashboard/hooks"
import { toTableRow } from "@/features/quotations/adapters"
import { useQuotations } from "@/features/quotations/hooks"
import { statusConfig } from "@/features/quotations/QuotationList/helpers"
import { buildDailySeries, buildSeries, dayLabels, monthRange, yearRange } from "@/lib/chart"
import { formatNumber as formatId } from "@/lib/format"
import { pill, ui } from "@/lib/ui"
import type { Page } from "@/lib/page"
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
  const { data: rawQuotations } = useQuotations({ limit: 5 })

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

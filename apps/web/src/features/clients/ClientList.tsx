import { useMemo, useState } from "react"
import EntityLogo from "@/components/shared/EntityLogo"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import Sidebar from "@/components/shared/Sidebar"
import StatusBadge from "@/components/shared/StatusBadge"
import ClientAdd from "@/features/clients/ClientAdd"
import ClientFilter, { type ClientFilterValues } from "@/features/clients/ClientFilter"
import { useClientSummary, useClients } from "@/features/clients/hooks"
import { useCountries } from "@/features/countries/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { formatNumber, formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import type { ClientRow } from "@/types/api"

interface ClientListProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
  onViewDetail?: (id: number) => void
}

export default function ClientList({ onNavigate, onLogout, onViewDetail }: ClientListProps) {
  const { data: countriesData } = useCountries()
  const { data: summaryData } = useClientSummary()

  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState<ClientFilterValues>({
    status: "all",
    countryCode: "",
    minTotal: "",
  })
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      isActive: filters.status === "all" ? undefined : filters.status === "active",
      countryCode: filters.countryCode || undefined,
      minTotal: filters.minTotal && filters.minTotal !== "0" ? filters.minTotal : undefined,
      limit: itemsPerPage,
      offset: (currentPage - 1) * itemsPerPage,
    }),
    [debouncedSearch, filters, itemsPerPage, currentPage],
  )

  const { data: clientsData, isLoading } = useClients(queryParams)
  const currentRows = clientsData?.rows ?? []
  const totalItems = clientsData?.total ?? 0

  const countryOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of countriesData ?? []) map.set(c.code, c.name)
    return (code: string) => map.get(code) ?? code
  }, [countriesData])

  const kpis = useMemo(() => {
    const total = summaryData?.total ?? 0
    const newThisMonth = summaryData?.newThisMonth ?? 0
    const newThisYear = summaryData?.newThisYear ?? 0
    const prevYearTotal = summaryData?.prevYearTotal ?? 0
    const activeCount = summaryData?.activeCount ?? 0
    const yoyPct =
      prevYearTotal > 0 ? Math.round(((newThisYear - prevYearTotal) / prevYearTotal) * 100) : null
    const retentionPct = total > 0 ? Math.round((activeCount / total) * 100) : null
    const yoyText = yoyPct === null ? "-" : `${yoyPct >= 0 ? "+" : ""}${yoyPct}%`
    const retentionText = retentionPct === null ? "-" : `${retentionPct}%`
    return {
      total,
      yoy: yoyText,
      newThisMonth,
      retention: retentionText,
    }
  }, [summaryData])

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage

  return (
    <div className="admin-shell">
      <Sidebar activePage={"clients" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="page-header">
            <h1 className="page-title">Daftar Klien</h1>
            <div className="page-actions">
              <button
                className="btn-admin-primary"
                style={{ width: "200px", justifyContent: "center" }}
                onClick={() => setShowAdd(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Klien
              </button>
            </div>
          </div>

          <div className="summary-cards" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="card-violet">
              <div className="card-label">Total Klien</div>
              <div className="card-value">{formatNumber(kpis.total)}</div>
            </div>
            <div className="card-blue">
              <div
                className="card-overlay"
                style={{
                  background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)",
                  opacity: 0.5,
                }}
              />
              <div className="card-label">Pertumbuhan (YoY)</div>
              <div className="card-value">{kpis.yoy}</div>
            </div>
            <div className="card-green">
              <div className="card-glow" style={{ background: "rgba(52,211,153,.2)" }} />
              <div className="card-label">Baru bulan ini</div>
              <div className="card-value">{formatNumber(kpis.newThisMonth)}</div>
            </div>
            <div className="card-gold">
              <div
                className="card-overlay"
                style={{
                  background:
                    "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)",
                  opacity: 0.5,
                }}
              />
              <div className="card-label">Retensi klien</div>
              <div className="card-value">{kpis.retention}</div>
            </div>
          </div>

          <div className="search-row">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setCurrentPage(1)
              }}
              placeholder="Cari nama, negara asal klien..."
            />
            <FilterButton onClick={() => setShowFilter(true)} />
          </div>

          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 240 }}>
                    Nama Klien
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Negara
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                    Status
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 180 }}>
                    Total Pembelian
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                    Jumlah Pembelian
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Memuat data…
                    </td>
                  </tr>
                )}
                {!isLoading && currentRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Tidak ada klien.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  currentRows.map((c: ClientRow) => {
                    const status = c.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                    return (
                      <tr key={c.id} className="tbl-row">
                        <td className="tbl-td">
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "16px",
                              paddingLeft: "12px",
                            }}
                          >
                            <EntityLogo name={c.name} />
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 700,
                                fontSize: "14px",
                                lineHeight: "1.35",
                                color: "#191C1E",
                                flex: 1,
                                minWidth: 0,
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}
                            >
                              {c.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#191C1E", fontWeight: 500, fontSize: "14px" }}
                        >
                          {countryOf(c.countryCode)}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <StatusBadge bg={status.bg} color={status.color} minWidth={100}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {formatRupiah(c.totalPurchase, "-")}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {c.quotationCount}
                        </td>
                        <td className="tbl-td tbl-td--center">
                          <button
                            className="action-btn"
                            title="Lihat detail"
                            style={{ color: "#7C3AED" }}
                            onClick={() => onViewDetail?.(c.id)}
                          >
                            <EyeIcon />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>

            <Pagination
              totalItems={totalItems}
              startIndex={startIndex}
              itemsPerPage={itemsPerPage}
              currentPage={currentPage}
              totalPages={totalPages}
              resourceLabel="Klien"
              onItemsPerPage={(n) => {
                setItemsPerPage(n)
                setCurrentPage(1)
              }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      <ClientAdd open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <ClientFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={(f) => {
            setFilters(f)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}

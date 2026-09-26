import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import EntityLogo from "@/components/shared/EntityLogo"
import EyeIcon from "@/components/shared/EyeIcon"
import FilterButton from "@/components/shared/FilterButton"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import ClientAdd from "@/features/clients/ClientAdd"
import ClientFilter, { type ClientFilterValues } from "@/features/clients/ClientFilter"
import { clientKpis } from "@/features/clients/helpers"
import { useClientSummary, useClients } from "@/features/clients/hooks"
import { useCountries } from "@/features/countries/hooks"
import { formatNumber, formatRupiah } from "@/lib/format"
import { BADGE_AKTIF, BADGE_NONAKTIF } from "@/lib/status"
import { ui } from "@/lib/ui"
import { useListScreen } from "@/lib/useListScreen"
import type { ClientRow } from "@/types/api"

export default function ClientList() {
  const { data: countriesData } = useCountries()
  const { data: summaryData } = useClientSummary()

  const [showAdd, setShowAdd] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const list = useListScreen<ClientFilterValues>({
    status: "all",
    countryCode: "",
    minTotal: "",
  })
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      isActive: filters.status === "all" ? undefined : filters.status === "active",
      countryCode: filters.countryCode || undefined,
      minTotal: filters.minTotal && filters.minTotal !== "0" ? filters.minTotal : undefined,
      limit: itemsPerPage,
      offset: startIndex,
    }),
    [debouncedSearch, filters, itemsPerPage, startIndex],
  )

  const { data: clientsData, isLoading } = useClients(queryParams)
  const currentRows = clientsData?.rows ?? []
  const totalItems = clientsData?.total ?? 0

  const countryOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of countriesData ?? []) map.set(c.code, c.name)
    return (code: string) => map.get(code) ?? code
  }, [countriesData])

  const kpis = useMemo(() => clientKpis(summaryData), [summaryData])

  const totalPages = list.totalPagesOf(totalItems)

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <h1 className={ui.pageTitle}>Daftar Klien</h1>
          <div className={ui.pageActions}>
            <button
              className={`${ui.btnPrimary} w-[200px]`}
              type="button"
              onClick={() => setShowAdd(true)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Tambah Klien
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard tone="violet" label="Total Klien" value={formatNumber(kpis.total)} />
          <StatCard tone="blue" label="Pertumbuhan tahun ini" value={kpis.growth} />
          <StatCard tone="green" label="Baru bulan ini" value={formatNumber(kpis.newThisMonth)} />
          <StatCard tone="gold" label="Klien aktif" value={kpis.activeShare} />
        </div>

        <div className="flex items-center gap-4 pt-2">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Cari nama klien..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[240px]`}>Nama Klien</th>
                <th className={`${ui.thCenter} w-[160px]`}>Negara</th>
                <th className={`${ui.thCenter} w-[140px]`}>Status</th>
                <th className={`${ui.thCenter} w-[180px]`}>Total Pembelian</th>
                <th className={`${ui.thCenter} w-[160px]`}>Jumlah Pembelian</th>
                <th className={`${ui.thCenter} w-[80px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableLoadingRow colSpan={6} />}
              {!isLoading && currentRows.length === 0 && (
                <TableEmptyRow colSpan={6}>Tidak ada klien.</TableEmptyRow>
              )}
              {!isLoading &&
                currentRows.map((c: ClientRow) => {
                  const status = c.isActive ? BADGE_AKTIF : BADGE_NONAKTIF
                  return (
                    <tr key={c.id} className={ui.tr}>
                      <td className={ui.td}>
                        <div className="flex items-center gap-4 pl-3">
                          <EntityLogo name={c.name} />
                          <span className="min-w-0 flex-1 break-words text-sm font-bold leading-[1.35] text-[#191C1E]">
                            <EntityLink kind="client" id={c.id} tone="name">
                              {c.name}
                            </EntityLink>
                          </span>
                        </div>
                      </td>
                      <td className={`${ui.tdCenter} text-sm font-medium text-[#191C1E]`}>
                        {countryOf(c.countryCode)}
                      </td>
                      <td className={ui.tdCenter}>
                        <StatusBadge bg={status.bg} color={status.color} minWidth={100}>
                          {status.label}
                        </StatusBadge>
                      </td>
                      <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                        {formatRupiah(c.totalPurchase, "-")}
                      </td>
                      <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                        {c.quotationCount}
                      </td>
                      <td className={ui.tdCenter}>
                        <Link
                          to="/clients/$id"
                          params={{ id: String(c.id) }}
                          className={ui.iconAction}
                          title="Lihat detail"
                          aria-label={`Lihat detail ${c.name}`}
                        >
                          <EyeIcon />
                        </Link>
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
            currentPage={list.currentPage}
            totalPages={totalPages}
            resourceLabel="Klien"
            isLoading={isLoading}
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
          />
        </div>
      </div>

      <ClientAdd open={showAdd} onOpenChange={setShowAdd} />

      {showFilter && (
        <ClientFilter
          onClose={() => setShowFilter(false)}
          initialValues={filters}
          onApply={list.applyFilters}
        />
      )}
    </>
  )
}

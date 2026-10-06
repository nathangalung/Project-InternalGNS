import { useMemo, useState } from "react"
import ActiveFilters from "@/components/shared/ActiveFilters"
import FilterButton from "@/components/shared/FilterButton"
import Modal from "@/components/shared/Modal"
import Pagination from "@/components/shared/Pagination"
import SearchInput from "@/components/shared/SearchInput"
import StatCard from "@/components/shared/StatCard"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useMe } from "@/features/auth/hooks"
import { filterChips } from "@/lib/filter-chips"
import { formatDate, formatRupiah } from "@/lib/format"
import { emptyListText } from "@/lib/list-empty"
import { managesInvoices } from "@/lib/rbac"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import { useListScreen, usePageWithin } from "@/lib/useListScreen"
import type { CashEntryRow } from "@/types/api"
import * as cashApi from "./api"
import CashEntryFilter from "./CashEntryFilter"
import CashEntryModal from "./CashEntryModal"
import { CASH_FILTERS, type CashFilterValues, cashParams, DIRECTION_LABEL } from "./helpers"
import { useCashEntries, useCashSummary, useDeleteCashEntry } from "./hooks"

const BADGE = {
  in: { bg: "#DCFCE7", color: "#166534" },
  out: { bg: "#FEE2E2", color: "#991B1B" },
} as const

// Kas Lain, money beyond sales and purchases.
export default function CashEntryList() {
  // Deleting and exporting are for the finance head
  const isHead = managesInvoices(useMe().data?.role)
  const [showFilter, setShowFilter] = useState(false)
  const [editing, setEditing] = useState<CashEntryRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<CashEntryRow | null>(null)
  const remove = useDeleteCashEntry()

  const list = useListScreen<CashFilterValues>(CASH_FILTERS)
  const { debouncedSearch, filters, itemsPerPage, startIndex } = list
  const filterParams = useMemo(
    () => cashParams(debouncedSearch, filters),
    [debouncedSearch, filters],
  )
  const pageParams = useMemo(
    () => cashParams(debouncedSearch, filters, { limit: itemsPerPage, offset: startIndex }),
    [debouncedSearch, filters, itemsPerPage, startIndex],
  )
  const { data, isLoading } = useCashEntries(pageParams)
  const { data: summary } = useCashSummary(filterParams)
  const rows = data?.rows ?? []
  const totalItems = data?.total ?? 0
  usePageWithin(list, data?.total)

  const chips = filterChips(
    { term: debouncedSearch, clear: list.clearSearch },
    filters,
    CASH_FILTERS,
    {
      direction: (v) => `Jenis: ${v === "all" ? "Semua" : DIRECTION_LABEL[v]}`,
      category: (v) => `Kategori: ${v}`,
      dateFrom: (v) => `Dari: ${formatDate(v)}`,
      dateTo: (v) => `Sampai: ${formatDate(v)}`,
    },
    list.patchFilters,
  )

  async function exportXlsx() {
    try {
      await cashApi.exportXlsx(filterParams)
    } catch {
      toast.error("Gagal mengekspor Kas Lain.")
    }
  }

  return (
    <>
      <div className={ui.pageContent}>
        <div className={ui.pageHeader}>
          <div>
            <h1 className={ui.pageTitle}>Kas Lain</h1>
            <p className="m-0 mt-1 text-sm text-dark-500">
              Dana masuk dan keluar di luar penjualan dan pembelian yang sudah tercatat otomatis.
            </p>
          </div>
          <div className={ui.pageActions}>
            {isHead && (
              <button
                type="button"
                className={`${ui.btnOutline} min-w-[160px] whitespace-nowrap`}
                onClick={() => void exportXlsx()}
              >
                Ekspor Excel
              </button>
            )}
            <button
              type="button"
              className={`${ui.btnPrimary} min-w-[180px] whitespace-nowrap`}
              onClick={() => setEditing("new")}
            >
              Tambah Catatan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
          <StatCard label="Total Masuk" value={formatRupiah(summary?.totalIn)} tone="green" />
          <StatCard label="Total Keluar" value={formatRupiah(summary?.totalOut)} tone="red" />
          <StatCard label="Selisih" value={formatRupiah(summary?.net)} tone="violet" />
        </div>

        <div className="flex items-center gap-4">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Cari keterangan atau kategori..."
          />
          <FilterButton onClick={() => setShowFilter(true)} />
        </div>

        <ActiveFilters
          chips={chips}
          onClearAll={() => {
            list.clearSearch()
            list.applyFilters(CASH_FILTERS)
          }}
        />

        <div className={ui.tableWrap}>
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[130px]`}>Tanggal</th>
                <th className={`${ui.thCenter} w-[110px]`}>Jenis</th>
                <th className={`${ui.thCenter} w-[180px]`}>Kategori</th>
                <th className={`${ui.thCenter} w-[260px]`}>Keterangan</th>
                <th className={`${ui.thCenter} w-[160px]`}>Jumlah</th>
                <th className={`${ui.thCenter} w-[150px]`}>Dicatat Oleh</th>
                <th className={`${ui.thCenter} w-[140px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableLoadingRow colSpan={7} />}
              {!isLoading && rows.length === 0 && (
                <TableEmptyRow colSpan={7}>
                  {emptyListText(list, "Belum ada catatan kas.")}
                </TableEmptyRow>
              )}
              {!isLoading &&
                rows.map((r) => (
                  <tr key={r.id} className={ui.tr}>
                    <td className={ui.tdCenter}>{formatDate(r.entryDate)}</td>
                    <td className={ui.tdCenter}>
                      <StatusBadge bg={BADGE[r.direction].bg} color={BADGE[r.direction].color}>
                        {DIRECTION_LABEL[r.direction]}
                      </StatusBadge>
                    </td>
                    <td className={ui.tdCenter}>{r.category}</td>
                    <td className={`${ui.td} break-words`}>{r.description}</td>
                    <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                      {formatRupiah(r.amount)}
                    </td>
                    <td className={ui.tdCenter}>{r.createdByName}</td>
                    <td className={ui.tdCenter}>
                      <div className="flex items-center justify-center gap-3">
                        <button
                          type="button"
                          className={`rounded-sm text-sm font-semibold text-primary-700 hover:underline ${ui.focusRing}`}
                          aria-label={`Ubah catatan ${r.description}`}
                          onClick={() => setEditing(r)}
                        >
                          Ubah
                        </button>
                        {isHead && (
                          <button
                            type="button"
                            className={`rounded-sm text-sm font-semibold text-error hover:underline ${ui.focusRing}`}
                            aria-label={`Hapus catatan ${r.description}`}
                            onClick={() => setDeleting(r)}
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Pagination
            totalItems={totalItems}
            startIndex={startIndex}
            itemsPerPage={itemsPerPage}
            currentPage={list.currentPage}
            totalPages={list.totalPagesOf(totalItems)}
            resourceLabel="Catatan"
            onItemsPerPage={list.setItemsPerPage}
            onPage={list.setCurrentPage}
          />
        </div>
      </div>

      {editing && (
        <CashEntryModal
          key={editing === "new" ? "new" : editing.id}
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {showFilter && (
        <CashEntryFilter
          initialValues={filters}
          onApply={list.applyFilters}
          onClose={() => setShowFilter(false)}
        />
      )}

      {deleting && (
        <Modal
          title="Hapus catatan kas?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={ui.modalCancel} onClick={() => setDeleting(null)}>
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
              >
                {remove.isPending ? "Menghapus..." : "Hapus"}
              </button>
            </>
          }
        >
          <p className="m-0 pb-4 text-sm text-[#4A4455]">
            {DIRECTION_LABEL[deleting.direction]} {formatRupiah(deleting.amount)} pada{" "}
            {formatDate(deleting.entryDate)}, {deleting.description}. Catatan yang dihapus tidak
            dapat dikembalikan.
          </p>
        </Modal>
      )}
    </>
  )
}

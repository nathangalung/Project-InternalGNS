import EntityLink from "@/components/shared/EntityLink"
import EyeIcon from "@/components/shared/EyeIcon"
import SortIcon from "@/components/shared/SortIcon"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { ui } from "@/lib/ui"
import { type QuotationRow, type SortableRowKey, statusConfig } from "./helpers"

type QuotationTableProps = {
  rows: QuotationRow[]
  isLoading: boolean
  sortKey: SortableRowKey | null
  sortDir: "asc" | "desc" | null
  onSort: (key: SortableRowKey) => void
  onViewDetail?: (id: string) => void
  onDownload?: (row: QuotationRow) => void
}

// Sort control, keyboard reachable.
const sortHead = `inline-flex w-full items-center justify-center gap-1.5 rounded-sm p-0 font-bold uppercase tracking-[0.05em] ${ui.focusRing}`

// Sortable rows with action buttons.
export default function QuotationTable({
  rows,
  isLoading,
  sortKey,
  sortDir,
  onSort,
  onViewDetail,
  onDownload,
}: QuotationTableProps) {
  const dirOf = (key: SortableRowKey) => (sortKey === key ? sortDir : null)
  const ariaSort = (key: SortableRowKey) => {
    const d = dirOf(key)
    return d === "asc" ? "ascending" : d === "desc" ? "descending" : undefined
  }
  return (
    <table className="w-full min-w-full table-auto border-collapse lg:table-fixed">
      <thead>
        <tr className={ui.theadRow}>
          <th className={`${ui.thCenter} w-[160px]`} aria-sort={ariaSort("displayNo")}>
            <button type="button" className={sortHead} onClick={() => onSort("displayNo")}>
              <span>Nomor Quotation</span>
              <SortIcon direction={dirOf("displayNo")} />
            </button>
          </th>
          <th className={`${ui.thCenter} w-[70px]`} aria-sort={ariaSort("version")}>
            <button type="button" className={sortHead} onClick={() => onSort("version")}>
              <span>Versi</span>
              <SortIcon direction={dirOf("version")} />
            </button>
          </th>
          <th className={`${ui.thCenter} w-[170px]`}>Nama Klien</th>
          <th className={`${ui.thCenter} w-[120px]`} aria-sort={ariaSort("date")}>
            <button type="button" className={sortHead} onClick={() => onSort("date")}>
              <span>Tanggal</span>
              <SortIcon direction={dirOf("date")} />
            </button>
          </th>
          <th className={`${ui.thCenter} w-[160px]`}>Total Harga Beli</th>
          <th className={`${ui.thCenter} w-[160px]`} aria-sort={ariaSort("total")}>
            <button type="button" className={sortHead} onClick={() => onSort("total")}>
              <span>Total Penawaran</span>
              <SortIcon direction={dirOf("total")} />
            </button>
          </th>
          <th className={`${ui.thCenter} w-[120px]`}>Status</th>
          <th className={`${ui.thCenter} w-[80px]`}>Aksi</th>
        </tr>
      </thead>
      <tbody>
        {isLoading && <TableLoadingRow colSpan={8} />}
        {!isLoading && rows.length === 0 && (
          <TableEmptyRow colSpan={8}>Belum ada Quotation.</TableEmptyRow>
        )}
        {!isLoading &&
          rows.map((row) => {
            const badge = statusConfig[row.status]
            return (
              <tr key={row.id} className={ui.tr}>
                <td className={`${ui.tdCenter} truncate font-bold`}>
                  <EntityLink kind="quotation" id={Number(row.id)}>
                    {row.displayNo}
                  </EntityLink>
                </td>
                <td className={`${ui.tdCenter} truncate`}>{row.version}</td>
                <td className={`${ui.tdCenter} truncate font-medium text-dark-900`}>
                  {row.client}
                </td>
                <td className={`${ui.tdCenter} truncate`}>{row.date}</td>
                <td className={`${ui.tdCenter} truncate`}>{row.hargaBeli}</td>
                <td className={`${ui.tdCenter} truncate font-bold text-dark-900`}>{row.total}</td>
                <td className={ui.tdCenter}>
                  <StatusBadge bg={badge.bg} color={badge.color}>
                    {row.status}
                  </StatusBadge>
                </td>
                <td className={ui.tdCenter}>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      className={ui.iconAction}
                      title="Lihat"
                      aria-label={`Lihat ${row.displayNo}`}
                      onClick={() => onViewDetail?.(row.id)}
                    >
                      <EyeIcon size={18} />
                    </button>
                    <button
                      type="button"
                      className={ui.iconAction}
                      title="Unduh PDF"
                      aria-label={`Unduh PDF ${row.displayNo}`}
                      onClick={() => onDownload?.(row)}
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
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
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
      </tbody>
    </table>
  )
}

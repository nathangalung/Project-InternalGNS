import EyeIcon from "@/components/shared/EyeIcon"
import SortIcon from "@/components/shared/SortIcon"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { ui } from "@/lib/ui"
import { type QuotationRow, type SortableRowKey, statusConfig } from "./helpers"

interface QuotationTableProps {
  rows: QuotationRow[]
  isLoading: boolean
  sortKey: SortableRowKey | null
  sortDir: "asc" | "desc" | null
  onSort: (key: SortableRowKey) => void
  onViewDetail?: (id: string) => void
  onDownload?: (row: QuotationRow) => void
}

const sortHead = "flex items-center justify-center gap-1.5"

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
  return (
    <table className="w-full min-w-full table-auto border-collapse lg:table-fixed">
      <thead>
        <tr className={ui.theadRow}>
          <th
            className={`${ui.thCenter} cursor-pointer`}
            style={{ width: 160 }}
            onClick={() => onSort("displayNo")}
          >
            <div className={sortHead}>
              <span>Nomor Quotation</span>
              <SortIcon direction={dirOf("displayNo")} />
            </div>
          </th>
          <th
            className={`${ui.thCenter} cursor-pointer`}
            style={{ width: 70 }}
            onClick={() => onSort("version")}
          >
            <div className={sortHead}>
              <span>Versi</span>
              <SortIcon direction={dirOf("version")} />
            </div>
          </th>
          <th className={ui.thCenter} style={{ width: 170 }}>
            Nama Klien
          </th>
          <th
            className={`${ui.thCenter} cursor-pointer`}
            style={{ width: 120 }}
            onClick={() => onSort("date")}
          >
            <div className={sortHead}>
              <span>Tanggal</span>
              <SortIcon direction={dirOf("date")} />
            </div>
          </th>
          <th className={ui.thCenter} style={{ width: 160 }}>
            Total Harga Beli
          </th>
          <th
            className={`${ui.thCenter} cursor-pointer`}
            style={{ width: 160 }}
            onClick={() => onSort("total")}
          >
            <div className={sortHead}>
              <span>Total Penawaran</span>
              <SortIcon direction={dirOf("total")} />
            </div>
          </th>
          <th className={ui.thCenter} style={{ width: 120 }}>
            Status
          </th>
          <th className={ui.thCenter} style={{ width: 80 }}>
            Aksi
          </th>
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
                <td className={`${ui.tdCenter} truncate font-bold text-primary-700`}>
                  {row.displayNo}
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
                      onClick={() => onViewDetail?.(row.id)}
                    >
                      <EyeIcon size={18} />
                    </button>
                    <button
                      type="button"
                      className={ui.iconAction}
                      title="Download"
                      onClick={() => onDownload?.(row)}
                    >
                      <svg
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

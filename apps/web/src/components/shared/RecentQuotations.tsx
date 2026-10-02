import type { ReactNode } from "react"
import StatusBadge from "@/components/shared/StatusBadge"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { quotationBadge, quotationStatusLabel } from "@/lib/status"
import { ui } from "@/lib/ui"
import type { QuotationStatus } from "@/types/api"

type Column = { label: string; className?: string }

type RecentQuotationsProps<T> = {
  // What the quotations are of, for the empty text
  subject: string
  rows: T[] | undefined
  isPending: boolean
  isError: boolean
  columns: Column[]
  rowKey: (row: T) => string
  renderRow: (row: T) => ReactNode
}

// Newest quotations of a record.
//
// The same section on the product, vendor and client pages: only quotations
// that reached the client count (every status but Draf and Dibatalkan),
// newest first, at most five. Each page supplies its own columns.
export default function RecentQuotations<T>({
  subject,
  rows,
  isPending,
  isError,
  columns,
  rowKey,
  renderRow,
}: RecentQuotationsProps<T>) {
  const span = columns.length
  return (
    <section
      aria-labelledby="quotation-terakhir"
      className="flex flex-col gap-4 rounded-lg bg-white p-8 max-sm:p-5"
    >
      <div>
        <h3
          id="quotation-terakhir"
          className="m-0 text-xl font-extrabold leading-7 tracking-[-0.5px] text-[#191C1E]"
        >
          Quotation Terakhir
        </h3>
        <p className="mt-1 text-sm text-[#4A4455]">
          Lima quotation terbaru yang sudah dikirim ke klien.
        </p>
      </div>
      <div className={ui.tableWrap}>
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className={ui.theadRow}>
              {columns.map((c) => (
                <th key={c.label} className={c.className ?? ui.thCenter}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isPending && <TableLoadingRow colSpan={span} />}
            {isError && <TableEmptyRow colSpan={span}>Gagal memuat quotation.</TableEmptyRow>}
            {!isPending && !isError && (rows ?? []).length === 0 && (
              <TableEmptyRow colSpan={span}>Belum ada quotation untuk {subject} ini.</TableEmptyRow>
            )}
            {!isPending &&
              !isError &&
              (rows ?? []).map((row) => (
                <tr key={rowKey(row)} className={ui.tr}>
                  {renderRow(row)}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Quotation status badge.
export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  const label = quotationStatusLabel(status)
  const badge = quotationBadge[label]
  return (
    <StatusBadge bg={badge.bg} color={badge.color}>
      {label}
    </StatusBadge>
  )
}

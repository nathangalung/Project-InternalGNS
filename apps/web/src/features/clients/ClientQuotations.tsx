import EntityLink from "@/components/shared/EntityLink"
import RecentQuotations, { QuotationStatusBadge } from "@/components/shared/RecentQuotations"
import { useMe } from "@/features/auth/hooks"
import { useClientRecentQuotations } from "@/features/clients/hooks"
import { formatDate, formatRupiah } from "@/lib/format"
import { seesSelling } from "@/lib/rbac"
import { ui } from "@/lib/ui"

const columns = [
  { label: "Tanggal" },
  { label: "No. Quotation" },
  { label: "Narahubung" },
  { label: "Jumlah Produk" },
  { label: "Total Penawaran" },
  { label: "Status" },
]

// The client's newest quotations.
// The total is a selling figure, left out for a role that sees none.
export default function ClientQuotations({ clientId }: { clientId: number }) {
  const { data, isPending, isError } = useClientRecentQuotations(clientId)
  const showTotal = seesSelling(useMe().data?.role)
  return (
    <RecentQuotations
      subject="klien"
      rows={data}
      isPending={isPending}
      isError={isError}
      columns={showTotal ? columns : columns.filter((c) => c.label !== "Total Penawaran")}
      rowKey={(r) => String(r.id)}
      renderRow={(r) => (
        <>
          <td className={ui.tdCenter}>{formatDate(r.createdAt)}</td>
          <td className={ui.tdCenter}>
            <EntityLink kind="quotation" id={r.id}>
              {r.quotationNo}
            </EntityLink>
          </td>
          <td className={ui.tdCenter}>{r.contactName ?? "-"}</td>
          <td className={ui.tdCenter}>{r.productCount} produk</td>
          {showTotal && (
            <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
              {formatRupiah(r.grandTotal)}
            </td>
          )}
          <td className={ui.tdCenter}>
            <QuotationStatusBadge status={r.status} />
          </td>
        </>
      )}
    />
  )
}

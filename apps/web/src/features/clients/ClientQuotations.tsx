import EntityLink from "@/components/shared/EntityLink"
import RecentQuotations, { QuotationStatusBadge } from "@/components/shared/RecentQuotations"
import { useClientRecentQuotations } from "@/features/clients/hooks"
import { formatDate, formatRupiah } from "@/lib/format"
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
export default function ClientQuotations({ clientId }: { clientId: number }) {
  const { data, isPending, isError } = useClientRecentQuotations(clientId)
  return (
    <RecentQuotations
      subject="klien"
      rows={data}
      isPending={isPending}
      isError={isError}
      columns={columns}
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
          <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
            {formatRupiah(r.grandTotal)}
          </td>
          <td className={ui.tdCenter}>
            <QuotationStatusBadge status={r.status} />
          </td>
        </>
      )}
    />
  )
}

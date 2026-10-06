import EntityLink from "@/components/shared/EntityLink"
import RecentQuotations, { QuotationStatusBadge } from "@/components/shared/RecentQuotations"
import { useItemRecentQuotations } from "@/features/items/hooks"
import { formatDate, formatNumber, formatRupiah } from "@/lib/format"
import { ui } from "@/lib/ui"

const columns = [
  { label: "Tanggal" },
  { label: "No. Quotation" },
  { label: "Klien" },
  { label: "Narahubung" },
  { label: "Vendor" },
  { label: "Jumlah" },
  { label: "Harga Beli" },
  { label: "Harga Jual" },
  { label: "Status" },
]

// The product's newest quotation lines.
export default function ProductQuotations({ itemId }: { itemId: number }) {
  const { data, isPending, isError } = useItemRecentQuotations(itemId)
  return (
    <RecentQuotations
      subject="produk"
      rows={data}
      isPending={isPending}
      isError={isError}
      columns={columns}
      rowKey={(r) => String(r.lineId)}
      renderRow={(r) => (
        <>
          <td className={ui.tdCenter}>{formatDate(r.quotationDate)}</td>
          <td className={ui.tdCenter}>
            <EntityLink kind="quotation" id={r.quotationId}>
              {r.quotationNo}
            </EntityLink>
          </td>
          <td className={ui.tdCenter}>
            <EntityLink kind="client" id={r.clientId} tone="name">
              {r.clientName}
            </EntityLink>
          </td>
          <td className={ui.tdCenter}>{r.contactName ?? "-"}</td>
          <td className={ui.tdCenter}>
            {r.vendorName ? (
              <EntityLink kind="vendor" id={r.vendorId} tone="name">
                {r.vendorName}
              </EntityLink>
            ) : (
              "-"
            )}
          </td>
          <td className={ui.tdCenter}>{formatNumber(r.qty)}</td>
          <td className={ui.tdCenter}>{formatRupiah(r.costPrice, "-")}</td>
          <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
            {formatRupiah(r.sellingPrice, "-")}
          </td>
          <td className={ui.tdCenter}>
            <QuotationStatusBadge status={r.status} />
          </td>
        </>
      )}
    />
  )
}

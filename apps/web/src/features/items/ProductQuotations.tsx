import EntityLink from "@/components/shared/EntityLink"
import RecentQuotations, { QuotationStatusBadge } from "@/components/shared/RecentQuotations"
import { useMe } from "@/features/auth/hooks"
import { useItemRecentQuotations } from "@/features/items/hooks"
import { formatDate, formatNumber, formatRupiah } from "@/lib/format"
import { seesCost, seesSelling } from "@/lib/rbac"
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
// Each price column shows only to a role that sees that side.
export default function ProductQuotations({ itemId }: { itemId: number }) {
  const { data, isPending, isError } = useItemRecentQuotations(itemId)
  const role = useMe().data?.role
  const cost = seesCost(role)
  const selling = seesSelling(role)
  const shown = columns.filter(
    (c) => (c.label !== "Harga Beli" || cost) && (c.label !== "Harga Jual" || selling),
  )
  return (
    <RecentQuotations
      subject="produk"
      rows={data}
      isPending={isPending}
      isError={isError}
      columns={shown}
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
          {cost && <td className={ui.tdCenter}>{formatRupiah(r.costPrice, "-")}</td>}
          {selling && (
            <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
              {formatRupiah(r.sellingPrice, "-")}
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

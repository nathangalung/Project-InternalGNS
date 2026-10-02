import EntityLink from "@/components/shared/EntityLink"
import RecentQuotations, { QuotationStatusBadge } from "@/components/shared/RecentQuotations"
import { useVendorRecentQuotations } from "@/features/vendors/hooks"
import { formatDate } from "@/lib/format"
import { ui } from "@/lib/ui"

const columns = [
  { label: "Tanggal" },
  { label: "No. Quotation" },
  { label: "Klien" },
  { label: "Narahubung" },
  { label: "Produk" },
  { label: "Status" },
]

// The vendor's newest quotation lines.
export default function VendorQuotations({ vendorId }: { vendorId: number }) {
  const { data, isPending, isError } = useVendorRecentQuotations(vendorId)
  return (
    <RecentQuotations
      subject="vendor"
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
            <EntityLink kind="product" id={r.itemId} tone="name">
              {r.itemName}
            </EntityLink>
            {r.impaCode && <span className="block text-xs text-dark-500">IMPA {r.impaCode}</span>}
          </td>
          <td className={ui.tdCenter}>
            <QuotationStatusBadge status={r.status} />
          </td>
        </>
      )}
    />
  )
}

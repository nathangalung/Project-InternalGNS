import type { ShippingRow } from "@/features/quotations/types"
import { formatRupiah as formatRp } from "@/lib/format"
import { ui } from "@/lib/ui"

interface ShippingTableProps {
  shipping: ShippingRow
}

// Single shipping row with formatting.
export default function ShippingTable({ shipping }: ShippingTableProps) {
  return (
    <div>
      <h2 className="qe-section-title mb-3">Detail Pengiriman</h2>
      <div className={ui.tableWrap}>
        <table className="w-full min-w-full table-auto border-collapse lg:table-fixed">
          <thead>
            <tr className={ui.theadRow}>
              <th className={ui.thCenter} style={{ width: 200 }}>
                Nama
              </th>
              <th className={ui.thCenter} style={{ width: 200 }}>
                Waktu Pengiriman (Hari Kerja)
              </th>
              <th className={ui.thCenter} style={{ width: 160 }}>
                Harga Jual Satuan
              </th>
              <th className={ui.thCenter} style={{ width: 160 }}>
                Total (Rp)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className={ui.tr}>
              <td className={`${ui.tdCenter} truncate font-medium text-dark-900`}>
                {shipping.nama}
              </td>
              <td className={`${ui.tdCenter} truncate`}>{shipping.hari ?? "-"}</td>
              <td className={`${ui.tdCenter} truncate`}>{formatRp(shipping.hargaSatuan)}</td>
              <td className={`${ui.tdCenter} truncate font-bold text-dark-900`}>
                {formatRp(shipping.hargaSatuan)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

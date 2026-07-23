import type { ShippingRow } from "@/features/quotations/types"
import { formatRupiah as formatRp } from "@/lib/format"

interface ShippingTableProps {
  shipping: ShippingRow
}

// Single shipping row with formatting.
export default function ShippingTable({ shipping }: ShippingTableProps) {
  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
        Detail Pengiriman
      </h2>
      <div className="tbl-container">
        <table className="tbl">
          <thead>
            <tr className="tbl-header-row">
              <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                Nama
              </th>
              <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                Waktu Pengiriman (Hari Kerja)
              </th>
              <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                Harga Jual Satuan
              </th>
              <th className="tbl-th tbl-th--center" style={{ width: 160 }}>
                Total (Rp)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="tbl-row">
              <td className="tbl-td tbl-td--center tbl-td--client">{shipping.nama}</td>
              <td className="tbl-td tbl-td--center">{shipping.hari ?? "-"}</td>
              <td className="tbl-td tbl-td--center">{formatRp(shipping.hargaSatuan)}</td>
              <td className="tbl-td tbl-td--center tbl-td--total">
                {formatRp(shipping.hargaSatuan)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

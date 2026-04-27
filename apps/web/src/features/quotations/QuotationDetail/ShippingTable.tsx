import { formatRp } from "@/features/quotations/types";
import type { ShippingRow } from "@/features/quotations/types";

interface ShippingTableProps {
  shipping: ShippingRow;
}

// Single shipping row with formatting.
export default function ShippingTable({ shipping }: ShippingTableProps) {
  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Detail Pengiriman</h2>
      <div className="tbl-container">
        <table className="tbl">
          <thead>
            <tr className="tbl-header-row">
              <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Nama</th>
              <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Waktu Pengiriman (Hari Kerja)</th>
              <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Harga Satuan</th>
              <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Total (Rp)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="tbl-row">
              <td className="tbl-td tbl-td--center tbl-td--client">{shipping.nama}</td>
              <td className="tbl-td tbl-td--center">{shipping.hari ?? "-"}</td>
              <td className="tbl-td tbl-td--center">{formatRp(shipping.hargaSatuan)}</td>
              <td className="tbl-td tbl-td--center tbl-td--total">{formatRp(shipping.hargaSatuan)}</td>
            </tr>
          </tbody>
        </table>
        <div className="pagination" style={{ justifyContent: "space-between" }}>
          <span className="pagination-info">Menampilkan 1 dari 1 Pengiriman</span>
          <div className="page-buttons">
            <button className="page-btn-nav" disabled>
              <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
                <path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="page-btn page-btn--active">1</button>
            <button className="page-btn-nav" disabled>
              <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
                <path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

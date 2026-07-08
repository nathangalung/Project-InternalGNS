import { formatRupiah as formatRp } from "@/lib/format"

interface CostBreakdownProps {
  hasProducts: boolean
  totalProduk: number
  discountPct: number
  nominalDiskon: number
  subTotal: number
  dppNilaiLain: number
  ppn12: number
  totalShip: number
  totalProfit: number
  showProfit?: boolean
  grandTotal: number
}

// Cost summary, totals, grand total.
export default function CostBreakdown({
  hasProducts,
  totalProduk,
  discountPct,
  nominalDiskon,
  subTotal,
  dppNilaiLain,
  ppn12,
  totalShip,
  totalProfit,
  showProfit = true,
  grandTotal,
}: CostBreakdownProps) {
  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
        Rincian Biaya
      </h2>
      <div
        style={{
          background: "#F8FAFC",
          borderRadius: "12px",
          padding: "24px",
          border: "1px solid rgba(204,195,216,0.1)",
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}
        >
          {hasProducts && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4B5563",
              }}
            >
              <span>Total Produk</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(totalProduk)}</span>
            </div>
          )}
          {hasProducts && discountPct > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4B5563",
              }}
            >
              <span>Diskon ({discountPct}%)</span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ textDecoration: "line-through", color: "#9CA3AF" }}>
                  {formatRp(totalProduk)}
                </span>
                <span style={{ fontWeight: 600, color: "#10B981" }}>
                  - {formatRp(nominalDiskon)}
                </span>
              </div>
            </div>
          )}
          {hasProducts && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4B5563",
              }}
            >
              <span>Sub Total</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(subTotal)}</span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>DPP Nilai Lain</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(dppNilaiLain)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>PPN 12%</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(ppn12)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>Biaya Pengiriman</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(totalShip)}</span>
          </div>
        </div>

        <div style={{ height: "1px", background: "#E5E7EB", marginBottom: "16px" }} />

        {hasProducts && showProfit && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "11px",
              fontWeight: 700,
              color: "#6B7280",
              textTransform: "uppercase",
              marginBottom: "20px",
            }}
          >
            <span>Total Estimasi Profit</span>
            <span style={{ color: "#630ED4", fontSize: "12px" }}>{formatRp(totalProfit)}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#6B7280",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            Grand Total
          </span>
          <span
            style={{ fontSize: "28px", fontWeight: 800, color: "#630ED4", letterSpacing: "-0.5px" }}
          >
            {formatRp(grandTotal)}
          </span>
        </div>
      </div>
    </div>
  )
}

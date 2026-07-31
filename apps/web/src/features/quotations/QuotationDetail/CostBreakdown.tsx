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

const row = "flex justify-between text-xs text-[#4B5563]"
const rowValue = "font-semibold text-[#111827]"

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
      <h2 className="qe-section-title mb-3">Rincian Biaya</h2>
      <div className="rounded-lg border border-[rgba(204,195,216,0.1)] bg-dark-50 p-6">
        <div className="mb-5 flex flex-col gap-3">
          {hasProducts && (
            <div className={row}>
              <span>Total Produk</span>
              <span className={rowValue}>{formatRp(totalProduk)}</span>
            </div>
          )}
          {hasProducts && discountPct > 0 && (
            <div className={row}>
              <span>Diskon ({discountPct}%)</span>
              <div className="flex items-center gap-2">
                <span className="text-[#9CA3AF] line-through">{formatRp(totalProduk)}</span>
                <span className="font-semibold text-[#10B981]">- {formatRp(nominalDiskon)}</span>
              </div>
            </div>
          )}
          {hasProducts && (
            <div className={row}>
              <span>Sub Total</span>
              <span className={rowValue}>{formatRp(subTotal)}</span>
            </div>
          )}
          <div className={row}>
            <span>DPP Nilai Lain</span>
            <span className={rowValue}>{formatRp(dppNilaiLain)}</span>
          </div>
          <div className={row}>
            <span>PPN 12%</span>
            <span className={rowValue}>{formatRp(ppn12)}</span>
          </div>
          <div className={row}>
            <span>Biaya Pengiriman</span>
            <span className={rowValue}>{formatRp(totalShip)}</span>
          </div>
        </div>

        <div className="mb-4 h-px bg-[#E5E7EB]" />

        {hasProducts && showProfit && (
          <div className="mb-5 flex justify-between text-[11px] font-bold uppercase text-[#6B7280]">
            <span>Total Estimasi Profit</span>
            <span className="text-xs text-[#630ED4]">{formatRp(totalProfit)}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[1px] text-[#6B7280]">
            Grand Total
          </span>
          <span className="text-[28px] font-extrabold tracking-[-0.5px] text-[#630ED4]">
            {formatRp(grandTotal)}
          </span>
        </div>
      </div>
    </div>
  )
}

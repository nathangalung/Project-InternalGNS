import { formatRupiah as formatRp } from "@/lib/format"
import { qe } from "../wizard-styles"
import { discountLabel } from "./helpers"

interface CostBreakdownProps {
  hasProducts: boolean
  // Every line, shipping included, before the discount.
  total: number
  // Unknown on an invoice older than its gross snapshot.
  discountPct?: number
  nominalDiskon: number
  subTotal: number
  dppNilaiLain: number
  ppn12: number
  // False when the document is sold without PPN
  withPPN?: boolean
  totalProfit: number
  showProfit?: boolean
  grandTotal: number
}

const row = "flex justify-between text-xs text-[#4B5563]"
const rowValue = "font-semibold text-[#111827]"

// Cost summary, totals, grand total.
//
// The rows the quotation and invoice PDFs print: Total, Diskon Produk,
// Sub Total, the PPN pair, Grand Total. Shipping is in Total.
export default function CostBreakdown({
  hasProducts,
  total,
  discountPct = 0,
  nominalDiskon,
  subTotal,
  dppNilaiLain,
  ppn12,
  withPPN = true,
  totalProfit,
  showProfit = true,
  grandTotal,
}: CostBreakdownProps) {
  return (
    <div>
      <h2 className={`${qe.sectionTitle} mb-3`}>Rincian Biaya</h2>
      <div className="rounded-lg border border-[rgba(204,195,216,0.1)] bg-dark-50 p-6">
        <div className="mb-5 flex flex-col gap-3">
          {hasProducts && (
            <div className={row}>
              <span>Total</span>
              <span className={rowValue}>{formatRp(total)}</span>
            </div>
          )}
          {hasProducts && nominalDiskon > 0 && (
            <div className={row}>
              <span>{discountLabel(discountPct)}</span>
              <span className="font-semibold text-[#10B981]">- {formatRp(nominalDiskon)}</span>
            </div>
          )}
          {hasProducts && (
            <div className={row}>
              <span>Sub Total</span>
              <span className={rowValue}>{formatRp(subTotal)}</span>
            </div>
          )}
          {withPPN ? (
            <>
              <div className={row}>
                <span>DPP Nilai Lain</span>
                <span className={rowValue}>{formatRp(dppNilaiLain)}</span>
              </div>
              <div className={row}>
                <span>PPN 12%</span>
                <span className={rowValue}>{formatRp(ppn12)}</span>
              </div>
            </>
          ) : (
            <div className={row}>
              <span>PPN</span>
              <span className={rowValue}>Tanpa PPN</span>
            </div>
          )}
        </div>

        <div className="mb-4 h-px bg-[#E5E7EB]" />

        {hasProducts && showProfit && (
          <div className="mb-5 flex justify-between text-[11px] font-bold uppercase text-[#6B7280]">
            <span>Total Estimasi Profit</span>
            <span className="text-xs text-primary-700">{formatRp(totalProfit)}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[1px] text-[#6B7280]">
            Grand Total
          </span>
          <span className="text-[28px] font-extrabold tracking-[-0.5px] text-primary-700">
            {formatRp(grandTotal)}
          </span>
        </div>
      </div>
    </div>
  )
}

import type { ProductRow } from "@/features/quotations/types"

export { getPageNumbers, PAGE_SIZE_OPTIONS } from "@/lib/pagination"

// Product profit after the discount.
//
// The header discount comes off the selling side only, so it comes straight
// off the gross line profit. Matches the wizard's subtotal minus cost.
export function profitAfterDiscount(products: ProductRow[], totalDiscount: number): number {
  const gross = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  return gross - totalDiscount
}

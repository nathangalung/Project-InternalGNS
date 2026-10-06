import type { ProductRow } from "@/features/quotations/types"

// Product profit after the discount.
//
// The header discount comes off the selling side only, so it comes straight
// off the gross line profit. Matches the wizard's subtotal minus cost.
export function profitAfterDiscount(products: ProductRow[], totalDiscount: number): number {
  const gross = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  return gross - totalDiscount
}

// Offer is not the request.
// Mirrors requestDiffers in the wizard: a request with no code or no name
// does not differ on it.
export function offerDiffers(p: ProductRow): boolean {
  const kode = p.requestedKode ?? ""
  const nama = p.requestedNama ?? ""
  return (kode !== "" && kode !== p.kode) || (nama !== "" && nama !== p.nama)
}

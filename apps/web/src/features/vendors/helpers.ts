export type VendorItemsSummary = {
  // Heading count, "200+" when capped
  count: string
  // Shown only when the list is capped
  notice: string | null
}

// Product list count and cap notice.
//
// GET /vendors/{id}/items has no offset or total and stops at the server
// cap, so a full page means there may be more rows than shown.
export function vendorItemsSummary(shown: number, limit: number): VendorItemsSummary {
  if (shown >= limit) {
    return {
      count: `${limit}+`,
      notice: `Menampilkan ${limit} produk pertama menurut nama. Produk lain dari vendor ini dapat dicari di halaman Produk.`,
    }
  }
  return { count: String(shown), notice: null }
}

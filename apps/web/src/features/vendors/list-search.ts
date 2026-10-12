import type { StatusFilterValue } from "@/lib/filter-options"
import {
  activeStatus,
  amount,
  compact,
  type ListSchema,
  listSearchValidator,
  trimmed,
} from "@/lib/list-search"
import type { VendorFilterValues } from "./VendorFilter"

export type VendorSortKey = "totalPembelian" | "productCount"

// Filters as URL params.
export type VendorFilterSearch = {
  status?: Exclude<StatusFilterValue, "all">
  location?: string
  min?: string
}

// Filters with nothing applied.
export const VENDOR_FILTERS: VendorFilterValues = { status: "all", countryName: "", minTotal: "" }

// Search, filters, page and sort.
export const vendorListSchema: ListSchema<VendorFilterValues, VendorSortKey, VendorFilterSearch> = {
  filters: VENDOR_FILTERS,
  sortKeys: ["totalPembelian", "productCount"],
  readFilters: (raw) => ({
    status: activeStatus(raw.status),
    countryName: trimmed(raw.location) ?? "",
    minTotal: amount(raw.min) ?? "",
  }),
  writeFilters: (f) =>
    compact({
      status: f.status === "all" ? undefined : f.status,
      location: trimmed(f.countryName),
      min: amount(f.minTotal),
    }),
}

export const validateVendorSearch = listSearchValidator(vendorListSchema)

// The vendor page's product table.
//
// It has no search or filters, only its page and page size.
export const vendorItemsSchema: ListSchema<Record<string, never>> = {
  filters: {},
  searchable: false,
  readFilters: () => ({}),
  writeFilters: () => ({}),
}

export const validateVendorItemsSearch = listSearchValidator(vendorItemsSchema)

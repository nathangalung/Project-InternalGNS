import type { StatusFilterValue } from "@/lib/filter-options"
import {
  activeStatus,
  compact,
  type ListSchema,
  listSearchValidator,
  trimmed,
} from "@/lib/list-search"
import type { ProductFilterValues } from "./ProductFilter"

// Filters as URL params.
export type ProductFilterSearch = {
  status?: Exclude<StatusFilterValue, "all">
  unit?: string
}

// Filters with nothing applied.
export const PRODUCT_FILTERS: ProductFilterValues = { status: "all", unitCode: "" }

// Search, filters and page.
export const productListSchema: ListSchema<ProductFilterValues, never, ProductFilterSearch> = {
  filters: PRODUCT_FILTERS,
  readFilters: (raw) => ({
    status: activeStatus(raw.status),
    unitCode: trimmed(raw.unit) ?? "",
  }),
  writeFilters: (f) =>
    compact({
      status: f.status === "all" ? undefined : f.status,
      unit: trimmed(f.unitCode),
    }),
}

export const validateProductSearch = listSearchValidator(productListSchema)

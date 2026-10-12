import type { StatusFilterValue } from "@/lib/filter-options"
import {
  activeStatus,
  amount,
  compact,
  type ListSchema,
  listSearchValidator,
  trimmed,
} from "@/lib/list-search"
import type { ClientFilterValues } from "./ClientFilter"

// Filters as URL params.
export type ClientFilterSearch = {
  status?: Exclude<StatusFilterValue, "all">
  country?: string
  min?: string
}

// Filters with nothing applied.
export const CLIENT_FILTERS: ClientFilterValues = { status: "all", countryCode: "", minTotal: "" }

// Search, filters and page.
export const clientListSchema: ListSchema<ClientFilterValues, never, ClientFilterSearch> = {
  filters: CLIENT_FILTERS,
  readFilters: (raw) => ({
    status: activeStatus(raw.status),
    countryCode: trimmed(raw.country) ?? "",
    minTotal: amount(raw.min) ?? "",
  }),
  writeFilters: (f) =>
    compact({
      status: f.status === "all" ? undefined : f.status,
      country: trimmed(f.countryCode),
      min: amount(f.minTotal),
    }),
}

export const validateClientSearch = listSearchValidator(clientListSchema)

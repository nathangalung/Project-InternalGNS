import type { StatusFilterValue } from "@/lib/filter-options"
import {
  activeStatus,
  compact,
  type ListSchema,
  listSearchValidator,
  oneOf,
} from "@/lib/list-search"
import type { Role } from "@/types/api"
import { ROLE_LABEL } from "./helpers"
import type { RoleFilter, StatusFilter } from "./UserFilter"

export type UserSortKey = "name" | "createdAt"

export type UserFilters = { role: RoleFilter; status: StatusFilter }

// Filters as URL params.
export type UserFilterSearch = {
  role?: Role
  status?: Exclude<StatusFilterValue, "all">
}

const ROLES = Object.keys(ROLE_LABEL) as Role[]

// Filters with nothing applied.
export const USER_FILTERS: UserFilters = { role: "all", status: "all" }

// Search, filters, page and sort.
//
// Newest accounts come first until a header is sorted.
export const userListSchema: ListSchema<UserFilters, UserSortKey, UserFilterSearch> = {
  filters: USER_FILTERS,
  sortKeys: ["name", "createdAt"],
  sort: { key: "createdAt", dir: "desc" },
  readFilters: (raw) => ({
    role: oneOf(raw.role, ROLES) ?? "all",
    status: activeStatus(raw.status),
  }),
  writeFilters: (f) =>
    compact({
      role: f.role === "all" ? undefined : f.role,
      status: f.status === "all" ? undefined : f.status,
    }),
}

export const validateUserSearch = listSearchValidator(userListSchema)

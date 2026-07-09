import type { Role } from "@/types/api"

// Top-level app sections gated by role.
export type Section =
  | "dashboard"
  | "dashboard-financial"
  | "dashboard-operational"
  | "quotation"
  | "purchase-orders"
  | "invoices"
  | "users"
  | "clients"
  | "vendors"
  | "products"

const COMMON: Section[] = ["dashboard", "clients", "vendors", "products"]

const EXTRA: Record<Role, Section[]> = {
  superadmin: [
    "dashboard-financial",
    "dashboard-operational",
    "quotation",
    "purchase-orders",
    "invoices",
    "users",
  ],
  operational: ["dashboard-operational", "quotation", "purchase-orders"],
  finance: ["dashboard-financial", "invoices"],
}

// Unknown role only sees common sections.
export function roleCanAccess(role: Role | undefined, section: Section): boolean {
  if (COMMON.includes(section)) return true
  if (!role) return false
  return EXTRA[role]?.includes(section) ?? false
}

// Maps a pathname to its section.
export function sectionFromPathname(pathname: string): Section {
  const first = pathname.split("/").filter(Boolean)[0] ?? ""
  switch (first) {
    case "dashboard-financial":
      return "dashboard-financial"
    case "dashboard-operational":
      return "dashboard-operational"
    case "quotations":
      return "quotation"
    case "purchase-orders":
      return "purchase-orders"
    case "invoices":
      return "invoices"
    case "users":
      return "users"
    case "clients":
      return "clients"
    case "vendors":
      return "vendors"
    case "products":
      return "products"
    default:
      return "dashboard"
  }
}

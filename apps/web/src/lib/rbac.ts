import type { Role } from "@/types/api"

// Role-gated top-level sections.
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

// Unknown roles see common sections.
export function roleCanAccess(role: Role | undefined, section: Section): boolean {
  if (COMMON.includes(section)) return true
  if (!role) return false
  return EXTRA[role]?.includes(section) ?? false
}

// Catalog write access.
//
// Mirrors the API's readOnlyFor("finance") on /items and /vendors. An
// unknown role fails closed, so write actions never flash in before
// /auth/me loads.
export function canWriteCatalog(role: Role | undefined): boolean {
  return role === "superadmin" || role === "operational"
}

// Pathname to its section.
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

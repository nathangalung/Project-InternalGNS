import type { Role } from "@/types/api"

// Role-gated top-level sections.
export type Section =
  | "dashboard"
  | "dashboard-financial"
  | "dashboard-operational"
  | "quotation"
  | "purchase-orders"
  | "invoices"
  | "cash-entries"
  | "users"
  | "clients"
  | "vendors"
  | "products"

const COMMON: Section[] = ["dashboard", "clients", "vendors", "products"]

// Mirrors the API mount gates (apps/api/internal/app/router.go). The
// finance head reads quotations and POs; finance input reads POs.
const EXTRA: Record<Role, Section[]> = {
  superadmin: [
    "dashboard-financial",
    "dashboard-operational",
    "quotation",
    "purchase-orders",
    "invoices",
    "cash-entries",
    "users",
  ],
  operational: ["dashboard-operational", "quotation", "purchase-orders"],
  operational_input: ["dashboard-operational", "quotation", "purchase-orders"],
  finance: ["dashboard-financial", "invoices", "cash-entries", "quotation", "purchase-orders"],
  finance_input: ["invoices", "cash-entries", "purchase-orders"],
}

// Unknown roles see common sections.
export function roleCanAccess(role: Role | undefined, section: Section): boolean {
  if (COMMON.includes(section)) return true
  if (!role) return false
  return EXTRA[role]?.includes(section) ?? false
}

// Capabilities per role.
//
// Each mirrors apps/api/internal/shared/roles or a route gate. An unknown
// role fails closed, so an action never flashes in before /auth/me loads,
// and the server refuses it anyway.

const OPS_WRITE: readonly Role[] = ["superadmin", "operational", "operational_input"]

// Catalog, vendor and PO writes.
export function canWriteCatalog(role: Role | undefined): boolean {
  return role !== undefined && OPS_WRITE.includes(role)
}

const SELLING: readonly Role[] = ["superadmin", "operational", "finance", "finance_input"]
const COST: readonly Role[] = ["superadmin", "operational", "operational_input", "finance"]

// Harga jual and its figures.
export function seesSelling(role: Role | undefined): boolean {
  return role !== undefined && SELLING.includes(role)
}

// Harga beli.
export function seesCost(role: Role | undefined): boolean {
  return role !== undefined && COST.includes(role)
}

// Sets harga jual and discount.
export function setsPrices(role: Role | undefined): boolean {
  return role === "superadmin" || role === "operational"
}

// Creates and edits quotation drafts.
export function writesQuotation(role: Role | undefined): boolean {
  return canWriteCatalog(role)
}

// Downloads and exports quotations.
export function exportsQuotation(role: Role | undefined): boolean {
  return role === "superadmin" || role === "operational" || role === "finance"
}

// Financial dashboard figures.
export function canViewFinancial(role: Role | undefined): boolean {
  return role === "superadmin" || role === "finance"
}

// Client writes.
// Finance input only reads clients.
const CLIENT_WRITE: readonly Role[] = ["superadmin", "operational", "operational_input", "finance"]
export function editsClients(role: Role | undefined): boolean {
  return role !== undefined && CLIENT_WRITE.includes(role)
}

// PO file, number and status.
// Operational input edits only harga beli and vendor in Ubah PO.
export function managesPOs(role: Role | undefined): boolean {
  return role === "superadmin" || role === "operational"
}

// Invoice writes beyond payment.
export function managesInvoices(role: Role | undefined): boolean {
  return role === "superadmin" || role === "finance"
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
    case "cash-entries":
      return "cash-entries"
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

// Draft and PO editors.
const WRITE_PAGE = /^\/(quotations\/add|quotations\/[^/]+\/edit|purchase-orders\/[^/]+\/edit)\/?$/

// Page the role may open.
//
// The section gate, plus the editors, which a read-only role is never sent
// to: the finance head reads quotations and POs, finance input reads POs.
export function roleCanOpen(role: Role | undefined, pathname: string): boolean {
  if (!roleCanAccess(role, sectionFromPathname(pathname))) return false
  return !WRITE_PAGE.test(pathname) || canWriteCatalog(role)
}

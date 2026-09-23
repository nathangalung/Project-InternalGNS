import { roleCanAccess, type Section } from "@/lib/rbac"
import type { Role } from "@/types/api"

export type EntityKind =
  | "client"
  | "vendor"
  | "product"
  | "quotation"
  | "purchaseOrder"
  | "invoice"
  | "user"

// Detail route and gating section.
const ENTITY_ROUTES = {
  client: { to: "/clients/$id", section: "clients" },
  vendor: { to: "/vendors/$id", section: "vendors" },
  product: { to: "/products/$id", section: "products" },
  quotation: { to: "/quotations/$id", section: "quotation" },
  purchaseOrder: { to: "/purchase-orders/$id", section: "purchase-orders" },
  invoice: { to: "/invoices/$id", section: "invoices" },
  user: { to: "/users/$id", section: "users" },
} as const satisfies Record<EntityKind, { to: string; section: Section }>

export type EntityRoute = (typeof ENTITY_ROUTES)[EntityKind]["to"]

export type EntityTarget = { to: EntityRoute; params: { id: string } }

// Link target, or null for plain text.
//
// The id is whatever the route's $id expects. For purchaseOrder and invoice
// that is the quotation id, not the PO or invoice row id.
export function entityTarget(
  kind: EntityKind,
  id: number | null | undefined,
  role: Role | undefined,
): EntityTarget | null {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null
  const route = ENTITY_ROUTES[kind]
  if (!roleCanAccess(role, route.section)) return null
  return { to: route.to, params: { id: String(id) } }
}

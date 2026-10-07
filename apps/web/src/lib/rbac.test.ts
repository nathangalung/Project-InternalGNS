import { describe, expect, it } from "vitest"
import type { Role } from "@/types/api"
import {
  canViewFinancial,
  canWriteCatalog,
  editsClients,
  exportsQuotation,
  managesInvoices,
  managesPOs,
  roleCanAccess,
  roleCanOpen,
  type Section,
  sectionFromPathname,
  seesCost,
  seesSelling,
  setsPrices,
  writesQuotation,
} from "./rbac"

const ALL: Section[] = [
  "dashboard",
  "dashboard-financial",
  "dashboard-operational",
  "quotation",
  "purchase-orders",
  "invoices",
  "cash-entries",
  "users",
  "clients",
  "vendors",
  "products",
]

const ROLES: Role[] = ["superadmin", "operational", "operational_input", "finance", "finance_input"]

// Sections beyond the common four, per role.
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
  finance: ["dashboard-financial", "quotation", "purchase-orders", "invoices", "cash-entries"],
  finance_input: ["purchase-orders", "invoices", "cash-entries"],
}

describe("roleCanAccess", () => {
  for (const role of ROLES) {
    it(`${role} reaches its sections and no other`, () => {
      for (const s of ALL) {
        const common = ["dashboard", "clients", "vendors", "products"].includes(s)
        expect(roleCanAccess(role, s), s).toBe(common || EXTRA[role].includes(s))
      }
    })
  }

  it("unknown role sees only common sections", () => {
    expect(roleCanAccess(undefined, "clients")).toBe(true)
    expect(roleCanAccess(undefined, "invoices")).toBe(false)
  })
})

describe("capabilities", () => {
  // selling, cost, prices, writes, exports, financial, clients, invoices, POs
  const table: [Role | undefined, boolean[]][] = [
    ["superadmin", [true, true, true, true, true, true, true, true, true]],
    ["operational", [true, true, true, true, true, false, true, false, true]],
    ["operational_input", [false, true, false, true, false, false, true, false, false]],
    ["finance", [true, true, false, false, true, true, true, true, false]],
    ["finance_input", [true, false, false, false, false, false, false, false, false]],
    [undefined, [false, false, false, false, false, false, false, false, false]],
    ["admin" as Role, [false, false, false, false, false, false, false, false, false]],
  ]
  it.each(table)("%s", (role, want) => {
    expect([
      seesSelling(role),
      seesCost(role),
      setsPrices(role),
      writesQuotation(role),
      exportsQuotation(role),
      canViewFinancial(role),
      editsClients(role),
      managesInvoices(role),
      managesPOs(role),
    ]).toEqual(want)
    expect(canWriteCatalog(role)).toBe(writesQuotation(role))
  })
})

describe("roleCanOpen", () => {
  it.each<[Role | undefined, string, boolean]>([
    ["finance", "/quotations/12", true],
    ["finance", "/quotations/add", false],
    ["finance", "/quotations/12/edit", false],
    ["finance", "/purchase-orders/3/edit", false],
    ["finance_input", "/purchase-orders/3", true],
    ["finance_input", "/purchase-orders/3/edit/", false],
    ["finance_input", "/quotations/12", false],
    ["operational_input", "/quotations/add", true],
    ["operational_input", "/purchase-orders/3/edit", true],
    ["operational_input", "/invoices", false],
    ["superadmin", "/users", true],
  ])("%s %s", (role, path, want) => {
    expect(roleCanOpen(role, path)).toBe(want)
  })
})

describe("sectionFromPathname every section", () => {
  it.each<[string, Section]>([
    ["/dashboard-financial", "dashboard-financial"],
    ["/dashboard-operational", "dashboard-operational"],
    ["/quotations/new", "quotation"],
    ["/quotations/12/edit", "quotation"],
    ["/purchase-orders/9/edit", "purchase-orders"],
    ["/invoices/4", "invoices"],
    ["/cash-entries", "cash-entries"],
    ["/users", "users"],
    ["/clients/2", "clients"],
    ["/vendors/3", "vendors"],
    ["/products/5", "products"],
    ["", "dashboard"],
    ["/", "dashboard"],
    ["/login", "dashboard"],
  ])("%s", (path, want) => {
    expect(sectionFromPathname(path)).toBe(want)
  })
})

import { describe, expect, it } from "vitest"
import type { Role } from "@/types/api"
import { canWriteCatalog, roleCanAccess, type Section, sectionFromPathname } from "./rbac"

const ALL: Section[] = [
  "dashboard",
  "dashboard-financial",
  "dashboard-operational",
  "quotation",
  "purchase-orders",
  "invoices",
  "users",
  "clients",
  "vendors",
  "products",
]

describe("roleCanAccess", () => {
  it("superadmin reaches every section", () => {
    for (const s of ALL) expect(roleCanAccess("superadmin", s)).toBe(true)
  })

  it("operational skips users, financial dashboard, invoices", () => {
    expect(roleCanAccess("operational", "users")).toBe(false)
    expect(roleCanAccess("operational", "dashboard-financial")).toBe(false)
    expect(roleCanAccess("operational", "invoices")).toBe(false)
    expect(roleCanAccess("operational", "quotation")).toBe(true)
    expect(roleCanAccess("operational", "purchase-orders")).toBe(true)
    expect(roleCanAccess("operational", "dashboard-operational")).toBe(true)
  })

  it("finance gets only financial dashboard and invoices beyond common", () => {
    expect(roleCanAccess("finance", "dashboard-financial")).toBe(true)
    expect(roleCanAccess("finance", "invoices")).toBe(true)
    expect(roleCanAccess("finance", "quotation")).toBe(false)
    expect(roleCanAccess("finance", "purchase-orders")).toBe(false)
    expect(roleCanAccess("finance", "dashboard-operational")).toBe(false)
    expect(roleCanAccess("finance", "users")).toBe(false)
  })

  it("every role keeps the common four", () => {
    for (const role of ["superadmin", "operational", "finance"] as const) {
      for (const s of ["dashboard", "clients", "vendors", "products"] as const) {
        expect(roleCanAccess(role, s)).toBe(true)
      }
    }
  })

  it("unknown role sees only common sections", () => {
    expect(roleCanAccess(undefined, "clients")).toBe(true)
    expect(roleCanAccess(undefined, "invoices")).toBe(false)
  })
})

describe("sectionFromPathname", () => {
  it("maps nested paths to their section", () => {
    expect(sectionFromPathname("/quotations/12/edit")).toBe("quotation")
    expect(sectionFromPathname("/purchase-orders/3")).toBe("purchase-orders")
    expect(sectionFromPathname("/invoices")).toBe("invoices")
    expect(sectionFromPathname("/users/5")).toBe("users")
    expect(sectionFromPathname("/")).toBe("dashboard")
  })
})

describe("canWriteCatalog", () => {
  it.each([
    ["superadmin", true],
    ["operational", true],
    ["finance", false],
    [undefined, false],
  ] as const)("%s -> %s", (role, want) => {
    expect(canWriteCatalog(role)).toBe(want)
  })
})

describe("sectionFromPathname every section", () => {
  it.each<[string, Section]>([
    ["/dashboard-financial", "dashboard-financial"],
    ["/dashboard-operational", "dashboard-operational"],
    ["/quotations/new", "quotation"],
    ["/purchase-orders/9/edit", "purchase-orders"],
    ["/invoices/4", "invoices"],
    ["/users", "users"],
    ["/clients/2", "clients"],
    ["/vendors/3", "vendors"],
    ["/products/5", "products"],
    ["", "dashboard"],
    ["/login", "dashboard"],
  ])("%s", (path, want) => {
    expect(sectionFromPathname(path)).toBe(want)
  })
})

describe("roleCanAccess fails closed", () => {
  it("denies a role the app does not know beyond the common sections", () => {
    const stranger = "admin" as Role
    expect(roleCanAccess(stranger, "clients")).toBe(true)
    expect(roleCanAccess(stranger, "users")).toBe(false)
    expect(canWriteCatalog(stranger)).toBe(false)
  })
})

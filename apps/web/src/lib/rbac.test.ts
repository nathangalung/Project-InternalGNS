import { describe, expect, it } from "vitest"
import { roleCanAccess, type Section, sectionFromPathname } from "./rbac"

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

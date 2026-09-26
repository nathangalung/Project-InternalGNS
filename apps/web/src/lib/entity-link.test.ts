import { describe, expect, it } from "vitest"
import type { Role } from "@/types/api"
import { type EntityKind, entityTarget } from "./entity-link"

const KINDS: EntityKind[] = [
  "client",
  "vendor",
  "product",
  "quotation",
  "purchaseOrder",
  "invoice",
  "user",
]

describe("entityTarget", () => {
  it("maps each kind to its detail route", () => {
    const got = KINDS.map((k) => entityTarget(k, 7, "superadmin")?.to)
    expect(got).toEqual([
      "/clients/$id",
      "/vendors/$id",
      "/products/$id",
      "/quotations/$id",
      "/purchase-orders/$id",
      "/invoices/$id",
      "/users/$id",
    ])
    expect(entityTarget("invoice", 42, "superadmin")?.params).toEqual({ id: "42" })
  })

  const cases: { role: Role | undefined; allowed: EntityKind[] }[] = [
    { role: "superadmin", allowed: KINDS },
    {
      role: "operational",
      allowed: ["client", "vendor", "product", "quotation", "purchaseOrder"],
    },
    { role: "finance", allowed: ["client", "vendor", "product", "invoice"] },
    { role: undefined, allowed: ["client", "vendor", "product"] },
  ]
  for (const { role, allowed } of cases) {
    it(`gates links for ${role ?? "unknown role"}`, () => {
      for (const k of KINDS) {
        expect(entityTarget(k, 1, role) !== null, k).toBe(allowed.includes(k))
      }
    })
  }

  it("falls back to plain text without a usable id", () => {
    for (const id of [null, undefined, 0, -3, 1.5, Number.NaN]) {
      expect(entityTarget("client", id, "superadmin")).toBeNull()
    }
  })
})

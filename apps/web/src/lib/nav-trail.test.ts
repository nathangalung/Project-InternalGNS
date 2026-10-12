import { describe, expect, it } from "vitest"
import {
  type Crumb,
  crumbTarget,
  historyDelta,
  listCrumb,
  pageCrumb,
  pageLabel,
  pushTrail,
  readTrail,
  TRAIL_CAP,
} from "./nav-trail"

const crumb = (path: string, index?: number, search = ""): Crumb => ({
  href: `${path}${search}`,
  path,
  label: `Hal ${path}`,
  ...(index === undefined ? {} : { index }),
})

const q = crumb("/quotations/12", 3)
const p = crumb("/products/7", 4)
const v = crumb("/vendors/2", 5)

describe("readTrail", () => {
  it("reads the trail a link left in history state", () => {
    expect(readTrail({ trail: [q, p] }, "/vendors/2")).toEqual([q, p])
  })

  it.each([
    ["no state", undefined],
    ["null state", null],
    ["no trail key", { key: "abc" }],
    ["trail not a list", { trail: "x" }],
  ])("is empty with %s", (_name, state) => {
    expect(readTrail(state, "/vendors/2")).toEqual([])
  })

  it.each([
    ["not an object", 5],
    ["no label", { href: "/a", path: "/a" }],
    ["empty label", { href: "/a", path: "/a", label: " " }],
    ["path not a string", { href: "/a", path: 3, label: "A" }],
    ["href to another host", { href: "//evil.example/a", path: "/a", label: "A" }],
    ["absolute href", { href: "https://evil.example/a", path: "/a", label: "A" }],
    ["href off its path", { href: "/b?x=1", path: "/a", label: "A" }],
    ["path to another host", { href: "//evil.example/a", path: "//evil.example/a", label: "A" }],
    ["relative path", { href: "a", path: "a", label: "A" }],
    ["index not a whole number", { href: "/a", path: "/a", label: "A", index: 1.5 }],
  ])("drops a crumb that is %s", (_name, bad) => {
    expect(readTrail({ trail: [q, bad, p] }, "/vendors/2")).toEqual([q, p])
  })

  it("keeps the search or hash a crumb was left with", () => {
    const listed = crumb("/invoices/3", 1, "?invoiceId=9")
    const marked = crumb("/clients/4", 2, "#kontak")
    expect(readTrail({ trail: [listed, marked] }, "/vendors/2")).toEqual([listed, marked])
  })

  it("drops a crumb whose href only starts like its path", () => {
    expect(readTrail({ trail: [{ href: "/ab", path: "/a", label: "A" }] }, "/v")).toEqual([])
  })

  it("keeps a crumb without a history index", () => {
    const loose = crumb("/clients/4")
    expect(readTrail({ trail: [loose] }, "/vendors/2")).toEqual([loose])
  })

  it("cuts the trail where the page itself appears, so back and forth adds nothing", () => {
    // Quotation, product, then the quotation again through a link.
    expect(readTrail({ trail: [q, p] }, "/quotations/12")).toEqual([])
    expect(readTrail({ trail: [q, p, v] }, "/products/7")).toEqual([q])
  })

  it("keeps only the newest crumbs", () => {
    const long = Array.from({ length: TRAIL_CAP + 2 }, (_, i) => crumb(`/clients/${i}`, i))
    const got = readTrail({ trail: long }, "/vendors/2")
    expect(got).toHaveLength(TRAIL_CAP)
    expect(got[0].path).toBe("/clients/2")
  })
})

describe("pushTrail", () => {
  it("adds the page the link leaves", () => {
    expect(pushTrail([q], p)).toEqual([q, p])
  })

  it("starts a trail from a page without one", () => {
    expect(pushTrail([], q)).toEqual([q])
  })

  it("never repeats the last crumb", () => {
    const again = { ...p, href: "/products/7?tab=x" }
    expect(pushTrail([q, p], again)).toEqual([q, again])
  })

  it("stays within the cap", () => {
    const full = Array.from({ length: TRAIL_CAP }, (_, i) => crumb(`/clients/${i}`, i))
    const got = pushTrail(full, v)
    expect(got).toHaveLength(TRAIL_CAP)
    expect(got[got.length - 1]).toEqual(v)
    expect(got[0].path).toBe("/clients/1")
  })
})

describe("historyDelta", () => {
  it("steps back to the previous crumb when it is the previous entry", () => {
    expect(historyDelta([q, p], 1, 5)).toBe(-1)
  })

  it("steps back over every crumb walked in a row", () => {
    expect(historyDelta([q, p], 0, 5)).toBe(-2)
  })

  it.each([
    ["the entries in between are not the trail", [q, crumb("/products/7", 2)], 0, 5],
    ["the previous entry is another page", [q, p], 1, 7],
    ["a crumb has no index", [q, crumb("/products/7")], 1, 5],
    ["the page has no index", [q, p], 1, undefined],
    ["the crumb is not in the trail", [q, p], 2, 5],
  ])("is null when %s", (_name, trail, at, current) => {
    expect(historyDelta(trail as Crumb[], at as number, current as number | undefined)).toBeNull()
  })
})

describe("crumbTarget", () => {
  it("goes back in history when the crumb is the entry behind", () => {
    expect(crumbTarget([q, p], 1, 5)).toEqual({ kind: "history", delta: -1 })
  })

  it("otherwise opens the crumb with the trail before it", () => {
    expect(crumbTarget([q, p], 1, 9)).toEqual({ kind: "open", href: p.href, trail: [q] })
  })
})

describe("listCrumb and pageLabel", () => {
  it.each([
    ["/", "Dashboard"],
    ["/dashboard-financial", "Dashboard Finansial"],
    ["/dashboard-operational", "Dashboard Operasional"],
    ["/quotations", "Daftar Quotation"],
    ["/quotations/12/edit", "Daftar Quotation"],
    ["/purchase-orders", "Daftar Purchase Order"],
    ["/invoices", "Daftar Invoice"],
    ["/cash-entries", "Kas Lain"],
    ["/products", "Katalog Produk"],
    ["/vendors", "Daftar Vendor"],
    ["/clients", "Daftar Klien"],
    ["/users", "Manajemen Pengguna"],
  ])("%s reads as %s", (path, label) => {
    expect(pageLabel(path)).toBe(label)
  })

  it("makes a crumb of a page", () => {
    expect(pageCrumb("/quotations/12", "Quotation Q-1")).toEqual({
      href: "/quotations/12",
      path: "/quotations/12",
      label: "Quotation Q-1",
    })
  })

  it("names the list a detail page falls back to", () => {
    expect(listCrumb("/products")).toEqual({
      href: "/products",
      path: "/products",
      label: "Katalog Produk",
    })
  })
})

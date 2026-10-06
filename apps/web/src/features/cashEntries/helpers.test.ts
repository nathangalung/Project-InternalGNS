import { describe, expect, it } from "vitest"
import type { CashEntryRow } from "@/types/api"
import {
  amountShown,
  amountTyped,
  CASH_FILTERS,
  cashFieldErrors,
  cashFormFromRow,
  cashInput,
  cashParams,
  DIRECTION_LABEL,
  emptyCashForm,
} from "./helpers"

const row: CashEntryRow = {
  id: 3,
  entryDate: "2026-09-15",
  direction: "out",
  category: "Sewa Kantor",
  amount: "4500000.00",
  description: "Sewa September",
  rowVersion: 2,
  createdAt: "2026-09-15T01:00:00Z",
  updatedAt: "2026-09-15T01:00:00Z",
  createdByName: "Diah",
}

describe("cashParams", () => {
  it("sends only what narrows", () => {
    expect(cashParams("", CASH_FILTERS)).toEqual({
      q: undefined,
      direction: undefined,
      category: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("passes every filter and the page", () => {
    expect(
      cashParams(
        "bank",
        { direction: "in", category: "Modal", dateFrom: "2026-09-01", dateTo: "2026-09-30" },
        { limit: 10, offset: 20 },
      ),
    ).toEqual({
      q: "bank",
      direction: "in",
      category: "Modal",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      limit: 10,
      offset: 20,
    })
  })
})

describe("form round trip", () => {
  it("starts blank on the given day", () => {
    expect(emptyCashForm("2026-10-07")).toEqual({
      entryDate: "2026-10-07",
      direction: "",
      category: "",
      amount: "",
      description: "",
    })
  })

  it("drops a whole amount's sen and keeps real ones", () => {
    expect(cashFormFromRow(row).amount).toBe("4500000")
    expect(cashFormFromRow({ ...row, amount: "4500000.50" }).amount).toBe("4500000.50")
  })

  it("trims what it sends", () => {
    expect(
      cashInput({ ...cashFormFromRow(row), category: " Sewa ", description: " Catatan " }),
    ).toEqual({
      entryDate: "2026-09-15",
      direction: "out",
      category: "Sewa",
      amount: "4500000",
      description: "Catatan",
    })
  })

  it("labels both directions", () => {
    expect(DIRECTION_LABEL).toEqual({ in: "Masuk", out: "Keluar" })
  })
})

describe("cashFieldErrors", () => {
  const good = cashFormFromRow(row)
  it("passes a complete entry", () => {
    expect(cashFieldErrors(good)).toEqual({})
  })

  it.each([
    ["entryDate", { entryDate: "" }, "Tanggal wajib diisi dengan format yang benar."],
    ["direction", { direction: "" as const }, "Pilih Masuk atau Keluar."],
    ["category", { category: "  " }, "Kategori wajib diisi."],
    ["category", { category: "a".repeat(61) }, "Kategori paling banyak 60 karakter."],
    ["amount", { amount: "" }, "Jumlah harus berupa angka lebih dari 0."],
    ["amount", { amount: "0.001" }, "Jumlah harus berupa angka lebih dari 0."],
    ["amount", { amount: "abc" }, "Jumlah harus berupa angka lebih dari 0."],
    ["description", { description: "" }, "Keterangan wajib diisi."],
    ["description", { description: "a".repeat(501) }, "Keterangan paling banyak 500 karakter."],
  ])("%s %j", (field, over, msg) => {
    expect(cashFieldErrors({ ...good, ...over })).toEqual({ [field]: msg })
  })
})

describe("amount input", () => {
  it.each([
    ["4.500.000", "4500000", "4.500.000"],
    ["4500000", "4500000", "4.500.000"],
    ["12,5", "12.5", "12,5"],
    ["1.250,755", "1250.75", "1.250,75"],
    ["12,", "12.", "12,"],
    ["Rp 1a2", "12", "12"],
    ["", "", ""],
  ])("%s", (raw, canonical, shown) => {
    expect(amountTyped(raw)).toBe(canonical)
    expect(amountShown(canonical)).toBe(shown)
  })
})

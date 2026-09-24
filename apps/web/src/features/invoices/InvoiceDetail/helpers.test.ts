import { describe, expect, it } from "vitest"
import type {
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceDetail,
  InvoiceStatusEvent,
  InvoiceTransition,
} from "@/types/api"
import {
  cancelReason,
  clientInfoOf,
  datesLocked,
  datesPatch,
  datesProblem,
  fileNameFromKey,
  historyItems,
  invoiceActions,
  invoiceDisplayStatus,
  toApiDate,
  toInputDate,
} from "./helpers"

function row(status: InvoiceBackendStatus, dueDate?: string): InvoiceBackendRow {
  return { status, dueDate } as InvoiceBackendRow
}

function move(to: InvoiceBackendStatus, requiresNote = false): InvoiceTransition {
  return { to, label: to, requiresNote }
}

function event(
  id: number,
  fromStatus: InvoiceBackendStatus,
  toStatus: InvoiceBackendStatus,
  extra: Partial<InvoiceStatusEvent> = {},
): InvoiceStatusEvent {
  return { id, fromStatus, toStatus, changedBy: 1, changedAt: `2026-09-0${id}T03:00:00Z`, ...extra }
}

describe("invoiceDisplayStatus", () => {
  it.each<[string, InvoiceBackendStatus, string | undefined, string]>([
    ["cancelled stays visible", "cancelled", "2020-01-01", "DIBATALKAN"],
    ["paid past due stays paid", "paid", "2020-01-01", "DIBAYAR"],
    ["past-due draft is derived late", "draft", "2020-01-01", "TERLAMBAT"],
    ["future sent stays sent", "sent", "2999-01-01", "DIKIRIM"],
    ["stored overdue", "overdue", undefined, "TERLAMBAT"],
  ])("%s", (_name, status, due, want) => {
    expect(invoiceDisplayStatus(row(status, due))).toBe(want)
  })
})

describe("invoiceActions", () => {
  it.each<[string, InvoiceTransition[] | undefined, string[]]>([
    [
      "draft offers send, then the Pengganti cancel",
      [move("cancelled", true), move("sent")],
      ["send", "cancel"],
    ],
    ["sent offers pay and cancel", [move("paid"), move("cancelled", true)], ["pay", "cancel"]],
    ["overdue is never a button", [move("overdue"), move("paid")], ["pay"]],
    ["draft target is never a button", [move("draft")], []],
    ["terminal has none", [], []],
    ["missing list has none", undefined, []],
    ["duplicates collapse", [move("paid"), move("paid")], ["pay"]],
  ])("%s", (_name, transitions, want) => {
    expect(invoiceActions(transitions).map((a) => a.kind)).toEqual(want)
  })

  it("keeps the server's note requirement", () => {
    const [cancel] = invoiceActions([move("cancelled", true)])
    expect(cancel).toEqual({
      kind: "cancel",
      label: "Batalkan & Terbitkan Pengganti",
      requiresNote: true,
    })
  })
})

describe("datesLocked", () => {
  it.each<[InvoiceBackendStatus, boolean]>([
    ["draft", false],
    ["sent", false],
    ["overdue", false],
    ["paid", true],
    ["cancelled", true],
  ])("%s", (status, want) => {
    expect(datesLocked(status)).toBe(want)
  })
})

describe("date conversion", () => {
  it.each<[string | undefined, string]>([
    ["2026-09-24T00:00:00Z", "2026-09-24"],
    ["2026-09-24T00:00:00+07:00", "2026-09-24"],
    ["2026-09-24", "2026-09-24"],
    [undefined, ""],
    ["garbage", ""],
  ])("toInputDate(%s)", (iso, want) => {
    expect(toInputDate(iso)).toBe(want)
  })

  it("sends midnight WIB", () => {
    expect(toApiDate("2026-09-24")).toBe("2026-09-24T00:00:00+07:00")
  })
})

describe("datesProblem", () => {
  it.each<[string, string, string, string | null]>([
    ["valid range", "2026-09-01", "2026-10-01", null],
    ["same day", "2026-09-01", "2026-09-01", null],
    [
      "due before invoice",
      "2026-09-10",
      "2026-09-01",
      "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice.",
    ],
    ["missing invoice date", "", "2026-09-01", "Tanggal invoice wajib diisi."],
    ["missing due date", "2026-09-01", "", "Tanggal jatuh tempo wajib diisi."],
  ])("%s", (_name, invoiceDate, dueDate, want) => {
    expect(datesProblem(invoiceDate, dueDate)).toBe(want)
  })
})

describe("datesPatch", () => {
  const inv = { invoiceDate: "2026-09-01T00:00:00Z", dueDate: "2026-10-01T00:00:00Z" }

  it.each<[string, string, string, Record<string, string>]>([
    ["nothing changed", "2026-09-01", "2026-10-01", {}],
    ["due only", "2026-09-01", "2026-10-15", { dueDate: "2026-10-15T00:00:00+07:00" }],
    [
      "both",
      "2026-09-02",
      "2026-10-15",
      { invoiceDate: "2026-09-02T00:00:00+07:00", dueDate: "2026-10-15T00:00:00+07:00" },
    ],
  ])("%s", (_name, invoiceDate, dueDate, want) => {
    expect(datesPatch(inv, invoiceDate, dueDate)).toEqual(want)
  })
})

describe("fileNameFromKey", () => {
  it.each<[string | undefined, string]>([
    ["invoices/12/1700000000-receipt.pdf", "receipt.pdf"],
    ["invoices/12/payment/1700000000-bukti-bayar.pdf", "bukti-bayar.pdf"],
    ["plain.pdf", "plain.pdf"],
    [undefined, ""],
  ])("%s", (key, want) => {
    expect(fileNameFromKey(key)).toBe(want)
  })
})

describe("clientInfoOf", () => {
  it("fills the card from the invoice payload", () => {
    const inv = {
      contactName: "Budi",
      contactPhone: "0812",
      companyEmail: "ops@klien.co.id",
      companyTkuId: "0012345678901234000000",
      companyNpwp: "0012345678901234",
      companyAddress: "Jl. Pelabuhan 1",
    } as InvoiceDetail
    expect(clientInfoOf(inv)).toEqual({
      narahubung: "Budi",
      phone: "0812",
      email: "ops@klien.co.id",
      nomorTKU: "0012345678901234000000",
      npwp: "0012345678901234",
      lokasi: "Jl. Pelabuhan 1",
    })
  })

  it("prefers the contact email", () => {
    const inv = {
      contactEmail: "budi@klien.co.id",
      companyEmail: "ops@klien.co.id",
    } as InvoiceDetail
    expect(clientInfoOf(inv).email).toBe("budi@klien.co.id")
  })
})

describe("historyItems", () => {
  it("starts with creation and labels every move", () => {
    const items = historyItems({
      createdAt: "2026-09-01T02:00:00Z",
      history: [
        event(1, "draft", "sent"),
        event(2, "sent", "paid", { paymentProofKey: "invoices/9/payment/1-bukti.pdf" }),
      ],
    })
    expect(items.map((i) => [i.action, i.hasProof])).toEqual([
      ["Dibuat sebagai Draf", false],
      ["Draf → Dikirim", false],
      ["Dikirim → Dibayar", true],
    ])
  })

  it("names the invoice a Pengganti replaces", () => {
    const [created] = historyItems({
      createdAt: "2026-09-01T02:00:00Z",
      history: [],
      replacesInvoiceNo: "INV-1",
    })
    expect(created.action).toBe("Dibuat sebagai Draf, pengganti INV-1")
  })

  it("keeps the cancel reason as a note", () => {
    const items = historyItems({
      createdAt: "2026-09-01T02:00:00Z",
      history: [event(1, "sent", "cancelled", { note: "Salah harga" })],
    })
    expect(items[1]).toMatchObject({ action: "Dikirim → Dibatalkan", note: "Salah harga" })
  })
})

describe("cancelReason", () => {
  it.each<[string, InvoiceStatusEvent[], string | undefined]>([
    ["latest cancel note", [event(1, "draft", "cancelled", { note: "Salah PO" })], "Salah PO"],
    ["no cancel", [event(1, "draft", "sent")], undefined],
    ["empty note", [event(1, "draft", "cancelled", { note: "" })], undefined],
  ])("%s", (_name, history, want) => {
    expect(cancelReason({ history })).toBe(want)
  })
})

describe("history without events", () => {
  it("shows only the creation row when history is missing", () => {
    const items = historyItems({ createdAt: "2026-09-01T02:00:00Z" } as InvoiceDetail)
    expect(items.map((i) => i.action)).toEqual(["Dibuat sebagai Draf"])
  })

  it("has no cancel reason when history is missing", () => {
    expect(cancelReason({} as InvoiceDetail)).toBeUndefined()
  })

  it("prints an unknown stored status as is", () => {
    const items = historyItems({
      createdAt: "2026-09-01T02:00:00Z",
      history: [event(1, "void" as InvoiceBackendStatus, "archived" as InvoiceBackendStatus)],
    })
    expect(items[1].action).toBe("void → archived")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import type { InvoiceDetail } from "@/types/api"
import * as api from "./api"
import {
  useCancelAndReplaceInvoice,
  useInvoice,
  useInvoiceAttachmentDownloadUrl,
  useInvoiceByQuotation,
  useInvoiceItems,
  useInvoiceSummary,
  useInvoices,
  useMarkInvoicePaid,
  useReplaceInvoice,
  useSendInvoice,
  useUpdateInvoiceDates,
  useUploadInvoiceAttachment,
} from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/storage-upload", () => ({
  uploadWithFreshKey: vi.fn(async (presign: () => Promise<{ objectKey: string }>) => {
    return (await presign()).objectKey
  }),
}))

const m = vi.mocked(api)
const invDetail = queryKeys.invoices.detail(4)
const invList = queryKeys.invoices.list()
const dash = queryKeys.dashboard.summary()
const poList = queryKeys.purchaseOrders.list()
const views = [invDetail, invList, dash]
const next = { id: 9, quotationId: 5, invoiceNo: "INV/2026/IX/002" } as InvoiceDetail
const pdf = (size = 10) =>
  new File([new Uint8Array(size)], "bukti.pdf", { type: "application/pdf" })

beforeEach(() => vi.clearAllMocks())

describe("invoice queries", () => {
  it("lists with the given params and reads the summary", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    m.summary.mockResolvedValue({} as never)
    const l = renderQueryHook(() => useInvoices({ status: "paid" }))
    const s = renderQueryHook(() => useInvoiceSummary())
    await until(() => {
      expect(l.result.current.isSuccess).toBe(true)
      expect(s.result.current.isSuccess).toBe(true)
    })
    expect(m.list).toHaveBeenCalledWith({ status: "paid" })
  })

  it.each<[string, () => { fetchStatus: string }, () => unknown]>([
    ["items", () => useInvoiceItems(undefined), () => m.listItems],
    ["by quotation", () => useInvoiceByQuotation(0), () => m.getByQuotation],
    ["invoice", () => useInvoice(undefined), () => m.getById],
    [
      "attachment without a key",
      () => useInvoiceAttachmentDownloadUrl(4),
      () => m.presignAttachmentDownload,
    ],
    [
      "attachment without an id",
      () => useInvoiceAttachmentDownloadUrl(undefined, "k"),
      () => m.presignAttachmentDownload,
    ],
  ])("does not fetch %s without an id", async (_name, hook, fn) => {
    const { result } = renderQueryHook(hook)
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(fn()).not.toHaveBeenCalled()
  })

  it("fetches items, the quotation's invoice, the invoice and its attachment", async () => {
    m.listItems.mockResolvedValue([])
    m.getByQuotation.mockResolvedValue(null)
    m.getById.mockResolvedValue(next)
    m.presignAttachmentDownload.mockResolvedValue({ downloadUrl: "u", expiresAt: 1 })
    const hooks = [
      renderQueryHook(() => useInvoiceItems(4)),
      renderQueryHook(() => useInvoiceByQuotation(5)),
      renderQueryHook(() => useInvoice(9)),
      renderQueryHook(() => useInvoiceAttachmentDownloadUrl(4, "k")),
    ]
    await until(() => {
      for (const h of hooks) expect(h.result.current.isSuccess).toBe(true)
    })
    expect(m.listItems).toHaveBeenCalledWith(4)
    expect(m.getByQuotation).toHaveBeenCalledWith(5)
    expect(m.getById).toHaveBeenCalledWith(9)
    expect(m.presignAttachmentDownload).toHaveBeenCalledWith(4)
  })
})

describe("useSendInvoice", () => {
  it("marks the invoice sent and refreshes invoices and dashboard", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useSendInvoice())
    seed(qc, [...views, poList])
    await settle(() => result.current.mutateAsync(4))
    expect(m.changeStatus).toHaveBeenCalledWith(4, { status: "sent" })
    expect(invalidated(qc, [...views, poList])).toEqual(views)
    expect(toast.success).toHaveBeenCalledWith("Invoice ditandai Dikirim.")
  })

  it("toasts the server reason on failure", async () => {
    m.changeStatus.mockRejectedValue(new ApiError(422, null, "Invoice bukan draf."))
    const { result } = renderQueryHook(() => useSendInvoice())
    await settle(() => result.current.mutateAsync(4))
    expect(toast.error).toHaveBeenCalledWith("Invoice bukan draf.")
  })
})

describe("useMarkInvoicePaid", () => {
  it("uploads the proof first and files its key with the payment", async () => {
    m.presignPaymentProofUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "invoices/4/payment/b.pdf",
      expiresAt: 1,
    })
    m.changeStatus.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useMarkInvoicePaid())
    seed(qc, views)
    await settle(() => result.current.mutateAsync({ id: 4, proof: pdf() }))
    expect(m.presignPaymentProofUpload).toHaveBeenCalledWith(4, "bukti.pdf")
    expect(m.changeStatus).toHaveBeenCalledWith(4, {
      status: "paid",
      paymentProofKey: "invoices/4/payment/b.pdf",
    })
    expect(invalidated(qc, views)).toEqual(views)
    expect(toast.success).toHaveBeenCalledWith("Invoice ditandai Dibayar.")
  })

  it("marks paid without a proof", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    const { result } = renderQueryHook(() => useMarkInvoicePaid())
    await settle(() => result.current.mutateAsync({ id: 4 }))
    expect(m.presignPaymentProofUpload).not.toHaveBeenCalled()
    expect(m.changeStatus).toHaveBeenCalledWith(4, { status: "paid", paymentProofKey: undefined })
  })

  it("refuses an invalid proof before uploading or changing status", async () => {
    const { result } = renderQueryHook(() => useMarkInvoicePaid())
    await settle(() => result.current.mutateAsync({ id: 4, proof: pdf(0) }))
    expect(m.presignPaymentProofUpload).not.toHaveBeenCalled()
    expect(m.changeStatus).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("File bukti pembayaran kosong.")
  })

  it("hides the storage proxy's English detail", async () => {
    m.presignPaymentProofUpload.mockRejectedValue(
      new ApiError(502, '{"detail":"upload failed"}', "Bad Gateway"),
    )
    const { result } = renderQueryHook(() => useMarkInvoicePaid())
    await settle(() => result.current.mutateAsync({ id: 4, proof: pdf() }))
    expect(toast.error).toHaveBeenCalledWith("Gagal menandai invoice dibayar.")
  })
})

describe("replacement", () => {
  it("cancels, issues the Pengganti and shows it on the quotation at once", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    m.replace.mockResolvedValue(next)
    const { qc, result } = renderQueryHook(() => useCancelAndReplaceInvoice())
    seed(qc, views)
    await settle(() => result.current.mutateAsync({ id: 4, note: "Salah NPWP" }))
    expect(m.changeStatus).toHaveBeenCalledWith(4, { status: "cancelled", note: "Salah NPWP" })
    expect(m.replace).toHaveBeenCalledWith(4)
    expect(qc.getQueryData(queryKeys.invoices.byQuotation(5))).toEqual(next)
    expect(invalidated(qc, views)).toEqual(views)
    expect(toast.success).toHaveBeenCalledWith("Invoice pengganti INV/2026/IX/002 diterbitkan.")
  })

  // Two calls; second may fail.
  //
  // A failed second step leaves a cancelled invoice to show.
  it("still refreshes when the Pengganti fails after the cancel", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    m.replace.mockRejectedValue(new Error(""))
    const { qc, result } = renderQueryHook(() => useCancelAndReplaceInvoice())
    seed(qc, views)
    await settle(() => result.current.mutateAsync({ id: 4, note: "x" }))
    await until(() => expect(invalidated(qc, views)).toEqual(views))
    expect(toast.error).toHaveBeenCalledWith("Gagal membatalkan invoice.")
  })

  it("does not issue a Pengganti when the cancel is refused", async () => {
    m.changeStatus.mockRejectedValue(new ApiError(422, null, "Catatan wajib diisi."))
    const { result } = renderQueryHook(() => useCancelAndReplaceInvoice())
    await settle(() => result.current.mutateAsync({ id: 4, note: "" }))
    expect(m.replace).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Catatan wajib diisi.")
  })

  it("issues a Pengganti for an already cancelled invoice", async () => {
    m.replace.mockResolvedValue(next)
    const { qc, result } = renderQueryHook(() => useReplaceInvoice())
    seed(qc, views)
    await settle(() => result.current.mutateAsync(4))
    expect(qc.getQueryData(queryKeys.invoices.byQuotation(5))).toEqual(next)
    expect(invalidated(qc, views)).toEqual(views)
    expect(toast.success).toHaveBeenCalledWith("Invoice pengganti INV/2026/IX/002 diterbitkan.")
  })

  it("toasts Indonesian copy when the Pengganti fails", async () => {
    m.replace.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useReplaceInvoice())
    await settle(() => result.current.mutateAsync(4))
    expect(toast.error).toHaveBeenCalledWith("Gagal menerbitkan invoice pengganti.")
  })
})

describe("useUpdateInvoiceDates", () => {
  const vars = { id: 4, input: { dueDate: "2026-10-01T00:00:00+07:00" }, rowVersion: 2 }

  it("saves with the row version and refreshes", async () => {
    m.updateDates.mockResolvedValue({ rowVersion: 3 })
    const { qc, result } = renderQueryHook(() => useUpdateInvoiceDates())
    seed(qc, views)
    await settle(() => result.current.mutateAsync(vars))
    expect(m.updateDates).toHaveBeenCalledWith(4, vars.input, 2)
    expect(invalidated(qc, views)).toEqual(views)
    expect(toast.success).toHaveBeenCalledWith("Tanggal invoice disimpan.")
  })

  it("reloads a row changed elsewhere and says so in Indonesian", async () => {
    m.updateDates.mockRejectedValue(new ApiError(409, null, "row_version mismatch"))
    const { qc, result } = renderQueryHook(() => useUpdateInvoiceDates())
    seed(qc, views)
    await settle(() => result.current.mutateAsync(vars))
    await until(() => expect(invalidated(qc, views)).toEqual(views))
    expect(toast.error).toHaveBeenCalledWith(
      "Invoice ini baru saja diubah di tempat lain. Periksa tanggalnya lalu simpan lagi.",
    )
  })

  it("shows any other refusal without reloading", async () => {
    m.updateDates.mockRejectedValue(new ApiError(422, null, "Tanggal invoice terkunci."))
    const { qc, result } = renderQueryHook(() => useUpdateInvoiceDates())
    seed(qc, views)
    await settle(() => result.current.mutateAsync(vars))
    expect(toast.error).toHaveBeenCalledWith("Tanggal invoice terkunci.")
    expect(invalidated(qc, views)).toEqual([])
  })
})

describe("useUploadInvoiceAttachment", () => {
  it("uploads, saves the key and refreshes invoices", async () => {
    m.presignAttachmentUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "invoices/4/a.pdf",
      expiresAt: 1,
    })
    m.updateAttachment.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUploadInvoiceAttachment())
    seed(qc, [invDetail, dash])
    await settle(() => result.current.mutateAsync({ id: 4, file: pdf() }))
    expect(m.updateAttachment).toHaveBeenCalledWith(4, "invoices/4/a.pdf")
    expect(invalidated(qc, [invDetail, dash])).toEqual([invDetail])
  })

  it("refuses an oversize attachment before uploading", async () => {
    const { result } = renderQueryHook(() => useUploadInvoiceAttachment())
    await settle(() => result.current.mutateAsync({ id: 4, file: pdf(20 * 1024 * 1024 + 1) }))
    expect(m.presignAttachmentUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Ukuran lampiran invoice melebihi 20 MB.")
  })

  it("passes a 409 written for the user through", async () => {
    m.presignAttachmentUpload.mockRejectedValue(
      new ApiError(409, '{"detail":"Invoice sudah dibayar."}', "Conflict"),
    )
    const { result } = renderQueryHook(() => useUploadInvoiceAttachment())
    await settle(() => result.current.mutateAsync({ id: 4, file: pdf() }))
    expect(toast.error).toHaveBeenCalledWith("Invoice sudah dibayar.")
  })
})

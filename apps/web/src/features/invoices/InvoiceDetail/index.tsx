import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { getCompanyInitials } from "@/features/clients/helpers"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import HistoryTimeline from "@/features/quotations/QuotationDetail/HistoryTimeline"
import { nowLabel } from "@/features/quotations/QuotationDetail/helpers"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import type { QuotationData } from "@/features/quotations/types"
import { downloadPdf, fetchObjectUrl } from "@/lib/api-client"
import { computeTaxBreakdown, toNum } from "@/lib/format"
import { invoiceItemsToProducts, invoiceItemsToShipping } from "../adapters"
import {
  useChangeInvoiceStatus,
  useInvoiceAttachmentDownloadUrl,
  useInvoiceByQuotation,
  useInvoiceItems,
  useUploadInvoiceAttachment,
} from "../hooks"
import type { InvoiceStatus } from "../types"
import { INVOICE_LABEL } from "../types"
import FileCard from "./FileCard"
import Header from "./Header"
import { type EditableInvoiceStatus, TO_BACKEND, toEditable } from "./helpers"
import StatusBar from "./StatusBar"

interface HistoryEntry {
  date: string
  action: string
}

interface InvoiceDetailProps {
  quotationId: number
  quotationNo: string
  quotation?: QuotationData
}

// Derive display filename from objectKey, e.g.
// "invoices/123/1700000000-receipt.pdf" -> "receipt.pdf"
function deriveFileName(objectKey: string | undefined): string {
  if (!objectKey) return ""
  const last = objectKey.split("/").pop() ?? ""
  const dash = last.indexOf("-")
  return dash >= 0 ? last.slice(dash + 1) : last
}

export default function InvoiceDetail({ quotationId, quotationNo, quotation }: InvoiceDetailProps) {
  const navigate = useNavigate()
  const { data: inv, isLoading } = useInvoiceByQuotation(quotationId)
  const { data: invItems } = useInvoiceItems(inv?.id)
  const { data: linkedPo } = usePurchaseOrderByQuotation(quotationId)
  const changeStatus = useChangeInvoiceStatus()
  const uploadAttachment = useUploadInvoiceAttachment()
  const { data: attachmentDownload } = useInvoiceAttachmentDownloadUrl(
    inv?.id,
    inv?.attachmentObjectKey,
  )
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  const initialStatus = toEditable(inv)
  const [status, setStatus] = useState<EditableInvoiceStatus>(initialStatus)
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [extraHistory, setExtraHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (inv) setStatus(toEditable(inv))
  }, [inv])

  const products = useMemo(() => invoiceItemsToProducts(invItems), [invItems])
  // Profit needs real cost data.
  const hasCost = useMemo(() => (invItems ?? []).some((it) => toNum(it.costPrice) > 0), [invItems])
  const shipping = useMemo(() => invoiceItemsToShipping(invItems), [invItems])

  const history: HistoryEntry[] = useMemo(() => {
    if (!quotation || !inv) return []
    const items: HistoryEntry[] = [
      { date: quotation.createdAt, action: `Invoice dibuat dari Quotation ${quotationNo}` },
    ]
    return [...items, ...extraHistory]
  }, [quotation, inv, quotationNo, extraHistory])

  if (!quotation || (isLoading && !inv) || !inv) {
    return (
      <div className="page-content">
        <p>{isLoading ? "Memuat data Invoice…" : "Invoice tidak ditemukan."}</p>
      </div>
    )
  }

  // Cancelled is terminal and read-only.
  if (inv.status === "cancelled") {
    return (
      <div className="page-content">
        <p>Invoice {inv.invoiceNo} telah dibatalkan.</p>
      </div>
    )
  }

  // Compute totals from snapshot items; PPN/grand from BE persisted.
  const totalProduk = products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = shipping.hargaSatuan
  const hasProducts = products.length > 0
  // Discount is snapshotted on the invoice, so totalProduk (gross) minus it
  // lands on the persisted DPP. The quotation may have moved on since.
  const nominalDiskon = toNum(inv.totalDiscount)
  const subTotal = totalProduk - nominalDiskon
  // Prefer BE-persisted tax values; fall back to the shared computation.
  const fallback = computeTaxBreakdown({ subtotal: subTotal, shipping: totalShip })
  const dppNilaiLain = toNum(inv.dppNilaiLain) || fallback.dppNilaiLain
  const ppn12 = toNum(inv.ppnAmount) || fallback.ppnAmount
  const grandTotal = toNum(inv.total) || fallback.grandTotal
  const clientInitials = getCompanyInitials(quotation.client)
  const invoiceNo = inv.invoiceNo
  const displayStatus: InvoiceStatus = status

  function handleStatusChange(s: EditableInvoiceStatus) {
    setStatus(s)
    setIsStatusOpen(false)
  }

  async function handleDownload() {
    if (!inv) return
    const safe = invoiceNo.replace(/[^A-Za-z0-9._-]/g, "_")
    await downloadPdf(`/invoices/${inv.id}/pdf`, `${safe}.pdf`)
  }

  function handleAttachmentSelect(file: File | undefined) {
    if (!file || !inv) return
    uploadAttachment.mutate({ id: inv.id, file })
  }

  async function handleAttachmentDownload() {
    if (!attachmentDownload?.downloadUrl) return
    const objectUrl = await fetchObjectUrl(attachmentDownload.downloadUrl)
    window.open(objectUrl, "_blank", "noopener,noreferrer")
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }

  function handleSave() {
    if (!inv) return
    const target = TO_BACKEND[status]
    if (target === inv.status) {
      void navigate({ to: "/invoices" })
      return
    }
    changeStatus.mutate(
      { id: inv.id, status: target },
      {
        onSuccess: () => {
          setExtraHistory((prev) => [
            ...prev,
            { date: nowLabel(), action: `Status diubah menjadi ${INVOICE_LABEL[status]}` },
          ])
          void navigate({ to: "/invoices" })
        },
      },
    )
  }

  return (
    <div className="page-content">
      <Header
        invoiceNo={invoiceNo}
        quotationNo={quotationNo}
        createdAt={quotation.createdAt}
        status={displayStatus}
        onDownload={handleDownload}
        poNumber={linkedPo?.poNumber}
        poDate={linkedPo?.poDate}
      />
      <StatusBar
        status={status}
        isOpen={isStatusOpen}
        onToggle={() => setIsStatusOpen((o) => !o)}
        onChange={handleStatusChange}
        onSave={handleSave}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          handleAttachmentSelect(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <FileCard
        fileName={deriveFileName(inv.attachmentObjectKey)}
        onUpload={() => attachmentInputRef.current?.click()}
        onDownload={handleAttachmentDownload}
      />
      <ClientSummaryCard
        clientName={quotation.client}
        clientInitials={clientInitials}
        clientInfo={quotation.clientInfo}
        shippingAlamat={shipping.alamat}
      />
      {totalShip > 0 && <ShippingTable shipping={shipping} />}
      <ProductTable products={products} showProfit={hasCost} />
      <CostBreakdown
        hasProducts={hasProducts}
        totalProduk={totalProduk}
        nominalDiskon={nominalDiskon}
        subTotal={subTotal}
        dppNilaiLain={dppNilaiLain}
        ppn12={ppn12}
        totalShip={totalShip}
        totalProfit={totalProfit}
        showProfit={hasCost}
        grandTotal={grandTotal}
      />
      <HistoryTimeline history={history} />
    </div>
  )
}

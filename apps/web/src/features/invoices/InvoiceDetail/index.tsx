import { useEffect, useMemo, useRef, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { getCompanyInitials } from "@/features/clients/helpers"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import HistoryTimeline from "@/features/quotations/QuotationDetail/HistoryTimeline"
import { nowLabel } from "@/features/quotations/QuotationDetail/helpers"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import type { QuotationData } from "@/features/quotations/types"
import { downloadPdf, fetchObjectUrl } from "@/lib/api-client"
import { computeTaxBreakdown, toNum } from "@/lib/format"
import type { Page } from "@/lib/page"
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
  onNavigate: (page: Page) => void
  onLogout: () => void
}

// Derive display filename from objectKey, e.g.
// "invoices/123/1700000000-receipt.pdf" -> "receipt.pdf"
function deriveFileName(objectKey: string | undefined): string {
  if (!objectKey) return ""
  const last = objectKey.split("/").pop() ?? ""
  const dash = last.indexOf("-")
  return dash >= 0 ? last.slice(dash + 1) : last
}

export default function InvoiceDetail({
  quotationId,
  quotationNo,
  quotation,
  onNavigate,
  onLogout,
}: InvoiceDetailProps) {
  const { data: inv, isLoading } = useInvoiceByQuotation(quotationId)
  const { data: invItems } = useInvoiceItems(inv?.id)
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
      <div className="admin-shell">
        <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main">
          <div className="page-content">
            <p>{isLoading ? "Memuat data Invoice…" : "Invoice tidak ditemukan."}</p>
          </div>
        </div>
      </div>
    )
  }

  // Cancelled is terminal: the list hides it, so the detail is read-only.
  if (inv.status === "cancelled") {
    return (
      <div className="admin-shell">
        <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main">
          <div className="page-content">
            <p>Invoice {inv.invoiceNo} telah dibatalkan.</p>
          </div>
        </div>
      </div>
    )
  }

  // Compute totals from snapshot items; PPN/grand from BE persisted.
  const totalProduk = products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = shipping.hargaSatuan
  const hasProducts = products.length > 0
  const discountPct = quotation.discountPct ?? 0
  const nominalDiskon = (totalProduk * discountPct) / 100
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
      onNavigate("invoices")
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
          onNavigate("invoices")
        },
      },
    )
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />
      <div className="admin-main">
        <div className="page-content">
          <Header
            invoiceNo={invoiceNo}
            quotationNo={quotationNo}
            createdAt={quotation.createdAt}
            status={displayStatus}
            onNavigate={onNavigate}
            onDownload={handleDownload}
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
            style={{ display: "none" }}
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
          <ProductTable products={products} />
          <CostBreakdown
            hasProducts={hasProducts}
            totalProduk={totalProduk}
            discountPct={discountPct}
            nominalDiskon={nominalDiskon}
            subTotal={subTotal}
            dppNilaiLain={dppNilaiLain}
            ppn12={ppn12}
            totalShip={totalShip}
            totalProfit={totalProfit}
            grandTotal={grandTotal}
          />
          <HistoryTimeline history={history} />
        </div>
      </div>
    </div>
  )
}

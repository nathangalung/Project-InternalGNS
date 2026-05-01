import { useEffect, useState } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import { computeGrandTotal } from "@/features/quotations/types"
import type { QuotationData } from "@/features/quotations/types"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import HistoryTimeline from "@/features/quotations/QuotationDetail/HistoryTimeline"
import { nowLabel } from "@/features/quotations/QuotationDetail/helpers"

import Header from "./Header"
import StatusBar from "./StatusBar"
import { type EditableInvoiceStatus } from "./helpers"
import { getRecord, invoiceNumberFor, upsertRecord } from "../storage"
import { INVOICE_LABEL } from "../types"
import type { InvoiceStatus } from "../types"

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

export default function InvoiceDetail({
  quotationId,
  quotationNo,
  quotation,
  onNavigate,
  onLogout,
}: InvoiceDetailProps) {
  const initialRecord = getRecord(quotationId)
  const initialBaseStatus: EditableInvoiceStatus =
    initialRecord?.status === "DIKIRIM" || initialRecord?.status === "TERLAMBAT"
      ? initialRecord.status
      : "DRAF"

  const [status, setStatus] = useState<EditableInvoiceStatus>(initialBaseStatus)
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (!quotation) return
    const items: HistoryEntry[] = [
      { date: quotation.createdAt, action: `Invoice dibuat dari Quotation ${quotationNo}` },
    ]
    if (initialRecord?.sentAt) {
      const d = new Date(initialRecord.sentAt)
      const label = Number.isNaN(d.getTime())
        ? initialRecord.sentAt
        : d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      items.push({ date: label, action: "Invoice dikirim ke klien" })
    }
    if (initialRecord?.paidAt) {
      const d = new Date(initialRecord.paidAt)
      const label = Number.isNaN(d.getTime())
        ? initialRecord.paidAt
        : d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      items.push({ date: label, action: "Invoice dibayar oleh klien" })
    }
    setHistory(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation?.createdAt, quotationNo, initialRecord?.sentAt, initialRecord?.paidAt])

  if (!quotation) {
    return (
      <div className="admin-shell">
        <Sidebar activePage={"invoices" as Page} onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main">
          <div className="page-content">
            <p>Invoice tidak ditemukan.</p>
          </div>
        </div>
      </div>
    )
  }

  const totalProduk = quotation.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = quotation.products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = quotation.shipping.hargaSatuan
  const hasProducts = quotation.products.length > 0
  const discountPct = quotation.discountPct ?? 0
  const nominalDiskon = (totalProduk * discountPct) / 100
  const subTotal = totalProduk - nominalDiskon
  const dppBase = hasProducts ? subTotal : totalShip
  const dppNilaiLain = Math.round((dppBase * 11) / 12)
  const ppn12 = dppBase - dppNilaiLain
  const grandTotal = computeGrandTotal(quotation)
  const clientInitials = quotation.client.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
  const invoiceNo = invoiceNumberFor(quotationId, quotation.createdAt)

  // Pass-through status to header (always derived; Dibayar & Terlambat may be auto-set by list logic).
  const displayStatus: InvoiceStatus = status

  function handleStatusChange(s: EditableInvoiceStatus) {
    setStatus(s)
    setIsStatusOpen(false)
  }

  function handleSave() {
    const prevStatus = initialBaseStatus
    const patch: Record<string, string> = { status }
    if (status === "DIKIRIM" && !initialRecord?.sentAt) {
      patch.sentAt = new Date().toISOString()
    }
    upsertRecord(quotationId, patch as Parameters<typeof upsertRecord>[1])
    if (status !== prevStatus) {
      setHistory(prev => [...prev, { date: nowLabel(), action: `Status diubah menjadi ${INVOICE_LABEL[status]}` }])
    }
    onNavigate("invoices")
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
          />
          <StatusBar
            status={status}
            isOpen={isStatusOpen}
            onToggle={() => setIsStatusOpen(o => !o)}
            onChange={handleStatusChange}
            onSave={handleSave}
          />
          <ClientSummaryCard
            clientName={quotation.client}
            clientInitials={clientInitials}
            clientInfo={quotation.clientInfo}
            shippingAlamat={quotation.shipping.alamat}
          />
          {totalShip > 0 && <ShippingTable shipping={quotation.shipping} />}
          <ProductTable products={quotation.products} />
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

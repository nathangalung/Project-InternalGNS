import { useEffect, useMemo, useState } from "react"
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
import { useInvoiceByQuotation, useChangeInvoiceStatus } from "../hooks"
import { INVOICE_LABEL } from "../types"
import type { InvoiceStatus } from "../types"
import type { InvoiceBackendStatus, InvoiceBackendRow } from "@/types/api"

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

// Backend status to editable.
function toEditable(inv: InvoiceBackendRow | null | undefined): EditableInvoiceStatus {
  if (!inv) return "DRAF"
  if (inv.status === "paid") return "DIKIRIM"
  if (inv.status === "sent") return "DIKIRIM"
  if (inv.status === "overdue") return "TERLAMBAT"
  if (inv.dueDate) {
    const due = new Date(inv.dueDate)
    if (!Number.isNaN(due.getTime()) && new Date() > due) return "TERLAMBAT"
  }
  return "DRAF"
}

const TO_BACKEND: Record<EditableInvoiceStatus, InvoiceBackendStatus> = {
  DRAF: "draft",
  DIKIRIM: "sent",
  TERLAMBAT: "overdue",
}

export default function InvoiceDetail({
  quotationId,
  quotationNo,
  quotation,
  onNavigate,
  onLogout,
}: InvoiceDetailProps) {
  const { data: inv, isLoading } = useInvoiceByQuotation(quotationId)
  const changeStatus = useChangeInvoiceStatus()

  const initialStatus = toEditable(inv)
  const [status, setStatus] = useState<EditableInvoiceStatus>(initialStatus)
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [extraHistory, setExtraHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (inv) setStatus(toEditable(inv))
  }, [inv])

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

  const totalProduk = quotation.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = quotation.products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = quotation.shipping.hargaSatuan
  const hasProducts = quotation.products.length > 0
  const discountPct = quotation.discountPct ?? 0
  const nominalDiskon = (totalProduk * discountPct) / 100
  const subTotal = totalProduk - nominalDiskon
  const dppBase = hasProducts ? subTotal : totalShip
  const dppNilaiLain = Math.round((dppBase * 11) / 12)
  const ppn12 = Math.round(dppNilaiLain * 0.12)
  const grandTotal = computeGrandTotal(quotation)
  const clientInitials = quotation.client.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
  const invoiceNo = inv.invoiceNo
  const displayStatus: InvoiceStatus = status

  function handleStatusChange(s: EditableInvoiceStatus) {
    setStatus(s)
    setIsStatusOpen(false)
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
          setExtraHistory(prev => [...prev, { date: nowLabel(), action: `Status diubah menjadi ${INVOICE_LABEL[status]}` }])
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

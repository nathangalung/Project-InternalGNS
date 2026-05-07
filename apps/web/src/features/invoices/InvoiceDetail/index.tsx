import { useEffect, useMemo, useState } from "react"
import type { Page } from "@/main"
import Sidebar from "@/components/shared/Sidebar"
import type { QuotationData } from "@/features/quotations/types"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import HistoryTimeline from "@/features/quotations/QuotationDetail/HistoryTimeline"
import { nowLabel } from "@/features/quotations/QuotationDetail/helpers"
import { downloadPdf } from "@/lib/api-client"

import Header from "./Header"
import StatusBar from "./StatusBar"
import { type EditableInvoiceStatus } from "./helpers"
import { useInvoiceByQuotation, useChangeInvoiceStatus, useInvoiceItems } from "../hooks"
import { invoiceItemsToProducts, invoiceItemsToShipping } from "../adapters"
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

function toNum(v: string | undefined | null): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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
  const { data: invItems } = useInvoiceItems(inv?.id)
  const changeStatus = useChangeInvoiceStatus()

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

  // Compute totals from snapshot items; PPN/grand from BE persisted.
  const totalProduk = products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = shipping.hargaSatuan
  const hasProducts = products.length > 0
  const discountPct = quotation.discountPct ?? 0
  const nominalDiskon = (totalProduk * discountPct) / 100
  const subTotal = totalProduk - nominalDiskon
  const dppNilaiLain = toNum(inv.dppNilaiLain) || Math.round(((hasProducts ? subTotal : totalShip) * 11) / 12)
  const ppn12 = toNum(inv.ppnAmount) || Math.round(dppNilaiLain * 0.12)
  const grandTotal = toNum(inv.total) || (hasProducts ? subTotal + ppn12 + totalShip : totalShip + ppn12)
  const clientInitials = quotation.client.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
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
            onDownload={handleDownload}
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

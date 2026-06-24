import { useEffect, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { getCompanyInitials } from "@/features/clients/helpers"
import type { QuotationData, Status } from "@/features/quotations/types"
import { downloadPdf } from "@/lib/api-client"
import type { Page } from "@/lib/page"
import { QUOTATION_TRANSITIONS } from "@/lib/status"
import ClientSummaryCard from "./ClientSummaryCard"
import CostBreakdown from "./CostBreakdown"
import Header from "./Header"
import HistoryTimeline from "./HistoryTimeline"
import { nowLabel } from "./helpers"
import ProductTable from "./ProductTable"
import RevisionHistoryCard from "./RevisionHistoryCard"
import ShippingTable from "./ShippingTable"
import StatusBar from "./StatusBar"

interface QuotationDetailProps {
  quotationId: string
  quotation?: QuotationData
  onSaveStatus?: (next: Status) => void
  onNavigate: (page: Page) => void
  onLogout: () => void
}

// Quotation detail orchestrator.
export default function QuotationDetail({
  quotationId,
  quotation,
  onSaveStatus,
  onNavigate,
  onLogout,
}: QuotationDetailProps) {
  const q = quotation

  const [status, setStatus] = useState<Status>(q?.status ?? "Draf")
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [history, setHistory] = useState(q?.history ?? [])

  // Sync local state when the quotation loads or changes.
  useEffect(() => {
    if (!q) return
    setStatus(q.status)
    setHistory(q.history)
  }, [q])

  if (!q) {
    return (
      <div className="admin-shell">
        <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main">
          <div className="page-content">
            <p>Quotation tidak ditemukan.</p>
          </div>
        </div>
      </div>
    )
  }

  const totalProduk = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = q.products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = q.shipping.hargaSatuan
  const hasProducts = q.products.length > 0
  const discountPct = q.discountPct ?? 0
  const nominalDiskon = q.totalDiscount
  const subTotal = q.subtotal
  const dppNilaiLain = q.dppNilaiLain
  const ppn12 = q.ppnAmount
  const grandTotal = q.totalBayar
  const clientInitials = getCompanyInitials(q.client)

  function handleStatusChange(s: Status) {
    setStatus(s)
    setIsStatusOpen(false)
  }

  async function handleDownload() {
    if (!q) return
    const numericId = Number(q.id)
    if (!Number.isFinite(numericId) || numericId <= 0) return
    const safe = quotationId.replace(/[^A-Za-z0-9._-]/g, "_")
    await downloadPdf(`/quotations/${numericId}/pdf`, `${safe}.pdf`)
  }

  function handleSave() {
    if (!q) return
    const newHistory =
      status !== q.status
        ? [...history, { date: nowLabel(), action: `Status diubah menjadi ${status}` }]
        : history
    if (onSaveStatus && status !== q.status) onSaveStatus(status)
    setHistory(newHistory)
    onNavigate("quotation")
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />
      <div className="admin-main">
        <div className="page-content">
          <Header
            quotationId={quotationId}
            createdAt={q.createdAt}
            version={q.version}
            status={status}
            onNavigate={onNavigate}
            onDownload={handleDownload}
          />
          <StatusBar
            status={status}
            allowedStatuses={QUOTATION_TRANSITIONS[q.status]}
            isOpen={isStatusOpen}
            onToggle={() => setIsStatusOpen((o) => !o)}
            onChange={handleStatusChange}
            onSave={handleSave}
          />
          <ClientSummaryCard
            clientName={q.client}
            clientInitials={clientInitials}
            clientInfo={q.clientInfo}
            shippingAlamat={q.shipping.alamat}
          />
          {totalShip > 0 && <ShippingTable shipping={q.shipping} />}
          <ProductTable products={q.products} />
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
          {Number.isFinite(Number(q.id)) && Number(q.id) > 0 && (
            <RevisionHistoryCard quotationId={Number(q.id)} />
          )}
        </div>
      </div>
    </div>
  )
}

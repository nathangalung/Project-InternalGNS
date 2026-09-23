import { useState } from "react"
import { getCompanyInitials } from "@/features/clients/helpers"
import { downloadQuotationPdf } from "@/features/quotations/hooks"
import type { QuotationData } from "@/features/quotations/types"
import { ui } from "@/lib/ui"
import type { QuotationTransition } from "@/types/api"
import { isEditable, quotationStatusFromLabel, splitTransitions, statusHint } from "../status"
import ClientSummaryCard from "./ClientSummaryCard"
import CostBreakdown from "./CostBreakdown"
import Header from "./Header"
import HistoryTimeline from "./HistoryTimeline"
import { profitAfterDiscount } from "./helpers"
import ProductTable from "./ProductTable"
import ReviseModal from "./ReviseModal"
import RevisionHistoryCard from "./RevisionHistoryCard"
import ShippingTable from "./ShippingTable"
import StatusBar from "./StatusBar"
import TransitionModal from "./TransitionModal"

type QuotationDetailProps = {
  quotationNo: string
  quotation: QuotationData
  // Server moves for the saved status
  transitions: QuotationTransition[]
  canRevise: boolean
  onEdit: () => void
}

// Quotation detail orchestrator.
export default function QuotationDetail({
  quotationNo,
  quotation: q,
  transitions,
  canRevise,
  onEdit,
}: QuotationDetailProps) {
  const [picked, setPicked] = useState<QuotationTransition | null>(null)
  const [revising, setRevising] = useState(false)

  const id = Number(q.id)
  const status = quotationStatusFromLabel(q.status)
  const { moves, cancel } = splitTransitions(transitions)

  const totalProduk = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalShip = q.shipping.hargaSatuan
  const hasProducts = q.products.length > 0

  return (
    <div className={ui.pageContent}>
      <Header
        quotationId={quotationNo}
        createdAt={q.createdAt}
        version={q.version}
        status={q.status}
        onEdit={isEditable(status) ? onEdit : undefined}
        onDownload={() => downloadQuotationPdf(id, quotationNo)}
      />
      <StatusBar
        status={q.status}
        hint={statusHint(status)}
        moves={moves}
        cancel={cancel}
        canRevise={canRevise}
        onPick={setPicked}
        onRevise={() => setRevising(true)}
      />
      <ClientSummaryCard
        clientName={q.client}
        clientId={q.clientId}
        clientInitials={getCompanyInitials(q.client)}
        clientInfo={q.clientInfo}
        shippingAlamat={q.shipping.alamat}
      />
      {totalShip > 0 && <ShippingTable shipping={q.shipping} />}
      <ProductTable products={q.products} />
      <CostBreakdown
        hasProducts={hasProducts}
        totalProduk={totalProduk}
        discountPct={q.discountPct ?? 0}
        nominalDiskon={q.totalDiscount}
        subTotal={q.subtotal}
        dppNilaiLain={q.dppNilaiLain}
        ppn12={q.ppnAmount}
        totalShip={totalShip}
        totalProfit={profitAfterDiscount(q.products, q.totalDiscount)}
        grandTotal={q.totalBayar}
      />
      <HistoryTimeline title="Riwayat Status" history={q.history} />
      <RevisionHistoryCard quotationId={id} />

      {picked && (
        <TransitionModal
          quotationId={id}
          current={q.status}
          transition={picked}
          onClose={() => setPicked(null)}
        />
      )}
      {revising && (
        <ReviseModal quotationId={id} version={q.version} onClose={() => setRevising(false)} />
      )}
    </div>
  )
}

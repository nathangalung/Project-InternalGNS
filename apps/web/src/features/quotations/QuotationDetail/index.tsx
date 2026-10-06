import { useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import HistoryTimeline from "@/components/shared/HistoryTimeline"
import { getCompanyInitials } from "@/features/clients/helpers"
import { downloadQuotationPdf } from "@/features/quotations/hooks"
import type { QuotationData } from "@/features/quotations/types"
import { ui } from "@/lib/ui"
import type { QuotationTransition } from "@/types/api"
import { isEditable, quotationStatusFromLabel, splitTransitions, statusHint } from "../status"
import ClientSummaryCard from "./ClientSummaryCard"
import ContactModal from "./ContactModal"
import CostBreakdown from "./CostBreakdown"
import Header from "./Header"
import { profitAfterDiscount } from "./helpers"
import ProductTable from "./ProductTable"
import ReviseModal from "./ReviseModal"
import RevisionHistoryCard from "./RevisionHistoryCard"
import ShippingTable from "./ShippingTable"
import StatusBar from "./StatusBar"
import TransitionModal from "./TransitionModal"

type QuotationDetailProps = {
  quotationNo: string
  // Number first issued, if imported
  legacyNo?: string
  quotation: QuotationData
  // Server moves for the saved status
  transitions: QuotationTransition[]
  canRevise: boolean
  // The chosen narahubung
  contactId?: number
  // Opened from the PO gate
  openContactPicker?: boolean
  // Offered lines the send rule refuses
  incomplete?: number
  onEdit: () => void
}

// Quotation detail orchestrator.
export default function QuotationDetail({
  quotationNo,
  legacyNo,
  quotation: q,
  transitions,
  canRevise,
  contactId,
  openContactPicker = false,
  incomplete = 0,
  onEdit,
}: QuotationDetailProps) {
  const [picked, setPicked] = useState<QuotationTransition | null>(null)
  const [revising, setRevising] = useState(false)

  const id = Number(q.id)
  const status = quotationStatusFromLabel(q.status)
  const { moves, cancel } = splitTransitions(transitions)
  // The editor covers drafts; an accepted quote re-picks here.
  const canChangeContact = status === "accepted" && q.clientId !== undefined
  const [changingContact, setChangingContact] = useState(openContactPicker && canChangeContact)

  const totalProduk = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalShip = q.shipping.hargaSatuan
  const hasProducts = q.products.length > 0

  return (
    <div className={ui.pageContent}>
      <Header
        quotationId={quotationNo}
        legacyNo={legacyNo}
        createdAt={q.createdAt}
        version={q.version}
        status={q.status}
        onEdit={isEditable(status) ? onEdit : undefined}
        onDownload={() => downloadQuotationPdf(id, quotationNo)}
      />
      <StatusBar
        status={q.status}
        hint={
          status === "accepted" ? (
            <>
              {statusHint(status)}{" "}
              <EntityLink kind="purchaseOrder" quotationId={id}>
                Lihat PO
              </EntityLink>
            </>
          ) : (
            statusHint(status)
          )
        }
        moves={moves}
        cancel={cancel}
        canRevise={canRevise}
        onPick={setPicked}
        onRevise={() => setRevising(true)}
      />
      {/* What blocks Dikirim, with the way to fix it. */}
      {isEditable(status) && incomplete > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.06)] px-5 py-3.5"
        >
          <span className="text-sm font-medium text-[#92400E]">
            {incomplete} produk belum lengkap. Isi vendor dan harganya dulu sebelum dikirim.
          </span>
          <button type="button" onClick={onEdit} className={`${ui.btnPrimary} px-4`}>
            Lengkapi Sekarang
          </button>
        </div>
      )}
      <ClientSummaryCard
        clientName={q.client}
        clientId={q.clientId}
        clientInitials={getCompanyInitials(q.client)}
        clientInfo={q.clientInfo}
        shippingAlamat={q.shipping.alamat}
        onChangeContact={canChangeContact ? () => setChangingContact(true) : undefined}
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
      <HistoryTimeline title="Riwayat Status" entries={q.history} />
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
      {changingContact && q.clientId !== undefined && (
        <ContactModal
          quotationId={id}
          companyId={q.clientId}
          contactId={contactId}
          onClose={() => setChangingContact(false)}
        />
      )}
    </div>
  )
}

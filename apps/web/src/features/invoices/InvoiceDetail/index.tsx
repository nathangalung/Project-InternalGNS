import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { getCompanyInitials } from "@/features/clients/helpers"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import { downloadPdf, fetchObjectUrl } from "@/lib/api-client"
import { computeTaxBreakdown, toNum } from "@/lib/format"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import type { InvoiceDetail as InvoiceDetailData } from "@/types/api"
import { invoiceItemsToProducts, invoiceItemsToShipping } from "../adapters"
import * as invApi from "../api"
import { failureMessage, runDownload, safeFileName } from "../download"
import {
  useCancelAndReplaceInvoice,
  useInvoiceAttachmentDownloadUrl,
  useInvoiceItems,
  useMarkInvoicePaid,
  useReplaceInvoice,
  useSendInvoice,
  useUpdateInvoiceDates,
  useUploadInvoiceAttachment,
} from "../hooks"
import ActionModal, { type ActionModalKind } from "./ActionModal"
import DatesCard from "./DatesCard"
import FileCard from "./FileCard"
import Header from "./Header"
import HistoryCard from "./HistoryCard"
import {
  clientInfoOf,
  fileNameFromKey,
  historyItems,
  invoiceActions,
  invoiceDisplayStatus,
} from "./helpers"
import StatusBar from "./StatusBar"

type InvoiceDetailProps = {
  inv: InvoiceDetailData
}

// Open a presigned file in a tab.
async function openPresigned(downloadUrl: string): Promise<void> {
  const objectUrl = await fetchObjectUrl(downloadUrl)
  window.open(objectUrl, "_blank", "noopener,noreferrer")
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

// Invoice detail, invoices API only.
//
// Everything on the page comes from the invoice read model, so finance can
// open it without the quotation or PO endpoints its role forbids.
export default function InvoiceDetail({ inv }: InvoiceDetailProps) {
  const navigate = useNavigate()
  const { data: invItems } = useInvoiceItems(inv.id)
  const uploadAttachment = useUploadInvoiceAttachment()
  const { data: attachmentDownload } = useInvoiceAttachmentDownloadUrl(
    inv.id,
    inv.attachmentObjectKey,
  )
  const sendInvoice = useSendInvoice()
  const markPaid = useMarkInvoicePaid()
  const cancelAndReplace = useCancelAndReplaceInvoice()
  const replaceInvoice = useReplaceInvoice()
  const updateDates = useUpdateInvoiceDates()
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [modal, setModal] = useState<ActionModalKind | null>(null)

  const status = invoiceDisplayStatus(inv)
  const actions = useMemo(() => invoiceActions(inv.allowedTransitions), [inv.allowedTransitions])
  const history = useMemo(() => historyItems(inv), [inv])
  const products = useMemo(() => invoiceItemsToProducts(invItems), [invItems])
  // Profit needs real cost data.
  const hasCost = useMemo(() => (invItems ?? []).some((it) => toNum(it.costPrice) > 0), [invItems])
  const shipping = useMemo(() => invoiceItemsToShipping(invItems), [invItems])
  // A refetch can withdraw the open step, e.g. a cancel whose Pengganti failed.
  const offered = modal === "replace" ? inv.canReplace : actions.some((a) => a.kind === modal)
  useEffect(() => {
    if (modal && !offered) setModal(null)
  }, [modal, offered])
  const busy =
    sendInvoice.isPending ||
    markPaid.isPending ||
    cancelAndReplace.isPending ||
    replaceInvoice.isPending

  // Totals from the snapshot lines; PPN and grand total as stored.
  const totalProduk = products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0)
  const totalProfit = products.reduce((s, p) => s + p.qty * p.profitSatuan, 0)
  const totalShip = shipping.hargaSatuan
  // The discount is snapshotted, so gross minus it lands on the stored DPP.
  const nominalDiskon = toNum(inv.totalDiscount)
  const subTotal = totalProduk - nominalDiskon
  const fallback = computeTaxBreakdown({ subtotal: subTotal, shipping: totalShip })
  const dppNilaiLain = toNum(inv.dppNilaiLain) || fallback.dppNilaiLain
  const ppn12 = toNum(inv.ppnAmount) || fallback.ppnAmount
  const grandTotal = toNum(inv.total) || fallback.grandTotal

  // Show the invoice now current.
  function showNewest(quotationId: number) {
    void navigate({ to: "/invoices/$id", params: { id: String(quotationId) }, search: {} })
  }

  async function confirmAction({ note, proof }: { note: string; proof?: File }) {
    if (modal === "send") await sendInvoice.mutateAsync(inv.id)
    if (modal === "pay") await markPaid.mutateAsync({ id: inv.id, proof })
    if (modal === "cancel") {
      const next = await cancelAndReplace.mutateAsync({ id: inv.id, note })
      showNewest(next.quotationId)
    }
    if (modal === "replace") {
      const next = await replaceInvoice.mutateAsync(inv.id)
      showNewest(next.quotationId)
    }
  }

  async function handleProofDownload() {
    try {
      const { downloadUrl } = await invApi.presignPaymentProofDownload(inv.id)
      await openPresigned(downloadUrl)
    } catch (err) {
      toast.error(failureMessage(err, "Gagal membuka bukti pembayaran."))
    }
  }

  async function handleAttachmentDownload() {
    if (!attachmentDownload?.downloadUrl) return
    try {
      await openPresigned(attachmentDownload.downloadUrl)
    } catch (err) {
      toast.error(failureMessage(err, "Gagal membuka lampiran."))
    }
  }

  return (
    <div className={ui.pageContent}>
      <Header
        inv={inv}
        status={status}
        onDownloadPdf={() =>
          void runDownload(
            () => downloadPdf(`/invoices/${inv.id}/pdf`, `${safeFileName(inv.invoiceNo)}.pdf`),
            "Gagal mengunduh PDF invoice.",
          )
        }
      />
      <StatusBar
        inv={inv}
        status={status}
        actions={actions}
        busy={busy}
        onAction={(kind) => setModal(kind)}
      />
      <DatesCard
        key={`${inv.id}-${inv.rowVersion}`}
        inv={inv}
        pending={updateDates.isPending}
        onSave={async (input) => {
          await updateDates.mutateAsync({ id: inv.id, input, rowVersion: inv.rowVersion })
        }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        aria-label="Pilih lampiran invoice"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) uploadAttachment.mutate({ id: inv.id, file })
          e.target.value = ""
        }}
      />
      <FileCard
        fileName={fileNameFromKey(inv.attachmentObjectKey)}
        onUpload={() => attachmentInputRef.current?.click()}
        onDownload={() => void handleAttachmentDownload()}
      />
      <ClientSummaryCard
        clientName={inv.companyName}
        clientInitials={getCompanyInitials(inv.companyName)}
        clientInfo={clientInfoOf(inv)}
        shippingAlamat={shipping.alamat}
      />
      {totalShip > 0 && <ShippingTable shipping={shipping} />}
      <ProductTable products={products} showProfit={hasCost} />
      <CostBreakdown
        hasProducts={products.length > 0}
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
      <HistoryCard items={history} onDownloadProof={() => void handleProofDownload()} />

      {modal && offered && (
        <ActionModal
          kind={modal}
          invoiceNo={inv.invoiceNo}
          pending={busy}
          onClose={() => setModal(null)}
          onConfirm={confirmAction}
        />
      )}
    </div>
  )
}

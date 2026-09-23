import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import Modal from "@/components/shared/Modal"
import { useMe } from "@/features/auth/hooks"
import { getCompanyInitials } from "@/features/clients/helpers"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import type { QuotationData } from "@/features/quotations/types"
import { ApiError, downloadFile, downloadPdf } from "@/lib/api-client"
import { formatDate, toNum } from "@/lib/format"
import { roleCanAccess } from "@/lib/rbac"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import type { PoTransition, PurchaseOrderRow } from "@/types/api"
import { poHistoryEntry, poItemsToProducts, poItemsToShipping, poRowFromBackend } from "../adapters"
import * as poApi from "../api"
import {
  useActorNames,
  useChangePoStatus,
  useInvoiceFiled,
  usePoHistory,
  usePoItems,
  useRemovePoFile,
  useSavePoUpload,
} from "../hooks"
import type { PoStatus } from "../types"
import UploadPoModal from "../UploadPoModal"
import CompletenessModal from "./CompletenessModal"
import FileCard from "./FileCard"
import Header from "./Header"
import HistoryCard from "./HistoryCard"
import {
  type CompletenessIssue,
  canDownloadDeliveryNote,
  deliveryNoteFileName,
  isPoLocked,
  parseCompletenessIssues,
  poBreakdown,
} from "./helpers"
import ReasonModal from "./ReasonModal"
import StatusBar from "./StatusBar"

type PurchaseOrderDetailProps = {
  po: PurchaseOrderRow
  // Client card data; the PO has its own figures
  quotation?: QuotationData
  onEdit: () => void
}

export default function PurchaseOrderDetail({ po, quotation, onEdit }: PurchaseOrderDetailProps) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { data: poItems } = usePoItems(po.id)
  const { data: events, isLoading: historyLoading } = usePoHistory(po.id)
  const actorNames = useActorNames(
    (events ?? []).map((ev) => ev.changedBy),
    me?.role === "superadmin",
  )
  // Operational cannot read invoices and relies on the server 409.
  const { data: invoiceFiled = false } = useInvoiceFiled(
    po.quotationId,
    po.status === "DELIVERED" && roleCanAccess(me?.role, "invoices"),
  )
  const changeStatus = useChangePoStatus()
  const uploadSave = useSavePoUpload()
  const removeFile = useRemovePoFile()

  // Pending choice, tied to the status it was made from
  const [choice, setChoice] = useState<{ from: PoStatus; t: PoTransition } | null>(null)
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showReason, setShowReason] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [issues, setIssues] = useState<CompletenessIssue[] | null>(null)

  // A saved move drops a stale choice.
  const selected = choice?.from === po.status ? choice.t : null

  const products = useMemo(() => poItemsToProducts(poItems), [poItems])
  const shipping = useMemo(() => poItemsToShipping(poItems), [poItems])
  // Profit needs real cost data.
  const hasCost = useMemo(() => (poItems ?? []).some((it) => toNum(it.costPrice) > 0), [poItems])
  const history = useMemo(
    () => (events ?? []).map((ev) => poHistoryEntry(ev, actorNames.get(ev.changedBy))),
    [events, actorNames],
  )

  const figures = poBreakdown(po)
  const totalShip = shipping.hargaSatuan
  const clientName = quotation?.client ?? po.companyName
  const row = poRowFromBackend(po)
  const dnReady = canDownloadDeliveryNote(po)
  const fileRemovable = po.status === "PENDING" || po.status === "UPLOADED"

  async function applyStatus(t: PoTransition, note?: string) {
    try {
      await changeStatus.mutateAsync({ id: po.id, status: t.to, note })
      setShowReason(false)
      toast.success(`Status PO diubah menjadi ${t.label}.`)
      void navigate({ to: "/purchase-orders" })
    } catch (err) {
      // The hook toasts everything but the completeness gate.
      const found = err instanceof ApiError ? parseCompletenessIssues(err.body) : null
      if (found) {
        setShowReason(false)
        setIssues(found)
      }
    }
  }

  function handleSave() {
    if (!selected) {
      void navigate({ to: "/purchase-orders" })
      return
    }
    if (selected.requiresNote) {
      setShowReason(true)
      return
    }
    void applyStatus(selected)
  }

  async function handleUploadSubmit(
    file: File | null,
    details: { poNumber: string; poDate: string },
  ) {
    if (await uploadSave.save(row, file, details)) setShowUpload(false)
  }

  async function handleRemoveFile() {
    try {
      await removeFile.mutateAsync(po.id)
      setConfirmRemove(false)
    } catch {
      // Hook toasts the error.
    }
  }

  async function handleDownload() {
    if (!po.objectKey || !po.fileName) return
    try {
      const { downloadUrl } = await poApi.presignDownload(po.id)
      await downloadFile(downloadUrl, po.fileName)
    } catch {
      toast.error("Gagal mengunduh berkas PO.")
    }
  }

  async function handleDownloadDeliveryNote() {
    if (!po.deliveryNoteNumber) return
    try {
      await downloadPdf(
        `/purchase-orders/${po.id}/delivery-note.pdf`,
        deliveryNoteFileName(po.deliveryNoteNumber),
      )
    } catch {
      toast.error("Gagal mengunduh Surat Jalan.")
    }
  }

  return (
    <>
      <div className={ui.pageContent}>
        <Header
          poNumber={po.poNumber}
          quotationId={po.quotationId}
          quotationNo={po.quotationNo}
          createdAt={formatDate(po.createdAt)}
          status={po.status}
          deliveryNoteNumber={po.deliveryNoteNumber}
          onEdit={isPoLocked(po.status) ? undefined : onEdit}
          onDownloadDeliveryNote={dnReady ? () => void handleDownloadDeliveryNote() : undefined}
        />
        <StatusBar
          status={po.status}
          selected={selected}
          transitions={po.allowedTransitions}
          isOpen={isStatusOpen}
          saving={changeStatus.isPending}
          onToggle={() => setIsStatusOpen((o) => !o)}
          onSelect={(t) => {
            setChoice(t ? { from: po.status, t } : null)
            setIsStatusOpen(false)
          }}
          onSave={handleSave}
        />
        <FileCard
          fileName={po.fileName}
          fileSize={po.fileSize}
          uploadedAt={po.uploadedAt}
          onUpload={() => setShowUpload(true)}
          onDownload={() => void handleDownload()}
          onRemove={fileRemovable ? () => setConfirmRemove(true) : undefined}
        />
        <ClientSummaryCard
          clientName={clientName}
          clientInitials={getCompanyInitials(clientName)}
          clientInfo={quotation?.clientInfo}
          shippingAlamat={shipping.alamat}
        />
        {totalShip > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <ShippingTable shipping={shipping} />
          </div>
        )}
        <div className="min-w-0 overflow-x-auto">
          <ProductTable products={products} showProfit={hasCost} />
        </div>
        <CostBreakdown
          hasProducts={products.length > 0}
          totalProduk={figures.totalProduk}
          discountPct={figures.discountPct}
          nominalDiskon={figures.nominalDiskon}
          subTotal={figures.subTotal}
          dppNilaiLain={figures.dppNilaiLain}
          ppn12={figures.ppn12}
          totalShip={totalShip}
          totalProfit={figures.totalProfit}
          showProfit={hasCost}
          grandTotal={figures.grandTotal}
        />
        <HistoryCard entries={history} isLoading={historyLoading} />
      </div>

      {showUpload && (
        <UploadPoModal
          row={row}
          hasExistingFile={Boolean(po.objectKey && po.fileName)}
          submitting={uploadSave.isPending}
          detailsLocked={invoiceFiled}
          onClose={() => setShowUpload(false)}
          onSubmit={(file, details) => void handleUploadSubmit(file, details)}
        />
      )}

      {showReason && selected && (
        <ReasonModal
          statusLabel={selected.label}
          submitting={changeStatus.isPending}
          onClose={() => setShowReason(false)}
          onSubmit={(note) => void applyStatus(selected, note)}
        />
      )}

      {confirmRemove && (
        <Modal
          title="Hapus berkas PO?"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <button
                type="button"
                className={ui.modalCancel}
                onClick={() => setConfirmRemove(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                disabled={removeFile.isPending}
                onClick={() => void handleRemoveFile()}
              >
                {removeFile.isPending ? "Menghapus..." : "Hapus Berkas"}
              </button>
            </>
          }
        >
          <p className="m-0 pb-4 text-sm text-[#4A4455]">
            Berkas {po.fileName} akan dilepas dari PO ini dan status kembali menjadi Pending.
          </p>
        </Modal>
      )}

      {issues && <CompletenessModal issues={issues} onClose={() => setIssues(null)} />}
    </>
  )
}

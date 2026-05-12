import { useQueries } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { useClient } from "@/features/clients/hooks"
import * as itemsApi from "@/features/items/api"
import { useQuotation } from "@/features/quotations/hooks"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import HistoryTimeline from "@/features/quotations/QuotationDetail/HistoryTimeline"
import { nowLabel } from "@/features/quotations/QuotationDetail/helpers"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import type { QuotationData } from "@/features/quotations/types"
import * as vendorsApi from "@/features/vendors/api"
import { downloadPdf, saveBlob } from "@/lib/api-client"
import type { Page } from "@/lib/page"
import { poItemsToProducts, poItemsToShipping } from "../adapters"
import * as poApi from "../api"
import {
  useChangePoStatus,
  usePoItems,
  usePurchaseOrderByQuotation,
  useUploadPoFile,
} from "../hooks"
import type { PoRow, PoStatus } from "../types"
import UploadPoModal from "../UploadPoModal"
import CompletenessModal from "./CompletenessModal"
import FileCard from "./FileCard"
import Header from "./Header"
import {
  type CompletenessIssue,
  PO_LABEL,
  poNumberFromQuotationNo,
  validateClientCompleteness,
  validateVendorCompleteness,
} from "./helpers"
import StatusBar from "./StatusBar"

interface HistoryEntry {
  date: string
  action: string
}

interface PurchaseOrderDetailProps {
  quotationId: number
  quotationNo: string
  quotation?: QuotationData
  onNavigate: (page: Page) => void
  onLogout: () => void
  onNavigateEntity?: (scope: "Klien" | "Vendor", id: number) => void
}

function toNum(v: string | undefined | null): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export default function PurchaseOrderDetail({
  quotationId,
  quotationNo,
  quotation,
  onNavigate,
  onLogout,
  onNavigateEntity,
}: PurchaseOrderDetailProps) {
  const { data: po, isLoading } = usePurchaseOrderByQuotation(quotationId)
  const { data: poItems } = usePoItems(po?.id)
  const changeStatus = useChangePoStatus()
  const uploadFile = useUploadPoFile()

  const initialStatus: PoStatus = po?.status ?? "PENDING"
  const [status, setStatus] = useState<PoStatus>(initialStatus)
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [extraHistory, setExtraHistory] = useState<HistoryEntry[]>([])
  const [completenessIssues, setCompletenessIssues] = useState<CompletenessIssue[] | null>(null)

  // Resolve client + vendors used by this PO so we can validate before promoting to ON_PROGRESS.
  const { data: quotationApi } = useQuotation(quotationId > 0 ? quotationId : undefined)
  const { data: clientRow } = useClient(quotationApi?.companyClientId)

  const uniqueItemIds = useMemo(() => {
    const ids = new Set<number>()
    quotationApi?.items
      .filter((it) => it.itemType === "product")
      .forEach((it) => {
        const id = it.offeredItemId ?? it.requestedItemId
        if (id !== undefined) ids.add(id)
      })
    return [...ids]
  }, [quotationApi])

  const itemVendorsQueries = useQueries({
    queries: uniqueItemIds.map((itemId) => ({
      queryKey: ["po-item-vendors", itemId],
      queryFn: () => itemsApi.listVendors(itemId),
    })),
  })

  const vendorIds = useMemo(() => {
    const ids = new Set<number>()
    if (!quotationApi) return [] as number[]
    const itemVendorMap = new Map<number, Awaited<ReturnType<typeof itemsApi.listVendors>>>()
    uniqueItemIds.forEach((id, idx) => {
      const data = itemVendorsQueries[idx]?.data
      if (data) itemVendorMap.set(id, data)
    })
    quotationApi.items
      .filter((it) => it.itemType === "product" && it.vendorProductId !== undefined)
      .forEach((it) => {
        const itemId = it.offeredItemId ?? it.requestedItemId
        if (itemId === undefined) return
        const vendors = itemVendorMap.get(itemId)
        if (!vendors) return
        const matched = vendors.find((v) => v.vendorProductId === it.vendorProductId)
        if (matched) ids.add(matched.vendorId)
      })
    return [...ids]
  }, [quotationApi, uniqueItemIds, itemVendorsQueries])

  const vendorQueries = useQueries({
    queries: vendorIds.map((vid) => ({
      queryKey: ["po-vendor-detail", vid],
      queryFn: () => vendorsApi.get(vid),
    })),
  })

  // Sync local status from backend.
  useEffect(() => {
    if (po) setStatus(po.status)
  }, [po])

  const products = useMemo(() => poItemsToProducts(poItems), [poItems])
  const shipping = useMemo(() => poItemsToShipping(poItems), [poItems])

  const history: HistoryEntry[] = useMemo(() => {
    if (!quotation || !po) return []
    const items: HistoryEntry[] = [
      { date: quotation.createdAt, action: `Purchase Order dibuat dari Quotation ${quotationNo}` },
    ]
    if (po.uploadedAt && po.fileName) {
      const d = new Date(po.uploadedAt)
      const label = Number.isNaN(d.getTime())
        ? po.uploadedAt
        : d.toLocaleString("id-ID", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
      items.push({ date: label, action: `Berkas PO diunggah: ${po.fileName}` })
    }
    return [...items, ...extraHistory]
  }, [quotation, po, quotationNo, extraHistory])

  if (!quotation || (isLoading && !po) || !po) {
    return (
      <div className="admin-shell">
        <Sidebar
          activePage={"purchase-orders" as Page}
          onNavigate={onNavigate}
          onLogout={onLogout}
        />
        <div className="admin-main">
          <div className="page-content">
            <p>{isLoading ? "Memuat data Purchase Order…" : "Purchase Order tidak ditemukan."}</p>
          </div>
        </div>
      </div>
    )
  }

  // BE-persisted totals from PO snapshot.
  const totalProduk = toNum(po.poTotalProduk)
  const totalProfit = toNum(po.poTotalProfit)
  const totalShip = shipping.hargaSatuan
  const hasProducts = products.length > 0
  const discountPct = quotation.discountPct ?? 0
  const nominalDiskon = (totalProduk * discountPct) / 100
  const subTotal = totalProduk - nominalDiskon
  const dppBase = hasProducts ? subTotal : totalShip
  const dppNilaiLain = Math.round((dppBase * 11) / 12)
  const ppn12 = Math.round(dppNilaiLain * 0.12)
  const grandTotal = hasProducts ? subTotal + ppn12 + totalShip : totalShip + ppn12
  const clientInitials = quotation.client
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  const poNumber = po.poNumber || poNumberFromQuotationNo(quotationNo)

  function handleStatusChange(s: PoStatus) {
    setStatus(s)
    setIsStatusOpen(false)
  }

  function handleSave() {
    if (!po) return
    if (status === po.status) {
      onNavigate("purchase-orders")
      return
    }

    // Block promotion to ON_PROGRESS until client + vendor data is complete.
    if (status === "ON_PROGRESS" && po.status !== "ON_PROGRESS") {
      const issues: CompletenessIssue[] = []
      if (clientRow) {
        const clientMissing = validateClientCompleteness(clientRow)
        if (clientMissing.length > 0) {
          issues.push({
            scope: "Klien",
            id: clientRow.id,
            name: clientRow.name,
            missing: clientMissing,
          })
        }
      }
      vendorQueries.forEach((q) => {
        if (!q.data) return
        const missing = validateVendorCompleteness(q.data)
        if (missing.length > 0) {
          issues.push({ scope: "Vendor", id: q.data.id, name: q.data.name, missing })
        }
      })
      if (issues.length > 0) {
        setCompletenessIssues(issues)
        return
      }
    }

    changeStatus.mutate(
      { id: po.id, status },
      {
        onSuccess: () => {
          setExtraHistory((prev) => [
            ...prev,
            { date: nowLabel(), action: `Status diubah menjadi ${PO_LABEL[status]}` },
          ])
          onNavigate("purchase-orders")
        },
      },
    )
  }

  function handleUploadSubmit(file: File) {
    if (!po) return
    uploadFile.mutate({ id: po.id, file }, { onSuccess: () => setShowUpload(false) })
  }

  async function handleDownload() {
    if (!po?.objectKey || !po?.fileName) return
    const { downloadUrl } = await poApi.presignDownload(po.id)
    const blob = await (await fetch(downloadUrl)).blob()
    await saveBlob(blob, po.fileName)
  }

  async function handleDownloadDeliveryNote() {
    if (!po) return
    const safe = poNumber.replace(/[^A-Za-z0-9._-]/g, "_")
    await downloadPdf(`/purchase-orders/${po.id}/delivery-note.pdf`, `DN-${safe}.pdf`)
  }

  const uploadRow: PoRow = {
    quotationId,
    quotationNo,
    poNumber,
    client: quotation.client,
    date: quotation.createdAt,
    total: String(grandTotal),
    status,
    fileName: po.fileName,
    objectKey: po.objectKey,
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"purchase-orders" as Page} onNavigate={onNavigate} onLogout={onLogout} />
      <div className="admin-main">
        <div className="page-content">
          <Header
            poNumber={poNumber}
            quotationNo={quotationNo}
            createdAt={quotation.createdAt}
            status={status}
            onNavigate={onNavigate}
            onDownloadDeliveryNote={handleDownloadDeliveryNote}
          />
          <StatusBar
            status={status}
            isOpen={isStatusOpen}
            onToggle={() => setIsStatusOpen((o) => !o)}
            onChange={handleStatusChange}
            onSave={handleSave}
          />
          <FileCard
            fileName={po.fileName}
            fileSize={po.fileSize}
            uploadedAt={po.uploadedAt}
            onUpload={() => setShowUpload(true)}
            onDownload={handleDownload}
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

      {showUpload && (
        <UploadPoModal
          row={uploadRow}
          onClose={() => setShowUpload(false)}
          onSubmit={handleUploadSubmit}
        />
      )}

      {completenessIssues && (
        <CompletenessModal
          issues={completenessIssues}
          onClose={() => setCompletenessIssues(null)}
          onNavigateEntity={
            onNavigateEntity
              ? (scope, id) => {
                  setCompletenessIssues(null)
                  onNavigateEntity(scope, id)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

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
import FileCard from "./FileCard"
import { PO_LABEL, poNumberFromQuotationNo } from "./helpers"
import { getRecord, upsertRecord } from "../storage"
import UploadPoModal from "../UploadPoModal"
import type { PoRow, PoStatus } from "../types"

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
}

export default function PurchaseOrderDetail({
  quotationId,
  quotationNo,
  quotation,
  onNavigate,
  onLogout,
}: PurchaseOrderDetailProps) {
  const initialRecord = getRecord(quotationId)
  const [status, setStatus] = useState<PoStatus>(initialRecord?.status ?? "PENDING")
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [fileName, setFileName] = useState<string | undefined>(initialRecord?.fileName)
  const [fileSize, setFileSize] = useState<number | undefined>(initialRecord?.fileSize)
  const [fileDataUrl, setFileDataUrl] = useState<string | undefined>(initialRecord?.fileDataUrl)
  const [uploadedAt, setUploadedAt] = useState<string | undefined>(initialRecord?.uploadedAt)
  const [showUpload, setShowUpload] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // Build initial history from quotation timeline + PO local events.
  useEffect(() => {
    if (!quotation) return
    const items: HistoryEntry[] = [
      { date: quotation.createdAt, action: `Purchase Order dibuat dari Quotation ${quotationNo}` },
    ]
    if (uploadedAt && fileName) {
      const d = new Date(uploadedAt)
      const label = Number.isNaN(d.getTime())
        ? uploadedAt
        : d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      items.push({ date: label, action: `Berkas PO diunggah: ${fileName}` })
    }
    setHistory(items)
    // Only rebuild when source data changes; status changes append below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation?.createdAt, quotationNo, uploadedAt, fileName])

  if (!quotation) {
    return (
      <div className="admin-shell">
        <Sidebar activePage={"purchase-orders" as Page} onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main">
          <div className="page-content">
            <p>Purchase Order tidak ditemukan.</p>
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
  const poNumber = poNumberFromQuotationNo(quotationNo)

  function handleStatusChange(s: PoStatus) {
    setStatus(s)
    setIsStatusOpen(false)
  }

  function handleSave() {
    const prevStatus = initialRecord?.status ?? "PENDING"
    upsertRecord(quotationId, { status })
    if (status !== prevStatus) {
      setHistory(prev => [...prev, { date: nowLabel(), action: `Status diubah menjadi ${PO_LABEL[status]}` }])
    }
    onNavigate("purchase-orders")
  }

  function handleUploadSubmit(file: { name: string; size: number; dataUrl: string }) {
    const ts = new Date().toISOString()
    upsertRecord(quotationId, {
      fileName: file.name,
      fileSize: file.size,
      fileDataUrl: file.dataUrl,
      uploadedAt: ts,
      status: status === "PENDING" ? "UPLOADED" : status,
    })
    setFileName(file.name)
    setFileSize(file.size)
    setFileDataUrl(file.dataUrl)
    setUploadedAt(ts)
    if (status === "PENDING") setStatus("UPLOADED")
    setShowUpload(false)
  }

  function handleDownload() {
    if (!fileDataUrl || !fileName) return
    const a = document.createElement("a")
    a.href = fileDataUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const uploadRow: PoRow = {
    quotationId,
    quotationNo,
    poNumber,
    client: quotation.client,
    date: quotation.createdAt,
    total: String(grandTotal),
    status,
    fileName,
    fileDataUrl,
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
          />
          <StatusBar
            status={status}
            isOpen={isStatusOpen}
            onToggle={() => setIsStatusOpen(o => !o)}
            onChange={handleStatusChange}
            onSave={handleSave}
          />
          <FileCard
            fileName={fileName}
            fileSize={fileSize}
            uploadedAt={uploadedAt}
            onUpload={() => setShowUpload(true)}
            onDownload={handleDownload}
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

      {showUpload && (
        <UploadPoModal
          row={uploadRow}
          onClose={() => setShowUpload(false)}
          onSubmit={handleUploadSubmit}
        />
      )}
    </div>
  )
}

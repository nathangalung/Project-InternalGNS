import StatusBadge from "@/components/shared/StatusBadge"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { InvoiceStatus } from "../types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "../types"

interface HeaderProps {
  invoiceNo: string
  quotationNo: string
  createdAt: string
  status: InvoiceStatus
  onNavigate: (page: Page) => void
  onDownload?: () => void
  poNumber?: string
  poDate?: string
}

export default function Header({
  invoiceNo,
  quotationNo,
  createdAt,
  status,
  onNavigate,
  onDownload,
  poNumber,
  poDate,
}: HeaderProps) {
  const badge = INVOICE_STATUS_STYLE[status]
  return (
    <>
      <nav className="qd-breadcrumb">
        <button className="qd-breadcrumb-link" onClick={() => onNavigate("invoices")}>
          Daftar Invoice
        </button>
        <span className="qd-breadcrumb-sep">&rsaquo;</span>
        <span className="qd-breadcrumb-current">Detail {invoiceNo}</span>
      </nav>

      <div className="qd-header">
        <div className="qd-header-left">
          <div>
            <h1 className="qd-title">Invoice {invoiceNo}</h1>
            <div className="qd-meta-row">
              <span className="qd-meta-text">Dibuat pada: {createdAt}</span>
              <span className="qd-meta-sep">|</span>
              <span className="qd-meta-text">Dari Quotation {quotationNo}</span>
              {poNumber && (
                <>
                  <span className="qd-meta-sep">|</span>
                  <span className="qd-meta-text">No. PO: {poNumber}</span>
                </>
              )}
              {poDate && (
                <>
                  <span className="qd-meta-sep">|</span>
                  <span className="qd-meta-text">Tanggal PO: {poDate.slice(0, 10)}</span>
                </>
              )}
              <span className="qd-meta-sep">|</span>
              <StatusBadge bg={badge.bg} color={badge.color}>
                {INVOICE_LABEL[status]}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className="qd-header-actions">
          <button
            type="button"
            className={`${ui.btnPrimary} min-w-[130px]`}
            onClick={onDownload}
            disabled={!onDownload}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="#fff"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Unduh PDF
          </button>
        </div>
      </div>
    </>
  )
}

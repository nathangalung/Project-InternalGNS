import { useNavigate } from "@tanstack/react-router"
import StatusBadge from "@/components/shared/StatusBadge"
import { ui } from "@/lib/ui"
import type { InvoiceStatus } from "../types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "../types"

interface HeaderProps {
  invoiceNo: string
  quotationNo: string
  createdAt: string
  status: InvoiceStatus
  onDownload?: () => void
  poNumber?: string
  poDate?: string
}

export default function Header({
  invoiceNo,
  quotationNo,
  createdAt,
  status,
  onDownload,
  poNumber,
  poDate,
}: HeaderProps) {
  const navigate = useNavigate()
  const badge = INVOICE_STATUS_STYLE[status]
  return (
    <>
      <nav className={ui.breadcrumb}>
        <button className={ui.breadcrumbLink} onClick={() => void navigate({ to: "/invoices" })}>
          Daftar Invoice
        </button>
        <span className={ui.breadcrumbSep}>&rsaquo;</span>
        <span className={ui.breadcrumbCurrent}>Detail {invoiceNo}</span>
      </nav>

      <div className={ui.detailHeader}>
        <div className={ui.detailHeaderLeft}>
          <div>
            <h1 className={ui.detailTitle}>Invoice {invoiceNo}</h1>
            <div className={ui.metaRow}>
              <span className={ui.metaText}>Dibuat pada: {createdAt}</span>
              <span className={ui.metaSep}>|</span>
              <span className={ui.metaText}>Dari Quotation {quotationNo}</span>
              {poNumber && (
                <>
                  <span className={ui.metaSep}>|</span>
                  <span className={ui.metaText}>No. PO: {poNumber}</span>
                </>
              )}
              {poDate && (
                <>
                  <span className={ui.metaSep}>|</span>
                  <span className={ui.metaText}>Tanggal PO: {poDate.slice(0, 10)}</span>
                </>
              )}
              <span className={ui.metaSep}>|</span>
              <StatusBadge bg={badge.bg} color={badge.color}>
                {INVOICE_LABEL[status]}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className={ui.detailActions}>
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

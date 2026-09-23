import { Link } from "@tanstack/react-router"
import EntityLink from "@/components/shared/EntityLink"
import StatusBadge from "@/components/shared/StatusBadge"
import { formatDate } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { InvoiceDetail, InvoiceDisplayStatus } from "../types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "../types"

type HeaderProps = {
  inv: InvoiceDetail
  status: InvoiceDisplayStatus
  onDownloadPdf: () => void
}

// Matches the legacy filled glyph.
function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// Breadcrumb, title, meta, downloads.
//
// Quotation and PO links fall back to text for finance, which cannot open
// those pages; the client link works for every role.
export default function Header({ inv, status, onDownloadPdf }: HeaderProps) {
  const badge = INVOICE_STATUS_STYLE[status]
  return (
    <>
      <nav className={ui.breadcrumb} aria-label="Breadcrumb">
        <Link to="/invoices" className={`${ui.breadcrumbLink} no-underline`}>
          Daftar Invoice
        </Link>
        <span className={ui.breadcrumbSep} aria-hidden="true">
          &rsaquo;
        </span>
        <span className={`${ui.breadcrumbCurrent} min-w-0 [overflow-wrap:anywhere]`}>
          Detail {inv.invoiceNo}
        </span>
      </nav>

      <div className={ui.detailHeader}>
        <div className={ui.detailHeaderLeft}>
          <div className="min-w-0">
            <h1 className={ui.detailTitle}>Invoice {inv.invoiceNo}</h1>
            <div className={ui.metaRow}>
              <span className={ui.metaText}>Dibuat pada: {formatDate(inv.createdAt)}</span>
              <span className={ui.metaSep}>|</span>
              <span className={ui.metaText}>
                Klien:{" "}
                <EntityLink kind="client" id={inv.companyClientId} tone="name">
                  {inv.companyName}
                </EntityLink>
              </span>
              <span className={ui.metaSep}>|</span>
              <span className={ui.metaText}>
                Dari Quotation{" "}
                <EntityLink kind="quotation" id={inv.quotationId}>
                  {inv.quotationNo}
                </EntityLink>
              </span>
              {inv.poNumber && (
                <>
                  <span className={ui.metaSep}>|</span>
                  <span className={ui.metaText}>
                    No. PO:{" "}
                    <EntityLink kind="purchaseOrder" quotationId={inv.quotationId}>
                      {inv.poNumber}
                    </EntityLink>
                  </span>
                </>
              )}
              {inv.poDate && (
                <>
                  <span className={ui.metaSep}>|</span>
                  <span className={ui.metaText}>Tanggal PO: {formatDate(inv.poDate)}</span>
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
            onClick={onDownloadPdf}
          >
            <DownloadIcon />
            Unduh PDF
          </button>
        </div>
      </div>
    </>
  )
}

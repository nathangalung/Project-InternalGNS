import StatusBadge from "@/components/shared/StatusBadge"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { PoStatus } from "../types"
import { PO_LABEL, PO_STATUS_CONFIG } from "./helpers"

interface HeaderProps {
  poNumber: string
  quotationNo: string
  createdAt: string
  status: PoStatus
  onNavigate: (page: Page) => void
  onDownloadDeliveryNote?: () => void
}

export default function Header({
  poNumber,
  quotationNo,
  createdAt,
  status,
  onNavigate,
  onDownloadDeliveryNote,
}: HeaderProps) {
  const badge = PO_STATUS_CONFIG[status]
  return (
    <>
      <nav className="qd-breadcrumb">
        <button className="qd-breadcrumb-link" onClick={() => onNavigate("purchase-orders")}>
          Daftar Purchase Order
        </button>
        <span className="qd-breadcrumb-sep">&rsaquo;</span>
        <span className="qd-breadcrumb-current">Detail {poNumber}</span>
      </nav>

      <div className="qd-header">
        <div className="qd-header-left">
          <div>
            <h1 className="qd-title">Purchase Order {poNumber}</h1>
            <div className="qd-meta-row">
              <span className="qd-meta-text">Dibuat pada: {createdAt}</span>
              <span className="qd-meta-sep">|</span>
              <span className="qd-meta-text">Dari Quotation {quotationNo}</span>
              <span className="qd-meta-sep">|</span>
              <StatusBadge bg={badge.bg} color={badge.color}>
                {PO_LABEL[status]}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className="qd-header-actions">
          <button
            className={`${ui.btnOutline} min-w-[130px]`}
            onClick={() => onNavigate("purchase-order-edit")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Ubah
          </button>
          <button
            type="button"
            className={`${ui.btnPrimary} min-w-[130px]`}
            onClick={onDownloadDeliveryNote}
            disabled={!onDownloadDeliveryNote}
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
            Unduh Surat Jalan
          </button>
        </div>
      </div>
    </>
  )
}

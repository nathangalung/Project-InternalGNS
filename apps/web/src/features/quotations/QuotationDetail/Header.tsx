import StatusBadge from "@/components/shared/StatusBadge"
import type { Status } from "@/features/quotations/types"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import { statusConfig } from "./helpers"

interface HeaderProps {
  quotationId: string
  createdAt: string
  version: number | string
  status: Status
  onNavigate: (page: Page) => void
  onDownload?: () => void
}

// Breadcrumb plus title actions.
export default function Header({
  quotationId,
  createdAt,
  version,
  status,
  onNavigate,
  onDownload,
}: HeaderProps) {
  const badge = statusConfig[status]
  return (
    <>
      <nav className={ui.breadcrumb}>
        <button type="button" className={ui.breadcrumbLink} onClick={() => onNavigate("quotation")}>
          Daftar Quotation
        </button>
        <span className={ui.breadcrumbSep}>&rsaquo;</span>
        <span className={ui.breadcrumbCurrent}>Detail {quotationId}</span>
      </nav>

      <div className={ui.detailHeader}>
        <div className={ui.detailHeaderLeft}>
          <div>
            <h1 className={ui.detailTitle}>Quotation {quotationId}</h1>
            <div className={ui.metaRow}>
              <span className={ui.metaText}>Dibuat pada: {createdAt}</span>
              <span className={ui.metaSep}>|</span>
              <span className={ui.metaText}>Versi {version}</span>
              <span className={ui.metaSep}>|</span>
              <StatusBadge bg={badge.bg} color={badge.color}>
                {status}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className={ui.detailActions}>
          <button
            type="button"
            className={`${ui.btnOutline} min-w-[130px]`}
            onClick={() => onNavigate("quotation-edit")}
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

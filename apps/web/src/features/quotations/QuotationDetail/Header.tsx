import { Link } from "@tanstack/react-router"
import { useState } from "react"
import StatusBadge from "@/components/shared/StatusBadge"
import type { Status } from "@/features/quotations/types"
import { ui } from "@/lib/ui"
import { quotationBadge } from "../status"

type HeaderProps = {
  quotationId: string
  createdAt: string
  version: number | string
  status: Status
  // Absent once the quotation leaves draft
  onEdit?: () => void
  onDownload: () => Promise<void>
}

// Breadcrumb plus title actions.
export default function Header({
  quotationId,
  createdAt,
  version,
  status,
  onEdit,
  onDownload,
}: HeaderProps) {
  const [downloading, setDownloading] = useState(false)
  const badge = quotationBadge[status]

  async function download() {
    setDownloading(true)
    try {
      await onDownload()
    } finally {
      setDownloading(false)
    }
  }
  return (
    <>
      <nav className={ui.breadcrumb}>
        <Link to="/quotations" className={`${ui.breadcrumbLink} no-underline`}>
          Daftar Quotation
        </Link>
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
          {onEdit && (
            <button type="button" className={`${ui.btnOutline} min-w-[130px]`} onClick={onEdit}>
              <svg
                aria-hidden="true"
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
          )}
          <button
            type="button"
            className={`${ui.btnPrimary} min-w-[130px]`}
            onClick={() => void download()}
            disabled={downloading}
          >
            <svg
              aria-hidden="true"
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
            {downloading ? "Mengunduh…" : "Unduh PDF"}
          </button>
        </div>
      </div>
    </>
  )
}

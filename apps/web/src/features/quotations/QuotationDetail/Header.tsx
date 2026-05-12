import type { Status } from "@/features/quotations/types"
import type { Page } from "@/main"
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
      <nav className="qd-breadcrumb">
        <button className="qd-breadcrumb-link" onClick={() => onNavigate("quotation")}>
          Daftar Quotation
        </button>
        <span className="qd-breadcrumb-sep">&rsaquo;</span>
        <span className="qd-breadcrumb-current">Detail {quotationId}</span>
      </nav>

      <div className="qd-header">
        <div className="qd-header-left">
          <div>
            <h1 className="qd-title">Quotation {quotationId}</h1>
            <div className="qd-meta-row">
              <span className="qd-meta-text">Dibuat pada: {createdAt}</span>
              <span className="qd-meta-sep">|</span>
              <span className="qd-meta-text">Versi {version}</span>
              <span className="qd-meta-sep">|</span>
              <span className="status-badge" style={{ background: badge.bg, color: badge.color }}>
                {status}
              </span>
            </div>
          </div>
        </div>
        <div className="qd-header-actions">
          <button
            className="btn-admin-outline"
            onClick={() => onNavigate("quotation-edit")}
            style={{ minWidth: "130px", justifyContent: "center" }}
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
            className="btn-admin-primary"
            style={{ minWidth: "130px", justifyContent: "center" }}
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

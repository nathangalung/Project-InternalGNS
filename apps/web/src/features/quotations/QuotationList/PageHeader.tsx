import type { Page } from "@/main";

interface PageHeaderProps {
  onNavigate: (page: Page) => void;
}

// Title bar plus three actions.
export default function PageHeader({ onNavigate }: PageHeaderProps) {
  return (
    <div className="page-header">
      <h1 className="page-title">Daftar Quotation</h1>
      <div className="page-actions">
        <button className="btn-admin-outline" style={{ width: "160px", justifyContent: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Ekspor PDF
        </button>
        <button
          className="btn-admin-primary"
          onClick={() => onNavigate("quotation-add" as Page)}
          style={{ width: "180px", justifyContent: "center" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Quotation Baru
        </button>
      </div>
    </div>
  );
}

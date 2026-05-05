import type { CompletenessIssue } from "./helpers"

interface CompletenessModalProps {
  issues: CompletenessIssue[]
  onClose: () => void
  onNavigateEntity?: (scope: "Klien" | "Vendor", id: number) => void
}

export default function CompletenessModal({ issues, onClose, onNavigateEntity }: CompletenessModalProps) {
  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={e => e.stopPropagation()}>

        <div className="ca-header">
          <h2 className="ca-title">Data Belum Lengkap</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <div className="ca-body">
          <p style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: "13px",
            color: "#4A4455",
            margin: "0 0 16px 0",
            lineHeight: 1.5,
          }}>
            Sebelum mengubah status menjadi <strong style={{ color: "#9333EA" }}>Dalam Progres</strong>, data berikut harus dilengkapi terlebih dahulu. Klik kartu untuk membuka halaman edit.
          </p>

          {issues.map((issue, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onNavigateEntity?.(issue.scope, issue.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "#FEF3C7",
                border: "1px solid #FDE68A",
                borderRadius: "8px",
                padding: "12px 14px",
                marginBottom: idx < issues.length - 1 ? "10px" : 0,
                cursor: onNavigateEntity ? "pointer" : "default",
                fontFamily: "'Inter', sans-serif",
                transition: "background 0.15s, border-color 0.15s, transform 0.15s",
              }}
              onMouseEnter={e => {
                if (!onNavigateEntity) return
                e.currentTarget.style.background = "#FDE68A"
                e.currentTarget.style.borderColor = "#F59E0B"
              }}
              onMouseLeave={e => {
                if (!onNavigateEntity) return
                e.currentTarget.style.background = "#FEF3C7"
                e.currentTarget.style.borderColor = "#FDE68A"
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: "13px",
                color: "#78350F",
                marginBottom: "4px",
              }}>
                <span>{issue.scope}: {issue.name}</span>
                {onNavigateEntity && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
              <ul style={{
                margin: 0,
                paddingLeft: "20px",
                fontSize: "12px",
                color: "#78350F",
                lineHeight: 1.6,
              }}>
                {issue.missing.map(field => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        <div className="ca-footer" style={{ justifyContent: "flex-end", padding: "16px 24px" }}>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={onClose}
            style={{ padding: "8px 22px", fontSize: "13px" }}
          >
            Mengerti
          </button>
        </div>

      </div>
    </div>
  )
}

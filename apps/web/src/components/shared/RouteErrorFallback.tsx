import type { CSSProperties } from "react"

interface RouteErrorFallbackProps {
  error: unknown
  reset?: () => void
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "60vh",
  padding: "32px",
  fontFamily: "'Inter', sans-serif",
  color: "#4A4455",
  textAlign: "center",
  gap: "12px",
}

const buttonStyle: CSSProperties = {
  marginTop: "8px",
  padding: "8px 22px",
  borderRadius: "8px",
  border: "1px solid #630ED4",
  background: "#630ED4",
  color: "#FFFFFF",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "13px",
}

const detailStyle: CSSProperties = {
  marginTop: "8px",
  maxWidth: "520px",
  fontSize: "12px",
  color: "#7B7287",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return "Unknown error"
  }
}

export default function RouteErrorFallback({ error, reset }: RouteErrorFallbackProps) {
  return (
    <div style={containerStyle}>
      <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Terjadi kesalahan</h2>
      <p style={{ margin: 0, fontSize: "14px" }}>
        Halaman tidak dapat dimuat. Coba muat ulang atau hubungi administrator.
      </p>
      <pre style={detailStyle}>{describe(error)}</pre>
      {reset && (
        <button type="button" onClick={reset} style={buttonStyle}>
          Coba Lagi
        </button>
      )}
    </div>
  )
}

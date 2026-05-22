import { Link } from "@tanstack/react-router"
import type { CSSProperties } from "react"

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

const linkStyle: CSSProperties = {
  marginTop: "8px",
  padding: "8px 22px",
  borderRadius: "8px",
  background: "#630ED4",
  color: "#FFFFFF",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "13px",
}

// Fallback for unmatched routes.
export default function RouteNotFound() {
  return (
    <div style={containerStyle}>
      <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Halaman tidak ditemukan</h2>
      <p style={{ margin: 0, fontSize: "14px" }}>
        URL yang Anda buka tidak tersedia. Kembali ke beranda untuk melanjutkan.
      </p>
      <Link to="/" style={linkStyle}>
        Kembali ke Beranda
      </Link>
    </div>
  )
}
